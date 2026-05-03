import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getSession, isRecording, resumeSession } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("resume")
  .setDescription("Resume a paused recording.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }

  const session = getSession(guild.id);
  if (!session || !isRecording(guild.id)) {
    await interaction.reply({ content: "Not currently recording.", ephemeral: true });
    return;
  }
  if (!session.paused) {
    await interaction.reply({ content: "Not paused — already recording normally.", ephemeral: true });
    return;
  }

  resumeSession(guild.id);
  await interaction.reply({ content: "Recording resumed — capturing audio again." });
}
