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

let botClient: Client | null = null;

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

function canAttemptJoin(guildId: string): boolean {
  const last = lastJoinAttempt.get(guildId) ?? 0;
  return Date.now() - last >= config.reconnectCooldownMs;
}

function isInSessionCooldown(guildId: string): boolean {
  const last = lastSessionEnd.get(guildId) ?? 0;
  return Date.now() - last < config.sessionCooldownMs;
}

async function postToLogChannel(guildId: string, embed: EmbedBuilder): Promise<void> {
  if (!botClient || !config.logChannelId) return;
  try {
    const channel = await botClient.channels.fetch(config.logChannelId);
    if (channel instanceof TextChannel) await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Could not post to log channel: ${err}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function postRecordingFiles(
  session: RecordingSession,
  embed: EmbedBuilder,
  merged: string | null
): Promise<void> {
  if (!botClient || !config.recordingChannelId) return;

  try {
    const channel = await botClient.channels.fetch(config.recordingChannelId);
    if (!(channel instanceof TextChannel)) {
      logger.warn(`Recording channel ${config.recordingChannelId} is not a text channel`);
      return;
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
      return;
    }

    for (let i = 0; i < uploadable.length; i += 10) {
      const batch = uploadable.slice(i, i + 10);
      await channel.send({
        content: i === 0 ? "Recording files ready to download/listen:" : "Additional recording tracks:",
        embeds: i === 0 ? [embed] : [],
        files: batch.map((file) => new AttachmentBuilder(file, { name: path.basename(file) })),
      });
    }
  } catch (err) {
    logger.warn(`Could not upload recording files: ${err}`);
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
  client: Client
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
    const s = activeSessions.get(guildId);
    if (s) {
      stopAllUserRecordings(s);
      activeSessions.delete(guildId);
    }
  });

  setupSilenceTimeout(guildId, connection, client);

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
      const sessionDir = getSessionDir(session);

      const hostNames = [...session.hostIds]
        .map((id) => {
          try { return c.users.cache.get(id)?.username ?? id; } catch { return id; }
        })
        .join(", ");

      const topSpeaker = session.stats.getTopSpeaker();
      const topName = topSpeaker
        ? (c.users.cache.get(topSpeaker)?.username ?? topSpeaker)
        : "N/A";

      const dmLines = [
        `**Recording complete!**`,
        `Duration: ${durationMin}m ${durationSec}s`,
        `Tracks: ${count}`,
        `Converted: ${convertedCount}`,
        merged ? `Merged file: \`${merged}\`` : "",
        `Session folder: \`${sessionDir}\``,
      ].filter(Boolean).join("\n");

      await dmHosts(session, dmLines);

      const completionEmbed = new EmbedBuilder()
        .setTitle("Recording Finished")
        .setColor(0xcc0000)
        .addFields(
          { name: "Duration", value: `${durationMin}m ${durationSec}s`, inline: true },
          { name: "Tracks", value: String(count), inline: true },
          { name: "Converted", value: String(convertedCount), inline: true },
          { name: "Host(s)", value: hostNames || "None", inline: true },
          { name: "Top Speaker", value: topName, inline: true },
          { name: "Merged File", value: merged ? "Saved" : "Not created", inline: true },
        )
        .setTimestamp();

      await postRecordingFiles(session, completionEmbed, merged);

      cleanOldRecordings(config.recordingsDir, config.maxRecordingAgeDays);
    })().catch((err) => logger.error(`Post-session error: ${err}`));
  }

  return {
    success: true,
    message: `Recording stopped. ${count} track(s) being processed — you'll get a DM when the merge is done.`,
    files: session.files,
  };
}
