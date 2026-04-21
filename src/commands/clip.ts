import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
} from "discord.js";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("clip")
  .setDescription("Save the last N minutes of the most recent merged recording as a clip.")
  .addIntegerOption((opt) =>
    opt
      .setName("minutes")
      .setDescription("How many minutes to clip from the end (default 5, max 30)")
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("Must be used in a server."); return; }

  const minutes = Math.min(Math.max(interaction.options.getInteger("minutes") ?? 5, 1), 30);
  const guildDir = path.join(config.recordingsDir, guild.id.replace(/[^a-zA-Z0-9_-]/g, "_"));

  if (!fs.existsSync(guildDir)) { await interaction.editReply("No recordings found."); return; }

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

  if (!mergedFile) { await interaction.editReply("No merged recording available yet."); return; }

  const clipFile = path.join(path.dirname(mergedFile), `clip_last_${minutes}min.mp3`);

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y",
        "-sseof", String(-minutes * 60),
        "-i", mergedFile!,
        "-c", "copy",
        clipFile,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      ffmpeg.stderr.on("data", () => {});
      ffmpeg.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    });
  } catch (err) {
    await interaction.editReply(`Failed to create clip: ${err}`);
    return;
  }

  const sizeMb = fs.statSync(clipFile).size / 1024 / 1024;

  if (sizeMb > 8) {
    await interaction.editReply(
      `Clip created (${sizeMb.toFixed(1)}MB — too large to upload).\nFind it on the Pi at:\n\`\`\`${clipFile}\`\`\``
    );
    return;
  }

  const attachment = new AttachmentBuilder(clipFile, { name: `clip_last_${minutes}min.mp3` });
  await interaction.editReply({ content: `Last ${minutes} minute(s) of the recording:`, files: [attachment] });
}
