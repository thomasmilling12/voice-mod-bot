import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  TextChannel,
} from "discord.js";
import type { ChatInputCommandInteraction, VoiceChannel } from "discord.js";
import { logger } from "./logger";
import { config } from "./config";
import { commands, registerSlashCommands } from "./commandRegistry";
import { isRecording, getSession, joinAndRecord, leaveAndStop, setClient } from "./voiceManager";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

async function sendCrashAlert(err: unknown): Promise<void> {
  if (!config.alertChannelId) return;
  try {
    const channel = await client.channels.fetch(config.alertChannelId);
    if (channel instanceof TextChannel) {
      await channel.send(`**Bot crashed!**\n\`\`\`${String(err).slice(0, 1500)}\`\`\``);
    }
  } catch { }
}

process.on("uncaughtException", async (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  await sendCrashAlert(err).catch(() => { });
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
  await sendCrashAlert(reason).catch(() => { });
});

client.once(Events.ClientReady, async (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  setClient(c);
  await registerSlashCommands(c.user.id);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild ?? oldState.guild;
  const guildId = guild.id;

  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const joinedChannel = newState.channelId && !oldState.channelId;
  const leftChannel = !newState.channelId && !!oldState.channelId;
  const movedChannel = newState.channelId && oldState.channelId && newState.channelId !== oldState.channelId;

  if ((joinedChannel || movedChannel) && !isRecording(guildId)) {
    const channel = newState.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) return;
    if (config.ignoredChannelIds.has(channel.id)) return;

    logger.info(`Auto-join: ${member.displayName} joined ${channel.name}`);
    const hostIds = new Set([member.id]);
    const result = await joinAndRecord(channel as VoiceChannel, hostIds, client);
    if (result.success) logger.info(`Auto-joined ${channel.name}`);
    else logger.info(`Auto-join skipped: ${result.message}`);
    return;
  }

  if ((leftChannel || movedChannel) && isRecording(guildId)) {
    const session = getSession(guildId);
    const departedChannelId = oldState.channelId;
    if (!session || departedChannelId !== session.channelId) return;

    const botChannel = guild.channels.cache.get(session.channelId);
    if (!botChannel || botChannel.type !== ChannelType.GuildVoice) return;

    const humansRemaining = (botChannel as VoiceChannel).members.filter((m) => !m.user.bot).size;
    if (humansRemaining === 0) {
      logger.info(`Last person left ${botChannel.name}, auto-leaving...`);
      await leaveAndStop(guildId, client);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction as ChatInputCommandInteraction);
  } catch (err) {
    logger.error(`Error in command ${interaction.commandName}: ${err}`);
    const reply = { content: "An error occurred.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => { });
    } else {
      await interaction.reply(reply).catch(() => { });
    }
  }
});

client.on(Events.Error, (err) => {
  logger.error(`Client error: ${err.message}`);
});

process.on("SIGINT", () => { logger.info("Shutting down..."); client.destroy(); process.exit(0); });
process.on("SIGTERM", () => { logger.info("Shutting down (SIGTERM)..."); client.destroy(); process.exit(0); });

client.login(config.token).catch((err) => {
  logger.error(`Login failed: ${err.message}`);
  process.exit(1);
});
