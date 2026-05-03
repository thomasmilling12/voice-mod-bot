import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getSession, isRecording, pauseSession } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("pause")
  .setDescription("Pause recording — bot stays in the channel but stops capturing new audio.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }

  const session = getSession(guild.id);
  if (!session || !isRecording(guild.id)) {
    await interaction.reply({ content: "Not currently recording.", ephemeral: true });
    return;
  }
  if (session.paused) {
    await interaction.reply({ content: "Already paused. Use `/resume` to continue.", ephemeral: true });
    return;
  }

  pauseSession(guild.id);
  await interaction.reply({ content: "Recording paused — bot is still in the channel. Use `/resume` to start capturing audio again." });
}
