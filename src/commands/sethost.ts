import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  GuildMember,
  EmbedBuilder,
} from "discord.js";
import { getSession, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("sethost")
  .setDescription("Replace all hosts, or omit user to see speaking stats and top-speaker suggestion.")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("The new host (replaces all current hosts)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }
  if (!isRecording(guild.id)) { await interaction.reply({ content: "Not currently recording.", ephemeral: true }); return; }

  const session = getSession(guild.id)!;
  const user = interaction.options.getUser("user");

  if (!user) {
    const sorted = session.stats.getSortedSpeakers();
    const top = session.stats.getTopSpeaker();

    const embed = new EmbedBuilder()
      .setTitle("Speaking Stats — Top Speaker Suggestion")
      .setColor(0x5865f2);

    if (sorted.length === 0) {
      embed.setDescription("No speaking data collected yet.");
    } else {
      const lines = sorted.map(({ userId, ms }) => {
        const name = guild.members.cache.get(userId)?.displayName ?? userId;
        const isHost = session.hostIds.has(userId);
        return `${isHost ? "★ " : ""}**${name}** — ${session.stats.formatDuration(ms)}`;
      });
      embed.setDescription(lines.join("\n"));
      if (top) {
        const topName = guild.members.cache.get(top)?.displayName ?? top;
        embed.setFooter({ text: `Suggested host: ${topName} — use /sethost @${topName} to apply` });
      }
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const member = guild.members.cache.get(user.id) as GuildMember | null;
  const name = member?.displayName ?? user.username;
  session.hostIds.clear();
  session.hostIds.add(user.id);

  await interaction.reply({ content: `Host set to **${name}**. All previous hosts cleared.` });
}
