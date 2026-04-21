import { ChatInputCommandInteraction, SlashCommandBuilder, GuildMember } from "discord.js";
import { getSession, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("addhost")
  .setDescription("Add a host (clarity voice enhancement) to the current session.")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("User to add as host").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }
  if (!isRecording(guild.id)) { await interaction.reply({ content: "Not currently recording.", ephemeral: true }); return; }

  const session = getSession(guild.id)!;
  const user = interaction.options.getUser("user", true);
  const member = guild.members.cache.get(user.id) as GuildMember | null;
  const name = member?.displayName ?? user.username;

  if (session.hostIds.has(user.id)) {
    await interaction.reply({ content: `**${name}** is already a host.`, ephemeral: true });
    return;
  }

  session.hostIds.add(user.id);
  await interaction.reply({ content: `**${name}** added as host — their voice will receive clarity enhancement.` });
}
