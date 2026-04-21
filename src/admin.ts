import { ChatInputCommandInteraction, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { config } from "./config";

export function isBotAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (config.adminUserIds.size > 0) return config.adminUserIds.has(interaction.user.id);

  const permissions = interaction.memberPermissions ?? new PermissionsBitField();
  return permissions.has(PermissionFlagsBits.Administrator) || permissions.has(PermissionFlagsBits.ManageGuild);
}

export async function replyNotAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: "Only a bot admin can use this command.",
    ephemeral: true,
  });
}