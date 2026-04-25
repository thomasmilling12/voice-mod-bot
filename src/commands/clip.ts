import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("clip")
  .setDescription("Find a recording clip — directs you to the archive channel.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channelMention = config.recordingChannelId
    ? `<#${config.recordingChannelId}>`
    : "the private recording channel";

  const embed = new EmbedBuilder()
    .setTitle("Recordings are uploaded directly to Discord")
    .setColor(0x5865f2)
    .setDescription(
      `All merged recordings and individual tracks are posted to ${channelMention} at the end of each session.\n\n` +
      "To clip a section, download the merged MP3 from that channel and use any audio editor (Audacity, etc.) to cut the part you need."
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
