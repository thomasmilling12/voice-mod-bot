import { VoiceReceiver, EndBehaviorType } from "@discordjs/voice";
import { GuildMember } from "discord.js";
import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import prism from "prism-media";
import { config } from "./config";
import { logger } from "./logger";
import { SpeakerStats } from "./speakerStats";

type StoppableWriteStream = fs.WriteStream & { stop?: () => void };

export interface SessionMark {
  offsetMs: number;
  note: string;
  markedAt: Date;
}

export interface RecordingSession {
  guildId: string;
  channelId: string;
  startedAt: Date;
  hostIds: Set<string>;
  files: string[];
  completedFiles: string[];
  skippedTracks: number;
  activeStreams: Map<string, StoppableWriteStream>;
  conversions: Promise<string>[];
  stats: SpeakerStats;
  stopTimer?: NodeJS.Timeout;
  stopReason?: string;
  paused: boolean;
  customMaxMs?: number;
  marks: SessionMark[];
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
}

export function getSessionDir(session: RecordingSession): string {
  const guildDir = path.join(config.recordingsDir, safeName(session.guildId));
  return path.join(
    guildDir,
    `session_${session.startedAt.toISOString().replace(/[:.]/g, "-")}`
  );
}

export function createSession(
  guildId: string,
  channelId: string,
  hostIds: Set<string>
): RecordingSession {
  return {
    guildId,
    channelId,
    startedAt: new Date(),
    hostIds,
    files: [],
    completedFiles: [],
    skippedTracks: 0,
    activeStreams: new Map(),
    conversions: [],
    stats: new SpeakerStats(),
    paused: false,
    marks: [],
  };
}

export function startUserRecording(
  receiver: VoiceReceiver,
  userId: string,
  member: GuildMember | null,
  session: RecordingSession
): void {
  if (session.paused) return;
  if (session.activeStreams.has(userId)) return;

  const isHost = session.hostIds.has(userId);
  const displayName = member?.displayName ?? userId;
  const sessionDir = getSessionDir(session);
  ensureDir(sessionDir);

  const rawFile = path.join(
    sessionDir,
    `${safeName(displayName)}_${userId}_${Date.now()}_${isHost ? "host" : "guest"}.raw.pcm`
  );
  const outputFile = path.join(
    sessionDir,
    `${safeName(displayName)}_${userId}_${Date.now()}_${isHost ? "host" : "guest"}.ogg`
  );

  logger.info(`Recording ${displayName} (host=${isHost})`);

  const opusStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.Manual },
  });

  const decoder = new prism.opus.Decoder({
    frameSize: 960,
    channels: 2,
    rate: 48000,
  });
  const rawStream = fs.createWriteStream(rawFile) as StoppableWriteStream;
  opusStream.pipe(decoder).pipe(rawStream);
  rawStream.stop = () => {
    try { opusStream.destroy(); } catch { }
    setTimeout(() => {
      try { decoder.end(); } catch { }
      if (!rawStream.writableEnded) {
        try { rawStream.end(); } catch { }
      }
    }, 100);
  };
  session.activeStreams.set(userId, rawStream);

  const conversionPromise = new Promise<string>((resolve) => {
    let conversionStarted = false;
    const finishAndConvert = (forceEnd = false) => {
      if (conversionStarted) return;
      conversionStarted = true;
      session.activeStreams.delete(userId);
      session.stats.stopSpeaking(userId);

      if (forceEnd) {
        try { decoder.end(); } catch { }
        if (!rawStream.writableEnded) {
          try { rawStream.end(); } catch { }
        }
      }

      const convertWhenFinished = () => {
        // 1 second of 48 kHz stereo 16-bit PCM = 192 000 bytes. Skip anything shorter.
        const MIN_BYTES = 48000 * 2 * 2;
        const fileSize = fs.existsSync(rawFile) ? fs.statSync(rawFile).size : 0;
        if (fileSize < MIN_BYTES) {
          logger.warn(`Skipped short/empty recording for ${displayName}: ${fileSize} bytes (<1 s)`);
          session.skippedTracks += 1;
          try { fs.unlinkSync(rawFile); } catch { }
          resolve("");
          return;
        }
        convertTrack(rawFile, outputFile, isHost, displayName)
          .then(() => {
            session.completedFiles.push(outputFile);
            resolve(outputFile);
          })
          .catch((err) => {
            logger.error(`Conversion failed for ${displayName}: ${err}`);
            resolve("");
          });
      };

      if (rawStream.writableFinished) {
        convertWhenFinished();
      } else {
        rawStream.once("finish", convertWhenFinished);
      }
    };

    opusStream.on("end", () => {
      finishAndConvert();
    });

    opusStream.on("close", () => {
      setTimeout(() => finishAndConvert(true), 100);
    });

    opusStream.on("error", (err) => {
      logger.error(`Stream error for ${displayName}: ${err.message}`);
      finishAndConvert(true);
    });

    decoder.on("error", (err) => {
      logger.error(`Decode error for ${displayName}: ${err.message}`);
      finishAndConvert(true);
    });

    rawStream.on("error", (err) => {
      logger.error(`File write error for ${displayName}: ${err.message}`);
      finishAndConvert(true);
    });
  });

  session.conversions.push(conversionPromise);
  session.files.push(outputFile);
}

function buildFfmpegArgs(
  rawFile: string,
  outputFile: string,
  isHost: boolean
): string[] {
  const base = ["-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", rawFile];
  const noiseGate = "agate=threshold=-40dB:attack=5:release=200";

  if (isHost) {
    const { highpassHz, lowpassHz, compressorThresholdDb, normalizeTarget } =
      config.hostClearness;
    const filter = [
      noiseGate,
      `highpass=f=${highpassHz}`,
      `lowpass=f=${lowpassHz}`,
      `acompressor=threshold=${compressorThresholdDb}dB:ratio=4:attack=5:release=50`,
      `loudnorm=I=${normalizeTarget}:TP=-1.5:LRA=11`,
    ].join(",");
    return [...base, "-af", filter, "-c:a", "libvorbis", "-q:a", "7", outputFile];
  }

  const filter = [noiseGate, "loudnorm=I=-16:TP=-1.5:LRA=11"].join(",");
  return [...base, "-af", filter, "-c:a", "libvorbis", "-q:a", "4", outputFile];
}

function convertTrack(
  rawFile: string,
  outputFile: string,
  isHost: boolean,
  displayName: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = buildFfmpegArgs(rawFile, outputFile, isHost);
    logger.info(`Converting ${displayName}...`);
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    ffmpeg.stderr.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line.toLowerCase().includes("error")) logger.warn(`ffmpeg: ${line}`);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        logger.info(`Saved: ${outputFile}`);
        fs.unlink(rawFile, () => {});
        resolve();
      } else {
        reject(new Error(`ffmpeg exited ${code}`));
      }
    });
  });
}

export async function trimSilence(mergedFile: string): Promise<string> {
  const dir = path.dirname(mergedFile);
  const ext = path.extname(mergedFile);
  const trimmedFile = path.join(dir, `merged-trimmed${ext}`);
  return new Promise((resolve) => {
    const args = [
      "-y", "-i", mergedFile,
      "-af", "silenceremove=start_periods=1:start_silence=0.3:start_threshold=-50dB:stop_periods=-1:stop_duration=2:stop_threshold=-50dB",
      "-codec:a", "libmp3lame", "-q:a", "3",
      trimmedFile,
    ];
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    ffmpeg.stderr.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line.toLowerCase().includes("error")) logger.warn(`ffmpeg trim-silence: ${line}`);
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        try { fs.unlinkSync(mergedFile); } catch { }
        try { fs.renameSync(trimmedFile, mergedFile); } catch { }
        logger.info(`Silence trimmed: ${mergedFile}`);
      } else {
        logger.warn("Silence trim failed — using untrimmed file");
        try { fs.unlinkSync(trimmedFile); } catch { }
      }
      resolve(mergedFile);
    });
  });
}

export async function mergeRecordings(
  session: RecordingSession
): Promise<string | null> {
  const validFiles = session.completedFiles.filter((f) => f && fs.existsSync(f));
  const missingCount = session.files.length - validFiles.length;
  logger.info(`Merge input check: ${validFiles.length} converted track(s), ${missingCount} missing/failed track(s)`);
  if (validFiles.length === 0) {
    logger.warn("No converted tracks available to merge");
    return null;
  }
  if (validFiles.length === 1) return validFiles[0] ?? null;

  const sessionDir = getSessionDir(session);
  const mergedFile = path.join(sessionDir, "merged.mp3");

  return new Promise((resolve) => {
    const inputs: string[] = [];
    for (const f of validFiles) inputs.push("-i", f);

    // Normalise each track individually then mix so no single speaker drowns out others.
    // Each [N]loudnorm stream is brought to -16 LUFS before amix combines them.
    const normParts = validFiles.map((_, i) => `[${i}]loudnorm=I=-16:TP=-1.5:LRA=11[n${i}]`).join(";");
    const normInputs = validFiles.map((_, i) => `[n${i}]`).join("");
    const filterComplex =
      `${normParts};${normInputs}amix=inputs=${validFiles.length}:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11`;

    const args = [
      "-y",
      ...inputs,
      "-filter_complex", filterComplex,
      "-ac", "2",
      "-ar", "44100",
      "-codec:a", "libmp3lame",
      "-q:a", "3",
      mergedFile,
    ];

    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    ffmpeg.stderr.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line.toLowerCase().includes("error") || line.toLowerCase().includes("invalid")) {
        logger.warn(`ffmpeg merge: ${line}`);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        logger.info(`Merged: ${mergedFile}`);
        resolve(mergedFile);
      } else {
        logger.error(`Merge failed (code ${code})`);
        resolve(null);
      }
    });
  });
}

export function stopAllUserRecordings(session: RecordingSession): void {
  for (const [, stream] of session.activeStreams.entries()) {
    try {
      if (stream.stop) stream.stop();
      else stream.end();
    } catch { }
  }
  session.activeStreams.clear();
  logger.info(`Stopped all streams for guild ${session.guildId}`);
}

export function cleanOldRecordings(dir: string, maxAgeDays: number): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  const walkDir = (d: string) => {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        deleted++;
      }
    }
  };

  try {
    walkDir(dir);
    if (deleted > 0) logger.info(`Cleaned ${deleted} old file(s)`);
  } catch (err) {
    logger.warn(`Error cleaning old recordings: ${err}`);
  }
}

export function checkDiskSpace(dir: string): { freeGb: number; totalGb: number } {
  try {
    ensureDir(dir);
    const output = execSync(`df -BG "${dir}" | tail -1`).toString();
    const parts = output.trim().split(/\s+/);
    return {
      freeGb: parseInt(parts[3] ?? "0"),
      totalGb: parseInt(parts[1] ?? "0"),
    };
  } catch {
    return { freeGb: 999, totalGb: 999 };
  }
}
