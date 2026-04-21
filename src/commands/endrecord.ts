import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { leaveAndStop, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("endrecord")
  .setDescription("Stop recording and leave the voice channel.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("This command must be used in a server."); return; }
  if (!isRecording(guild.id)) { await interaction.editReply("Not currently recording."); return; }

  const result = await leaveAndStop(guild.id, interaction.client);
  await interaction.editReply(result.message);
}
