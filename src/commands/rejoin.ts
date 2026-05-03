import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  VoiceChannel,
  GuildMember,
  ChannelType,
} from "discord.js";
import { joinAndRecord, isRecording, getLastChannel } from "../voiceManager";
import { config } from "../config";
import { logger } from "../logger";

export const data = new SlashCommandBuilder()
  .setName("rejoin")
  .setDescription("Rejoin the last voice channel and resume recording (use after a crash or restart).");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("Must be used in a server."); return; }

  if (isRecording(guild.id)) {
    await interaction.editReply("Already recording. Use `/endrecord` to stop first.");
    return;
  }

  const last = getLastChannel(guild.id);
  if (!last) {
    await interaction.editReply("No previous channel on record — use `/record` to start a new session.");
    return;
  }

  const channel = guild.channels.cache.get(last.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.editReply(`Previous channel **${last.channelName}** no longer exists or is not a voice channel.`);
    return;
  }

  const member = interaction.member as GuildMember;
  const hostIds = new Set([member.id]);
  logger.info(`/rejoin: ${member.displayName} → ${channel.name}`);

  const result = await joinAndRecord(channel as VoiceChannel, hostIds, interaction.client);

  if (!result.success) {
    await interaction.editReply(result.message);
    return;
  }

  const channelMention = config.recordingChannelId ? `<#${config.recordingChannelId}>` : "the recording channel";
  await interaction.editReply(
    `Rejoined **${channel.name}** and started recording.\n` +
    `Files will be posted in ${channelMention} when done. Use \`/endrecord\` to stop.`
  );
}
