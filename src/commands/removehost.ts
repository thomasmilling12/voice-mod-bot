import { ChatInputCommandInteraction, SlashCommandBuilder, GuildMember } from "discord.js";
import { getSession, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("removehost")
  .setDescription("Remove a host from the current session.")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("User to remove as host").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }
  if (!isRecording(guild.id)) { await interaction.reply({ content: "Not currently recording.", ephemeral: true }); return; }

  const session = getSession(guild.id)!;
  const user = interaction.options.getUser("user", true);
  const member = guild.members.cache.get(user.id) as GuildMember | null;
  const name = member?.displayName ?? user.username;

  if (!session.hostIds.has(user.id)) {
    await interaction.reply({ content: `**${name}** is not currently a host.`, ephemeral: true });
    return;
  }

  session.hostIds.delete(user.id);
  await interaction.reply({ content: `**${name}** removed from hosts — their future recordings will use standard processing.` });
}
