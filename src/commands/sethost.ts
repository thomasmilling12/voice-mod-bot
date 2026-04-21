import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  GuildMember,
} from "discord.js";
import { getSession, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("sethost")
  .setDescription("Change the host (announcer voice clarity) during a live session.")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("The new host")
      .setRequired(true)
  );

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
    await interaction.reply({ content: "No active session.", ephemeral: true });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const member = guild.members.cache.get(user.id) as GuildMember | null;
  const name = member?.displayName ?? user.username;

  session.hostId = user.id;

  await interaction.reply({
    content: `Host updated to **${name}**. Their voice will receive clarity enhancement in future recordings.`,
    ephemeral: false,
  });
}
