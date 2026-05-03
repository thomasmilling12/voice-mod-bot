import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  VoiceConnection,
  DiscordGatewayAdapterCreator,
} from "@discordjs/voice";
import { VoiceChannel, GuildMember, Client, TextChannel, EmbedBuilder, AttachmentBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { config } from "./config";
import {
  RecordingSession,
  createSession,
  startUserRecording,
  stopAllUserRecordings,
  mergeRecordings,
  cleanOldRecordings,
  checkDiskSpace,
  getSessionDir,
} from "./recorder";

const activeSessions = new Map<string, RecordingSession>();
const lastJoinAttempt = new Map<string, number>();
const lastSessionEnd = new Map<string, number>();
const joinInProgress = new Set<string>();
type LastRecordingSummary = {
  duration: string;
  tracks: number;
  converted: number;
  failed: number;
  merged: boolean;
  uploaded: string;
  endedAt: Date;
};

const lastRecordingByGuild = new Map<string, LastRecordingSummary>();
const sessionCountByGuild = new Map<string, number>();

let botClient: Client | null = null;

export function startWatchdog(client: Client): void {
  if (config.watchdogIntervalHours <= 0) return;
  if (!config.heartbeatChannelId) {
    logger.info("Watchdog enabled but HEARTBEAT_CHANNEL_ID not set — heartbeats logged locally only");
  }
  const intervalMs = config.watchdogIntervalHours * 60 * 60 * 1000;
  setInterval(async () => {
    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    logger.info(`Heartbeat — uptime ${h}h ${m}m`);
    if (!config.heartbeatChannelId) return;
    try {
      const channel = await client.channels.fetch(config.heartbeatChannelId);
      if (channel instanceof TextChannel) {
        await channel.send(`**Bot heartbeat** — online and ready. Uptime: ${h}h ${m}m.`);
      }
    } catch (err) {
      logger.warn(`Watchdog ping failed: ${err}`);
    }
  }, intervalMs);
  logger.info(`Watchdog started — pinging every ${config.watchdogIntervalHours}h`);
}

export function pauseSession(guildId: string): void {
  const session = activeSessions.get(guildId);
  if (!session) return;
  session.paused = true;
  stopAllUserRecordings(session);
  logger.info(`Recording paused for guild ${guildId}`);
}

export function resumeSession(guildId: string): void {
  const session = activeSessions.get(guildId);
  if (!session) return;
  session.paused = false;
  logger.info(`Recording resumed for guild ${guildId}`);
}

export function setClient(client: Client): void {
  botClient = client;
  // Log which encryption library @discordjs/voice will use
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("libsodium-wrappers");
    logger.info("libsodium-wrappers loaded — AEAD encryption available");
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sod = require("sodium-native") as { sodium_version_string: () => string };
      logger.info(`sodium-native loaded (libsodium ${sod.sodium_version_string()}) — AEAD encryption available`);
    } catch {
      logger.warn("No AEAD crypto library loaded — voice will fail (tweetnacl only)");
    }
  }
}

export function getSession(guildId: string): RecordingSession | undefined {
  return activeSessions.get(guildId);
}

export function isRecording(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function getLastRecordingSummary(guildId: string): LastRecordingSummary | undefined {
  return lastRecordingByGuild.get(guildId);
}

export function getTotalSessionCount(guildId: string): number {
  return sessionCountByGuild.get(guildId) ?? 0;
}

function canAttemptJoin(guildId: string): boolean {
  const last = lastJoinAttempt.get(guildId) ?? 0;
  return Date.now() - last >= config.reconnectCooldownMs;
}

function isInSessionCooldown(guildId: string): boolean {
  const last = lastSessionEnd.get(guildId) ?? 0;
  return Date.now() - last < config.sessionCooldownMs;
}

async function postToLogChannel(guildId: string, embed: EmbedBuilder): Promise<void> {
  const targetChannelId = config.logChannelId ?? config.recordingChannelId;
  if (!botClient || !targetChannelId) return;
  try {
    const channel = await botClient.channels.fetch(targetChannelId);
    if (channel instanceof TextChannel) await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Could not post to log channel: ${err}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type UploadResult = {
  uploaded: number;
  skipped: string[];
  failed: string | null;
};

function formatRecordingStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function getUploadName(file: string, session: RecordingSession, index: number): string {
  const stamp = formatRecordingStamp(session.startedAt);
  const ext = path.extname(file);
  if (path.basename(file) === "merged.mp3") return `DIFF-meet-${stamp}-merged.mp3`;
  const role = file.includes("_host.") ? "host" : "guest";
  // Local filename format: safeName(displayName)_userId_timestamp_role.ext
  // Extract display name by finding the Discord snowflake (17-20 digit number)
  const baseName = path.basename(file, ext);
  const parts = baseName.split("_");
  const userIdIdx = parts.findIndex((p) => /^\d{17,20}$/.test(p));
  const displayPart = userIdIdx > 0 ? parts.slice(0, userIdIdx).join("-") : "user";
  return `DIFF-meet-${stamp}-track-${String(index).padStart(2, "0")}-${role}-${displayPart}${ext}`;
}

async function postRecordingFiles(
  session: RecordingSession,
  embed: EmbedBuilder,
  merged: string | null,
  metadataBuffer?: Buffer
): Promise<UploadResult> {
  if (!botClient || !config.recordingChannelId) {
    return { uploaded: 0, skipped: [], failed: "Recording channel is not configured." };
  }

  try {
    const channel = await botClient.channels.fetch(config.recordingChannelId);
    if (!(channel instanceof TextChannel)) {
      logger.warn(`Recording channel ${config.recordingChannelId} is not a text channel`);
      return { uploaded: 0, skipped: [], failed: "Recording channel is not a text channel." };
    }

    const uploadLimit = config.discordUploadLimitMb * 1024 * 1024;
    const candidates = [
      ...(merged ? [merged] : []),
      ...session.completedFiles.filter((file) => file !== merged),
    ].filter((file, index, all) => file && all.indexOf(file) === index && fs.existsSync(file));

    const uploadable: string[] = [];
    const skipped: string[] = [];

    for (const file of candidates) {
      const size = fs.statSync(file).size;
      if (size <= uploadLimit) uploadable.push(file);
      else skipped.push(`${path.basename(file)} (${formatBytes(size)})`);
    }

    if (skipped.length > 0) {
      embed.addFields({
        name: "Not Uploaded",
        value: skipped.slice(0, 5).join("\n"),
        inline: false,
      });
    }

    if (uploadable.length === 0) {
      await channel.send({ embeds: [embed] });
      return { uploaded: 0, skipped, failed: skipped.length > 0 ? "No files were small enough for Discord upload." : null };
    }

    const stamp = formatRecordingStamp(session.startedAt);
    let uploaded = 0;
    for (let i = 0; i < uploadable.length; i += 10) {
      const batch = uploadable.slice(i, i + 10);
      const extraFiles = i === 0 && metadataBuffer
        ? [new AttachmentBuilder(metadataBuffer, { name: `DIFF-meet-${stamp}-summary.txt` })]
        : [];
      await channel.send({
        content: i === 0 ? "Recording archive entry — files are attached below for download/listening:" : "Additional recording tracks:",
        embeds: i === 0 ? [embed] : [],
        files: [
          ...extraFiles,
          ...batch.map((file, batchIndex) => new AttachmentBuilder(file, { name: getUploadName(file, session, i + batchIndex + 1) })),
        ],
      });
      uploaded += batch.length;
    }

    if (config.deleteUploadedRecordings) {
      for (const file of uploadable) {
        try { fs.unlinkSync(file); } catch (err) { logger.warn(`Could not delete uploaded file ${file}: ${err}`); }
      }
      const sessionDir = getSessionDir(session);
      try {
        if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir);
      } catch (err) {
        logger.warn(`Could not delete empty session folder ${sessionDir}: ${err}`);
      }
    }

    return { uploaded, skipped, failed: null };
  } catch (err) {
    logger.warn(`Could not upload recording files: ${err}`);
    return { uploaded: 0, skipped: [], failed: err instanceof Error ? err.message : String(err) };
  }
}

async function postRecordingAlert(message: string): Promise<void> {
  if (!botClient || !config.recordingChannelId) return;
  try {
    const channel = await botClient.channels.fetch(config.recordingChannelId);
    if (channel instanceof TextChannel) {
      await channel.send(`**Recording alert**\n${message.slice(0, 1800)}`);
    }
  } catch (err) {
    logger.warn(`Could not post recording alert: ${err}`);
  }
}

async function dmHosts(session: RecordingSession, message: string): Promise<void> {
  if (!botClient) return;
  for (const hostId of session.hostIds) {
    try {
      const user = await botClient.users.fetch(hostId);
      await user.send(message);
    } catch (err) {
      logger.warn(`Could not DM host ${hostId}: ${err}`);
    }
  }
}

export async function joinAndRecord(
  channel: VoiceChannel,
  hostIds: Set<string>,
  client: Client,
  customDurationMinutes?: number
): Promise<{ success: boolean; message: string }> {
  if (config.voiceDisabled) {
    return {
      success: false,
      message: "Voice recording is handled by the Pi — make sure it is online and running the bot.",
    };
  }

  const guildId = channel.guild.id;

  if (joinInProgress.has(guildId)) {
    return { success: false, message: "Already attempting to join — please wait a moment." };
  }

  if (activeSessions.has(guildId)) {
    return { success: false, message: "Already recording in this server." };
  }

  if (!canAttemptJoin(guildId)) {
    return { success: false, message: "Please wait a moment before trying to join again." };
  }

  if (isInSessionCooldown(guildId)) {
    const remaining = Math.ceil(
      (config.sessionCooldownMs - (Date.now() - (lastSessionEnd.get(guildId) ?? 0))) / 1000
    );
    return { success: false, message: `Session cooldown — please wait ${remaining}s before starting a new recording.` };
  }

  const { freeGb } = checkDiskSpace(config.recordingsDir);
  if (freeGb < config.diskWarningGb) {
    logger.warn(`Low disk space: ${freeGb}GB free`);
    await postToLogChannel(guildId, new EmbedBuilder()
      .setTitle("Low Disk Space Warning")
      .setColor(0xff9900)
      .setDescription(`Only **${freeGb}GB** free on the Pi. Recordings may fail soon.`)
    );
  }

  lastJoinAttempt.set(guildId, Date.now());
  joinInProgress.add(guildId);

  // Destroy any stale voice connection left over from a previous failed attempt.
  // destroy() already sends a VoiceStateUpdate(leave) to Discord — no need for
  // a separate op:4 leave, which would cause duplicate leave signals and allow
  // stale VOICE_SERVER_UPDATE events to arrive before the fresh join.
  const stale = getVoiceConnection(guildId);
  if (stale) {
    logger.warn(`Destroying stale voice connection for guild ${guildId} before joining`);
    try { stale.destroy(); } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }

  let connection: VoiceConnection;
  try {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    connection.on("stateChange", (old, next) => {
      logger.info(`Voice state: ${old.status} → ${next.status}`);
    });

    connection.on("debug", (msg) => {
      logger.info(`[Voice dbg] ${msg}`);
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    joinInProgress.delete(guildId);
    const detail = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to join voice channel: ${detail}`);
    try { connection!.destroy(); } catch { }
    return { success: false, message: `Failed to join the voice channel (${detail}).` };
  }

  joinInProgress.delete(guildId);

  const session = createSession(guildId, channel.id, hostIds);
  if (customDurationMinutes) session.customMaxMs = customDurationMinutes * 60_000;
  activeSessions.set(guildId, session);

  logger.info(`Joined ${channel.name} in ${channel.guild.name}, hosts=[${[...hostIds].join(",")}]`);

  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (session.activeStreams.has(userId)) return;
    session.stats.startSpeaking(userId);
    const member = channel.guild.members.cache.get(userId) as GuildMember | null;
    startUserRecording(receiver, userId, member, session);
  });

  receiver.speaking.on("end", (userId) => {
    session.stats.stopSpeaking(userId);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    logger.warn(`Disconnected in guild ${guildId}. Attempting recovery...`);
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      logger.error(`Could not recover voice connection for ${guildId}`);
      await leaveAndStop(guildId, client);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    // leaveAndStop deletes the session before calling destroy(), so if the
    // session still exists here the connection was destroyed externally (bot
    // kicked, server outage, etc.). Salvage the recording.
    if (activeSessions.has(guildId)) {
      logger.warn(`Connection destroyed externally for ${guildId} — salvaging recording`);
      leaveAndStop(guildId, botClient ?? undefined);
    }
  });

  setupSilenceTimeout(guildId, connection, client);
  setupMaxDurationTimeout(guildId, client);

  const hostNames = [...hostIds]
    .map((id) => channel.guild.members.cache.get(id)?.displayName ?? id)
    .join(", ");

  await postToLogChannel(guildId, new EmbedBuilder()
    .setTitle("Recording Started")
    .setColor(0x00cc44)
    .addFields(
      { name: "Channel", value: channel.name, inline: true },
      { name: "Host(s)", value: hostNames || "None set", inline: true },
    )
    .setTimestamp()
  );

  return { success: true, message: `Recording started in **${channel.name}**.` };
}

function setupMaxDurationTimeout(guildId: string, client: Client): void {
  const session = activeSessions.get(guildId);
  const maxMs = session?.customMaxMs ?? config.maxRecordingMs;
  if (!session || maxMs <= 0) return;
  session.stopTimer = setTimeout(() => {
    const current = activeSessions.get(guildId);
    if (!current) return;
    current.stopReason = `Auto-stopped after max duration (${Math.round(maxMs / 60_000)} minutes).`;
    logger.warn(current.stopReason);
    leaveAndStop(guildId, client);
  }, maxMs);
}

function setupSilenceTimeout(guildId: string, connection: VoiceConnection, client: Client): void {
  let lastActivity = Date.now();

  const interval = setInterval(() => {
    const session = activeSessions.get(guildId);
    if (!session) { clearInterval(interval); return; }
    const idleMs = Date.now() - lastActivity;
    if (idleMs > config.maxSilenceMs && session.activeStreams.size === 0) {
      logger.info(`Silence timeout in ${guildId}, auto-leaving`);
      clearInterval(interval);
      leaveAndStop(guildId, client);
    }
  }, 30_000);

  const session = activeSessions.get(guildId);
  if (session) {
    const origSet = session.activeStreams.set.bind(session.activeStreams);
    session.activeStreams.set = new Proxy(session.activeStreams.set, {
      apply(target, thisArg, args) {
        lastActivity = Date.now();
        return Reflect.apply(target, thisArg, args);
      },
    });
    void origSet;
  }
}

export async function leaveAndStop(
  guildId: string,
  client?: Client
): Promise<{ success: boolean; message: string; files: string[] }> {
  const session = activeSessions.get(guildId);
  if (!session) {
    return { success: false, message: "Not currently recording.", files: [] };
  }

  stopAllUserRecordings(session);
  activeSessions.delete(guildId);
  if (session.stopTimer) clearTimeout(session.stopTimer);
  lastSessionEnd.set(guildId, Date.now());

  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();

  const durationMs = Date.now() - session.startedAt.getTime();
  const durationMin = Math.floor(durationMs / 60_000);
  const durationSec = Math.floor((durationMs % 60_000) / 1000);
  const count = session.files.length;

  logger.info(`Left guild ${guildId}. ${count} track(s) queued for processing.`);

  const c = client ?? botClient;
  if (c) {
    (async () => {
      logger.info("Waiting for all track conversions to finish...");
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 120_000));
      await Promise.race([Promise.allSettled(session.conversions), timeout]);
      const convertedCount = session.completedFiles.length;

      logger.info("Merging tracks...");
      const merged = await mergeRecordings(session);
      const failedCount = Math.max(0, count - convertedCount - session.skippedTracks);

      const hostNames = [...session.hostIds]
        .map((id) => {
          try { return c.users.cache.get(id)?.username ?? id; } catch { return id; }
        })
        .join(", ");

      const topSpeaker = session.stats.getTopSpeaker();
      const topName = topSpeaker
        ? (c.users.cache.get(topSpeaker)?.username ?? topSpeaker)
        : "N/A";
      const uploadedCandidates = [
        ...(merged ? [merged] : []),
        ...session.completedFiles.filter((file) => file !== merged),
      ].filter((file, index, all) => file && all.indexOf(file) === index && fs.existsSync(file));
      const totalBytes = uploadedCandidates.reduce((acc, file) => {
        try { return acc + fs.statSync(file).size; } catch { return acc; }
      }, 0);
      const sizeSummary = uploadedCandidates.length > 0 ? formatBytes(totalBytes) : "0 KB";
      const duration = `${durationMin}m ${durationSec}s`;
      const safeMergedName = merged ? path.basename(merged) : null;

      if (convertedCount === 0 || uploadedCandidates.length === 0) {
        const message = `Empty recording discarded: ${duration}, ${count} track(s), ${convertedCount} converted. No usable audio was uploaded.`;
        logger.warn(message);
        if (config.notifyHostDm) await dmHosts(session, `**Recording discarded**\n${message}`);
        await postRecordingAlert(message);
        if (config.deleteUploadedRecordings) {
          try { fs.rmSync(getSessionDir(session), { recursive: true, force: true }); } catch (err) { logger.warn(`Could not remove empty session folder: ${err}`); }
        }
        lastRecordingByGuild.set(guildId, {
          duration,
          tracks: count,
          converted: convertedCount,
          failed: failedCount,
          merged: false,
          uploaded: "0 file(s), discarded empty recording",
          endedAt: new Date(),
        });
        cleanOldRecordings(config.recordingsDir, config.maxRecordingAgeDays);
        return;
      }

      const dmLines = [
        `**Recording complete!**`,
        session.stopReason ? `Stop reason: ${session.stopReason}` : "",
        `Duration: ${duration}`,
        `Tracks: ${count}`,
        `Converted: ${convertedCount}`,
        failedCount > 0 ? `Failed conversions: ${failedCount}` : "",
        `Total size: ${sizeSummary}`,
        safeMergedName ? `Merged file: \`${safeMergedName}\`` : "",
        `Files are posted in <#${config.recordingChannelId}> when upload succeeds.`,
      ].filter(Boolean).join("\n");

      if (config.notifyHostDm) await dmHosts(session, dmLines);

      const topSpeakers = session.stats.getSortedSpeakers().slice(0, 5);
      const leaderboard = topSpeakers.length > 0
        ? topSpeakers.map(({ userId, ms }, i) => {
            const name = c.users.cache.get(userId)?.username ?? userId;
            return `${i + 1}. ${name} — ${session.stats.formatDuration(ms)}`;
          }).join("\n")
        : "N/A";

      const completionEmbed = new EmbedBuilder()
        .setTitle("Recording Saved")
        .setColor(0xcc0000)
        .setDescription("Download or listen from the attached files on this Discord message.")
        .addFields(
          { name: "Duration", value: duration, inline: true },
          { name: "Tracks", value: String(count), inline: true },
          { name: "Converted", value: String(convertedCount), inline: true },
          { name: "Host(s)", value: hostNames || "None", inline: true },
          { name: "Merged File", value: merged ? "Saved" : "Not created", inline: true },
          { name: "Total Size", value: sizeSummary, inline: true },
          ...(failedCount > 0 ? [{ name: "Failed", value: String(failedCount), inline: true }] : []),
          ...(session.skippedTracks > 0 ? [{ name: "Short tracks skipped", value: String(session.skippedTracks), inline: true }] : []),
          ...(session.stopReason ? [{ name: "Stop Reason", value: session.stopReason, inline: false }] : []),
          { name: "Top Speakers", value: leaderboard, inline: false },
        )
        .setTimestamp();

      if (!merged && convertedCount > 0) {
        await postRecordingAlert(`Warning: recording finished but no merged file was created.`);
      }

      // Generate metadata summary text file
      const allSpeakers = session.stats.getSortedSpeakers();
      const speakerLines = allSpeakers.length > 0
        ? allSpeakers.map(({ userId, ms }, i) => {
            const name = c.users.cache.get(userId)?.username ?? userId;
            return `  ${i + 1}. ${name} — ${session.stats.formatDuration(ms)}`;
          }).join("\n")
        : "  (no speaker data)";

      const metadataText = [
        "DIFF Car Meet Recording",
        "=".repeat(40),
        `Date:      ${session.startedAt.toUTCString()}`,
        `Duration:  ${duration}`,
        `Host(s):   ${hostNames || "None"}`,
        `Channel:   ${session.guildId}`,
        `Tracks:    ${count} recorded, ${convertedCount} converted, ${session.skippedTracks} short-skipped, ${failedCount} failed`,
        `Merged:    ${merged ? "Yes" : "No"}`,
        `Total size: ${sizeSummary}`,
        ...(session.stopReason ? [`Stop reason: ${session.stopReason}`] : []),
        "",
        "Speaking Time",
        "-".repeat(40),
        speakerLines,
      ].join("\n");
      const metadataBuffer = Buffer.from(metadataText, "utf8");

      const uploadResult = await postRecordingFiles(session, completionEmbed, merged, metadataBuffer);
      if (uploadResult.failed) {
        await postRecordingAlert(`Upload problem: ${uploadResult.failed}`);
      }

      sessionCountByGuild.set(guildId, (sessionCountByGuild.get(guildId) ?? 0) + 1);
      lastRecordingByGuild.set(guildId, {
        duration,
        tracks: count,
        converted: convertedCount,
        failed: failedCount,
        merged: !!merged,
        uploaded: `${uploadResult.uploaded} file(s)${uploadResult.skipped.length ? `, ${uploadResult.skipped.length} skipped` : ""}`,
        endedAt: new Date(),
      });

      cleanOldRecordings(config.recordingsDir, config.maxRecordingAgeDays);
    })().catch((err) => logger.error(`Post-session error: ${err}`));
  }

  return {
    success: true,
    message: `Recording stopped. ${count} track(s) being processed — you'll get a DM when the merge is done.`,
    files: session.files,
  };
}
