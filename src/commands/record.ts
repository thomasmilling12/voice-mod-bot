import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  VoiceChannel,
  GuildMember,
} from "discord.js";
import { joinAndRecord, isRecording } from "../voiceManager";
import { config } from "../config";
import { logger } from "../logger";

export const data = new SlashCommandBuilder()
  .setName("record")
  .setDescription("Start recording — joins your current voice channel and sets you as host.")
  .addIntegerOption((opt) =>
    opt
      .setName("duration")
      .setDescription("Auto-stop after this many minutes (overrides server default)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(480)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("This command must be used in a server."); return; }
  if (isRecording(guild.id)) { await interaction.editReply("Already recording. Use `/endrecord` to stop first."); return; }

  const member = interaction.member as GuildMember;
  if (!member.voice?.channelId) {
    await interaction.editReply("You need to be in a voice channel first.");
    return;
  }

  const channel = guild.channels.cache.get(member.voice.channelId) as VoiceChannel | null;
  if (!channel) { await interaction.editReply("Could not find your voice channel."); return; }

  const customDuration = interaction.options.getInteger("duration") ?? undefined;
  const hostIds = new Set([member.id]);
  logger.info(`/record: ${member.displayName} → ${channel.name}${customDuration ? ` (${customDuration} min)` : ""}`);

  const result = await joinAndRecord(channel, hostIds, interaction.client, customDuration);

  if (!result.success) {
    await interaction.editReply(result.message);
    return;
  }

  const channelMention = config.recordingChannelId ? `<#${config.recordingChannelId}>` : "the recording channel";
  const durationNote = customDuration
    ? ` Auto-stops in **${customDuration} min**.`
    : "";

  await interaction.editReply(
    `Recording started in **${channel.name}**.${durationNote}\n` +
    `Files will be posted in ${channelMention} when done. Use \`/endrecord\` to stop early.`
  );
}
