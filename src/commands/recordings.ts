import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { config } from "../config";
import { getTotalSessionCount, getLastRecordingSummary } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("recordings")
  .setDescription("Show recording history and link to the archive channel.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("Must be used in a server."); return; }

  const channelMention = config.recordingChannelId
    ? `<#${config.recordingChannelId}>`
    : "the private recording channel";

  const totalSessions = getTotalSessionCount(guild.id);
  const last = getLastRecordingSummary(guild.id);

  const embed = new EmbedBuilder()
    .setTitle("Recording Archive")
    .setColor(0x5865f2)
    .setDescription(
      `All recordings are stored in ${channelMention}.\n` +
      "Search for messages titled **Recording Saved** to find past sessions — tracks and merged MP3s are attached directly."
    )
    .addFields(
      { name: "Total Sessions", value: String(totalSessions), inline: true },
    );

  if (last) {
    embed.addFields({
      name: "Last Session",
      value: [
        `Duration: ${last.duration}`,
        `Tracks: ${last.tracks} (${last.converted} converted)`,
        `Merged: ${last.merged ? "Yes" : "No"}`,
        `Uploaded: ${last.uploaded}`,
        `Ended: <t:${Math.floor(last.endedAt.getTime() / 1000)}:R>`,
      ].join("\n"),
      inline: false,
    });
  }

  embed.setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
