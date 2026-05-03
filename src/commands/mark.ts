import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { getSession, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("mark")
  .setDescription("Add a timestamped note to the current recording.")
  .addStringOption((opt) =>
    opt
      .setName("note")
      .setDescription("What to mark — e.g. 'sick burnout', 'police arrived'")
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }

  if (!isRecording(guild.id)) {
    await interaction.reply({ content: "Not currently recording.", ephemeral: true });
    return;
  }

  const session = getSession(guild.id)!;
  const note = interaction.options.getString("note") ?? "Marked";
  const offsetMs = Date.now() - session.startedAt.getTime();
  const minutes = Math.floor(offsetMs / 60_000);
  const seconds = Math.floor((offsetMs % 60_000) / 1000);

  session.marks.push({ offsetMs, note, markedAt: new Date() });

  await interaction.reply({
    content: `Marked **${note}** at \`${minutes}m ${seconds}s\` into the recording.`,
  });
}
