import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("download")
  .setDescription("Find the latest recording — directs you to the archive channel.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channelMention = config.recordingChannelId
    ? `<#${config.recordingChannelId}>`
    : "the private recording channel";

  const embed = new EmbedBuilder()
    .setTitle("Recordings are in the archive channel")
    .setColor(0x5865f2)
    .setDescription(
      `All recordings are automatically uploaded to ${channelMention} at the end of each session.\n\n` +
      "Look for a message titled **Recording Saved** — the merged MP3 and individual tracks are attached directly to that message for download or listening."
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
