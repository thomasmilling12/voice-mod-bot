import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getSession, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show current recording session status.");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  if (!isRecording(guild.id)) {
    await interaction.reply({ content: "Not currently recording.", ephemeral: true });
    return;
  }

  const session = getSession(guild.id);
  if (!session) {
    await interaction.reply({ content: "No active session found.", ephemeral: true });
    return;
  }

  const elapsed = Math.floor(
    (Date.now() - session.startedAt.getTime()) / 1000
  );
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const hostMember = session.hostId
    ? guild.members.cache.get(session.hostId)
    : null;
  const hostName = hostMember?.displayName ?? session.hostId ?? "None";
  const channel = guild.channels.cache.get(session.channelId);
  const channelName = channel?.name ?? session.channelId;

  const embed = new EmbedBuilder()
    .setTitle("Recording Session Status")
    .setColor(0xff4444)
    .addFields(
      { name: "Channel", value: channelName, inline: true },
      { name: "Host", value: hostName, inline: true },
      {
        name: "Duration",
        value: `${minutes}m ${seconds}s`,
        inline: true,
      },
      {
        name: "Active Streams",
        value: String(session.activeStreams.size),
        inline: true,
      },
      {
        name: "Tracks Queued",
        value: String(session.files.length),
        inline: true,
      }
    )
    .setTimestamp(session.startedAt);

  await interaction.reply({ embeds: [embed], ephemeral: false });
}
