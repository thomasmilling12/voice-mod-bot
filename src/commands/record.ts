import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  VoiceChannel,
  GuildMember,
} from "discord.js";
import { joinAndRecord, isRecording } from "../voiceManager";
import { logger } from "../logger";

export const data = new SlashCommandBuilder()
  .setName("record")
  .setDescription("Start recording — joins your current voice channel and sets you as host.");

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

  const hostIds = new Set([member.id]);
  logger.info(`/record: ${member.displayName} → ${channel.name}`);

  const result = await joinAndRecord(channel, hostIds, interaction.client);
  await interaction.editReply(result.success
    ? `Recording started in **${channel.name}**. Use \`/endrecord\` to stop.`
    : result.message
  );
}
