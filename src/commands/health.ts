import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getLastRecordingSummary, getSession, isRecording, getTotalSessionCount } from "../voiceManager";
import { checkDiskSpace } from "../recorder";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Show bot health, recording status, disk space, and runtime info.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  const session = getSession(guild.id);
  const recording = isRecording(guild.id);
  const { freeGb, totalGb } = checkDiskSpace(config.recordingsDir);
  const last = getLastRecordingSummary(guild.id);
  const totalSessions = getTotalSessionCount(guild.id);
  const uptimeSeconds = Math.floor(process.uptime());
  const uptimeHours = Math.floor(uptimeSeconds / 3600);
  const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

  const fields = [
    { name: "Status", value: "Online", inline: true },
    { name: "Recording", value: recording ? "Yes" : "No", inline: true },
    { name: "Node.js", value: process.version, inline: true },
    { name: "Uptime", value: `${uptimeHours}h ${uptimeMinutes}m`, inline: true },
    { name: "Disk Free", value: `${freeGb}GB / ${totalGb}GB`, inline: true },
    { name: "Upload Channel", value: config.recordingChannelId ? `<#${config.recordingChannelId}>` : "Not set", inline: true },
    { name: "Sessions (this run)", value: String(totalSessions), inline: true },
    { name: "Host DM", value: config.notifyHostDm ? "On" : "Off", inline: true },
  ];

  if (session) {
    const elapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
    fields.push(
      { name: "Current Duration", value: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`, inline: true },
      { name: "Current Tracks", value: String(session.files.length), inline: true },
      { name: "Active Streams", value: String(session.activeStreams.size), inline: true },
    );
  }

  if (last) {
    fields.push({
      name: "Last Recording",
      value: `${last.duration}\nTracks: ${last.tracks}, Converted: ${last.converted}\nMerged: ${last.merged ? "Yes" : "No"}\nUploaded: ${last.uploaded}`,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("Bot Health")
    .setColor(recording ? 0xff4444 : 0x00cc44)
    .addFields(fields)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}