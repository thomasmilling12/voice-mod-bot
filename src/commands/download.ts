import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
} from "discord.js";
import fs from "fs";
import path from "path";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("download")
  .setDescription("Get the latest merged recording for this server.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("Must be used in a server."); return; }

  const guildDir = path.join(config.recordingsDir, guild.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
  if (!fs.existsSync(guildDir)) {
    await interaction.editReply("No recordings found for this server.");
    return;
  }

  const sessions = fs
    .readdirSync(guildDir)
    .filter((d) => fs.statSync(path.join(guildDir, d)).isDirectory())
    .sort()
    .reverse();

  let mergedFile: string | null = null;
  for (const s of sessions) {
    const candidate = path.join(guildDir, s, "merged.mp3");
    if (fs.existsSync(candidate)) { mergedFile = candidate; break; }
  }

  if (!mergedFile) {
    await interaction.editReply(
      "No merged recording found yet. Merging runs after a session ends — try again in a minute, or use `/recordings` to see individual tracks."
    );
    return;
  }

  const sizeMb = fs.statSync(mergedFile).size / 1024 / 1024;

  if (sizeMb > 8) {
    await interaction.editReply(
      `The merged recording is **${sizeMb.toFixed(1)}MB** — too large to send via Discord.\n` +
      `Find it on the Pi at:\n\`\`\`${mergedFile}\`\`\``
    );
    return;
  }

  const attachment = new AttachmentBuilder(mergedFile, { name: "recording.mp3" });
  await interaction.editReply({
    content: `Latest merged recording (${sizeMb.toFixed(1)}MB):`,
    files: [attachment],
  });
}
