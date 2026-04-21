import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getLastRecordingSummary, getSession, isRecording } from "../voiceManager";
import { checkDiskSpace } from "../recorder";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show current recording session status.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }
  if (!isRecording(guild.id)) {
    const { freeGb } = checkDiskSpace(config.recordingsDir);
    const last = getLastRecordingSummary(guild.id);
    const embed = new EmbedBuilder()
      .setTitle("Recording Status")
      .setColor(0x00cc44)
      .addFields(
        { name: "Current Recording", value: "Not recording", inline: true },
        { name: "Disk Free", value: `${freeGb}GB`, inline: true },
        { name: "Max Duration", value: `${Math.round(config.maxRecordingMs / 60_000)} minutes`, inline: true },
        ...(last
          ? [{
            name: "Last Recording",
            value: `${last.duration} — ${last.converted}/${last.tracks} converted — uploaded ${last.uploaded}`,
            inline: false,
          }]
          : []),
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const session = getSession(guild.id)!;
  const elapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const channel = guild.channels.cache.get(session.channelId);
  const hostNames = [...session.hostIds]
    .map((id) => guild.members.cache.get(id)?.displayName ?? id)
    .join(", ") || "None";

  const topSpeakers = session.stats.getSortedSpeakers().slice(0, 5).map(({ userId, ms }) => {
    const name = guild.members.cache.get(userId)?.displayName ?? userId;
    return `${name}: ${session.stats.formatDuration(ms)}`;
  });

  const { freeGb } = checkDiskSpace(config.recordingsDir);

  const embed = new EmbedBuilder()
    .setTitle("Recording Session")
    .setColor(0xff4444)
    .addFields(
      { name: "Channel", value: channel?.name ?? session.channelId, inline: true },
      { name: "Duration", value: `${minutes}m ${seconds}s`, inline: true },
      { name: "Active Speakers", value: String(session.activeStreams.size), inline: true },
      { name: "Tracks", value: String(session.files.length), inline: true },
      { name: "Disk Free", value: `${freeGb}GB`, inline: true },
      { name: "Max Duration", value: `${Math.round(config.maxRecordingMs / 60_000)} minutes`, inline: true },
      { name: "Host(s)", value: hostNames, inline: false },
      ...(topSpeakers.length > 0
        ? [{ name: "Top Speakers", value: topSpeakers.join("\n"), inline: false }]
        : []),
    )
    .setTimestamp(session.startedAt);

  await interaction.reply({ embeds: [embed] });
}
