import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  VoiceConnection,
  DiscordGatewayAdapterCreator,
} from "@discordjs/voice";
import { VoiceChannel, GuildMember, Client } from "discord.js";
import { logger } from "./logger";
import { config } from "./config";
import {
  RecordingSession,
  createSession,
  startUserRecording,
  stopAllUserRecordings,
} from "./recorder";

const activeSessions = new Map<string, RecordingSession>();
const lastJoinAttempt = new Map<string, number>();

export function getSession(guildId: string): RecordingSession | undefined {
  return activeSessions.get(guildId);
}

export function isRecording(guildId: string): boolean {
  return activeSessions.has(guildId);
}

function canAttemptJoin(guildId: string): boolean {
  const lastAttempt = lastJoinAttempt.get(guildId) ?? 0;
  return Date.now() - lastAttempt >= config.reconnectCooldownMs;
}

export async function joinAndRecord(
  channel: VoiceChannel,
  hostId: string | null,
  client: Client
): Promise<{ success: boolean; message: string }> {
  const guildId = channel.guild.id;

  if (activeSessions.has(guildId)) {
    return { success: false, message: "Already recording in this server." };
  }

  if (!canAttemptJoin(guildId)) {
    return {
      success: false,
      message: "Please wait a moment before trying to join again.",
    };
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
    return {
      success: false,
      message: "Failed to join the voice channel. Check my permissions.",
    };
  }

  const session = createSession(guildId, channel.id, hostId);
  activeSessions.set(guildId, session);

  logger.info(`Joined ${channel.name} in ${channel.guild.name}, hostId=${hostId}`);

  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (session.activeStreams.has(userId)) return;
    const member = channel.guild.members.cache.get(userId) as GuildMember | null;
    const isHost = userId === hostId;
    startUserRecording(receiver, userId, member, session, isHost);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    logger.warn(`Disconnected in guild ${guildId}. Attempting recovery...`);
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      logger.error(`Could not recover voice connection for ${guildId}, leaving.`);
      await leaveAndStop(guildId);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    logger.info(`Connection destroyed for guild ${guildId}`);
    const s = activeSessions.get(guildId);
    if (s) {
      stopAllUserRecordings(s);
      activeSessions.delete(guildId);
    }
  });

  setupSilenceTimeout(guildId, connection);

  return { success: true, message: `Recording started in **${channel.name}**.` };
}

function setupSilenceTimeout(guildId: string, connection: VoiceConnection): void {
  let lastActivity = Date.now();

  const interval = setInterval(() => {
    const session = activeSessions.get(guildId);
    if (!session) {
      clearInterval(interval);
      return;
    }
    const silent = Date.now() - lastActivity > config.maxSilenceMs;
    if (silent && session.activeStreams.size === 0) {
      logger.info(`No activity for ${config.maxSilenceMs}ms in ${guildId}, auto-leaving.`);
      clearInterval(interval);
      leaveAndStop(guildId);
    }
  }, 30_000);

  const session = activeSessions.get(guildId);
  if (session) {
    const origGet = session.activeStreams.get.bind(session.activeStreams);
    session.activeStreams.set = new Proxy(session.activeStreams.set, {
      apply(target, thisArg, args) {
        lastActivity = Date.now();
        return Reflect.apply(target, thisArg, args);
      },
    });
  }
}

export async function leaveAndStop(
  guildId: string
): Promise<{ success: boolean; message: string; files: string[] }> {
  const session = activeSessions.get(guildId);
  if (!session) {
    return { success: false, message: "Not currently recording.", files: [] };
  }

  stopAllUserRecordings(session);
  activeSessions.delete(guildId);

  const connection = getVoiceConnection(guildId);
  if (connection) {
    connection.destroy();
  }

  const count = session.files.length;
  logger.info(`Left voice channel in guild ${guildId}, ${count} file(s) queued.`);
  return {
    success: true,
    message: `Recording stopped. ${count} track(s) saved.`,
    files: session.files,
  };
}
