import {
  VoiceReceiver,
  EndBehaviorType,
  VoiceConnection,
} from "@discordjs/voice";
import { GuildMember } from "discord.js";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { config } from "./config";
import { logger } from "./logger";

export interface RecordingSession {
  guildId: string;
  channelId: string;
  startedAt: Date;
  hostId: string | null;
  files: string[];
  activeStreams: Map<string, NodeJS.WritableStream>;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
}

export function startUserRecording(
  receiver: VoiceReceiver,
  userId: string,
  member: GuildMember | null,
  session: RecordingSession,
  isHost: boolean
): void {
  if (session.activeStreams.has(userId)) return;

  const displayName = member?.displayName ?? userId;
  const guildDir = path.join(config.recordingsDir, safeName(session.guildId));
  const sessionDir = path.join(
    guildDir,
    `session_${session.startedAt.toISOString().replace(/[:.]/g, "-")}`
  );
  ensureDir(sessionDir);

  const rawFile = path.join(
    sessionDir,
    `${safeName(displayName)}_${userId}_${isHost ? "host" : "guest"}.opus`
  );
  const outputFile = path.join(
    sessionDir,
    `${safeName(displayName)}_${userId}_${isHost ? "host" : "guest"}.ogg`
  );

  logger.info(`Starting recording for ${displayName} (host=${isHost})`);

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 1000,
    },
  });

  const rawStream = fs.createWriteStream(rawFile);
  opusStream.pipe(rawStream);

  session.activeStreams.set(userId, rawStream);
  session.files.push(outputFile);

  opusStream.on("end", () => {
    rawStream.end();
    session.activeStreams.delete(userId);
    convertOpusToOgg(rawFile, outputFile, isHost, displayName);
  });

  opusStream.on("error", (err) => {
    logger.error(`Stream error for ${displayName}: ${err.message}`);
    rawStream.end();
    session.activeStreams.delete(userId);
  });
}

function convertOpusToOgg(
  rawFile: string,
  outputFile: string,
  isHost: boolean,
  displayName: string
): void {
  const ffmpegArgs = buildFfmpegArgs(rawFile, outputFile, isHost);
  logger.info(`Converting recording for ${displayName}...`);

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });

  ffmpeg.stderr.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line.includes("error") || line.includes("Error")) {
      logger.warn(`ffmpeg: ${line}`);
    }
  });

  ffmpeg.on("close", (code) => {
    if (code === 0) {
      logger.info(`Saved recording: ${outputFile}`);
      fs.unlink(rawFile, () => {});
    } else {
      logger.error(`ffmpeg exited with code ${code} for ${displayName}`);
    }
  });
}

function buildFfmpegArgs(
  rawFile: string,
  outputFile: string,
  isHost: boolean
): string[] {
  const base = ["-y", "-f", "opus", "-i", rawFile];

  if (isHost) {
    const { highpassHz, lowpassHz, compressorThresholdDb, normalizeTarget } =
      config.hostClearness;
    const filter = [
      `highpass=f=${highpassHz}`,
      `lowpass=f=${lowpassHz}`,
      `acompressor=threshold=${compressorThresholdDb}dB:ratio=4:attack=5:release=50`,
      `loudnorm=I=${normalizeTarget}:TP=-1.5:LRA=11`,
    ].join(",");
    return [...base, "-af", filter, "-c:a", "libvorbis", "-q:a", "6", outputFile];
  }

  return [...base, "-c:a", "libvorbis", "-q:a", "4", outputFile];
}

export function stopAllUserRecordings(session: RecordingSession): void {
  for (const [userId, stream] of session.activeStreams.entries()) {
    try {
      (stream as NodeJS.WritableStream).end();
    } catch {}
    session.activeStreams.delete(userId);
  }
  logger.info(`Stopped all active streams for session in guild ${session.guildId}`);
}

export function createSession(
  guildId: string,
  channelId: string,
  hostId: string | null
): RecordingSession {
  return {
    guildId,
    channelId,
    startedAt: new Date(),
    hostId,
    files: [],
    activeStreams: new Map(),
  };
}
