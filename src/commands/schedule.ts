import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  GuildMember,
  VoiceChannel,
  ChannelType,
} from "discord.js";
import { scheduleRecording, cancelSchedule, hasSchedule, isRecording } from "../voiceManager";

export const data = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("Schedule a recording to start automatically at a set time.")
  .addStringOption((opt) =>
    opt
      .setName("time")
      .setDescription("Start time in 24-hour format, e.g. 20:00 for 8 pm")
      .setRequired(false)
  )
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Voice channel to record (defaults to your current channel)")
      .setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("cancel")
      .setDescription("Cancel the pending scheduled recording")
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }

  const shouldCancel = interaction.options.getBoolean("cancel") ?? false;
  if (shouldCancel) {
    const cancelled = cancelSchedule(guild.id);
    await interaction.reply({
      content: cancelled ? "✅ Scheduled recording cancelled." : "No scheduled recording to cancel.",
      ephemeral: true,
    });
    return;
  }

  const timeStr = interaction.options.getString("time");
  if (!timeStr) {
    const status = hasSchedule(guild.id)
      ? "A recording is already scheduled. Use `cancel: True` to remove it, or set a new `time:` to replace it."
      : "No recording scheduled. Provide a `time:` to schedule one, e.g. `/schedule time:20:00`.";
    await interaction.reply({ content: status, ephemeral: true });
    return;
  }

  if (isRecording(guild.id)) {
    await interaction.reply({ content: "Already recording. Stop the current session before scheduling a new one.", ephemeral: true });
    return;
  }

  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    await interaction.reply({ content: "Invalid format. Use 24-hour HH:MM — e.g. `20:00` for 8 pm.", ephemeral: true });
    return;
  }

  const [, hh, mm] = match;
  const now = new Date();
  const target = new Date(now);
  target.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1); // wrap to tomorrow if time has passed today

  const delayMs = target.getTime() - now.getTime();
  const totalMins = Math.floor(delayMs / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const channelOpt = interaction.options.getChannel("channel");
  let voiceChannel: VoiceChannel | null = null;

  if (channelOpt) {
    if (channelOpt.type !== ChannelType.GuildVoice) {
      await interaction.reply({ content: "The channel option must be a voice channel.", ephemeral: true });
      return;
    }
    voiceChannel = guild.channels.cache.get(channelOpt.id) as VoiceChannel;
  } else {
    const member = interaction.member as GuildMember;
    if (member.voice?.channelId) {
      voiceChannel = guild.channels.cache.get(member.voice.channelId) as VoiceChannel ?? null;
    }
  }

  if (!voiceChannel) {
    await interaction.reply({
      content: "Join a voice channel first, or specify one with the `channel:` option.",
      ephemeral: true,
    });
    return;
  }

  const hostIds = new Set([(interaction.member as GuildMember).id]);
  scheduleRecording(guild.id, voiceChannel, hostIds, delayMs, interaction.client);

  const tomorrow = target.getDate() !== now.getDate() ? " (tomorrow)" : "";
  await interaction.reply({
    content:
      `🕐 Recording scheduled for **${voiceChannel.name}** at **${timeStr}**${tomorrow} — starts in **${countdown}**.\n` +
      `Use \`/schedule cancel:True\` to cancel.`,
  });
}
