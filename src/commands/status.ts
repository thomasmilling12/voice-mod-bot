import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  VoiceChannel,
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

  const voiceChannel = guild.channels.cache.get(session.channelId);
  const channelName = voiceChannel?.name ?? session.channelId;

  const hostNames = [...session.hostIds]
    .map((id) => guild.members.cache.get(id)?.displayName ?? id)
    .join(", ") || "None";

  // Live participants currently in the voice channel
  let participantList = "Unknown";
  if (voiceChannel && voiceChannel.type === ChannelType.GuildVoice) {
    const humans = (voiceChannel as VoiceChannel).members.filter((m) => !m.user.bot);
    participantList = humans.size > 0
      ? [...humans.values()].map((m) => m.displayName).join(", ")
      : "Nobody";
  }

  const topSpeakers = session.stats.getSortedSpeakers().slice(0, 5).map(({ userId, ms }) => {
    const name = guild.members.cache.get(userId)?.displayName ?? userId;
    return `${name}: ${session.stats.formatDuration(ms)}`;
  });

  const marksText = session.marks.length > 0
    ? session.marks.map((m) => {
        const min = Math.floor(m.offsetMs / 60_000);
        const sec = Math.floor((m.offsetMs % 60_000) / 1000);
        return `\`${min}m ${sec}s\` — ${m.note}`;
      }).join("\n")
    : null;

  const { freeGb } = checkDiskSpace(config.recordingsDir);

  const embed = new EmbedBuilder()
    .setTitle(session.paused ? "Recording Session (Paused)" : "Recording Session")
    .setColor(session.paused ? 0xff9900 : 0xff4444)
    .addFields(
      { name: "Channel", value: channelName, inline: true },
      { name: "Duration", value: `${minutes}m ${seconds}s`, inline: true },
      { name: "State", value: session.paused ? "⏸ Paused" : "🔴 Recording", inline: true },
      { name: "Tracks", value: String(session.files.length), inline: true },
      { name: "Disk Free", value: `${freeGb}GB`, inline: true },
      { name: "Max Duration", value: `${Math.round(config.maxRecordingMs / 60_000)} minutes`, inline: true },
      { name: "Host(s)", value: hostNames, inline: false },
      { name: "In Channel Now", value: participantList, inline: false },
      ...(topSpeakers.length > 0
        ? [{ name: "Speaking Time", value: topSpeakers.join("\n"), inline: false }]
        : []),
      ...(marksText
        ? [{ name: `Timestamps (${session.marks.length})`, value: marksText, inline: false }]
        : []),
    )
    .setTimestamp(session.startedAt);

  await interaction.reply({ embeds: [embed] });
}
