import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  VoiceConnection,
  DiscordGatewayAdapterCreator,
} from "@discordjs/voice";
import { VoiceChannel, GuildMember, Client, TextChannel, EmbedBuilder } from "discord.js";
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

let botClient: Client | null = null;

export function setClient(client: Client): void {
  botClient = client;
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

  let connection: VoiceConnection;
  try {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err) {
    logger.error(`Failed to join voice channel: ${err}`);
    return { success: false, message: "Failed to join the voice channel. Check my permissions." };
  }

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
        merged ? `Merged file: \`${merged}\`` : "",
        `Session folder: \`${sessionDir}\``,
      ].filter(Boolean).join("\n");

      await dmHosts(session, dmLines);

      await postToLogChannel(guildId, new EmbedBuilder()
        .setTitle("Recording Finished")
        .setColor(0xcc0000)
        .addFields(
          { name: "Duration", value: `${durationMin}m ${durationSec}s`, inline: true },
          { name: "Tracks", value: String(count), inline: true },
          { name: "Host(s)", value: hostNames || "None", inline: true },
          { name: "Top Speaker", value: topName, inline: true },
          { name: "Merged File", value: merged ? "Saved" : "N/A (1 track)", inline: true },
        )
        .setTimestamp()
      );

      cleanOldRecordings(config.recordingsDir, config.maxRecordingAgeDays);
    })().catch((err) => logger.error(`Post-session error: ${err}`));
  }

  return {
    success: true,
    message: `Recording stopped. ${count} track(s) being processed — you'll get a DM when the merge is done.`,
    files: session.files,
  };
}
