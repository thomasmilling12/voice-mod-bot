import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import fs from "fs";
import path from "path";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("recordings")
  .setDescription("List recent recordings saved by the bot.");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("Must be used in a server.");
    return;
  }

  const guildDir = path.join(
    config.recordingsDir,
    guild.id.replace(/[^a-zA-Z0-9_-]/g, "_")
  );

  if (!fs.existsSync(guildDir)) {
    await interaction.editReply("No recordings found for this server yet.");
    return;
  }

  const sessions = fs
    .readdirSync(guildDir)
    .filter((d) =>
      fs.statSync(path.join(guildDir, d)).isDirectory()
    )
    .sort()
    .reverse()
    .slice(0, 5);

  if (sessions.length === 0) {
    await interaction.editReply("No recording sessions found.");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Recent Recordings")
    .setColor(0x5865f2);

  for (const session of sessions) {
    const sessionPath = path.join(guildDir, session);
    const files = fs
      .readdirSync(sessionPath)
      .filter((f) => f.endsWith(".ogg"));
    const totalSize = files.reduce((acc, f) => {
      try {
        return acc + fs.statSync(path.join(sessionPath, f)).size;
      } catch {
        return acc;
      }
    }, 0);
    const sizeMb = (totalSize / 1024 / 1024).toFixed(2);

    embed.addFields({
      name: session.replace("session_", ""),
      value: `${files.length} track(s) — ${sizeMb} MB`,
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
