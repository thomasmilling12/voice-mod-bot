import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  VoiceChannel,
  GuildMember,
} from "discord.js";
import { joinAndRecord, isRecording } from "../voiceManager";
import { logger } from "../logger";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("join")
  .setDescription("Join a voice channel and start recording the car meet.")
  .addChannelOption((opt) =>
    opt.setName("channel").setDescription("Voice channel to join (defaults to your current channel)").setRequired(false)
  )
  .addUserOption((opt) =>
    opt.setName("host").setDescription("Primary host — gets announcer voice clarity").setRequired(false)
  )
  .addUserOption((opt) =>
    opt.setName("host2").setDescription("Second host").setRequired(false)
  )
  .addUserOption((opt) =>
    opt.setName("host3").setDescription("Third host").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) { await interaction.editReply("This command must be used in a server."); return; }
  if (isRecording(guild.id)) { await interaction.editReply("Already recording. Use `/leave` to stop first."); return; }

  const member = interaction.member as GuildMember;
  const channelOption = interaction.options.getChannel("channel");
  const h1 = interaction.options.getUser("host");
  const h2 = interaction.options.getUser("host2");
  const h3 = interaction.options.getUser("host3");

  let targetChannel: VoiceChannel | null = null;
  if (channelOption) {
    targetChannel = channelOption as VoiceChannel;
  } else if (member.voice?.channelId) {
    targetChannel = guild.channels.cache.get(member.voice.channelId) as VoiceChannel | null;
  }

  if (!targetChannel) {
    await interaction.editReply("You need to be in a voice channel, or specify one with the `channel` option.");
    return;
  }
  if (targetChannel.type !== 2) { await interaction.editReply("That channel is not a voice channel."); return; }

  const hostIds = new Set<string>();
  if (h1) hostIds.add(h1.id);
  if (h2) hostIds.add(h2.id);
  if (h3) hostIds.add(h3.id);
  if (hostIds.size === 0) hostIds.add(member.id);

  const hostNames = [...hostIds]
    .map((id) => guild.members.cache.get(id)?.displayName ?? id)
    .join(", ");

  logger.info(`Manual join: ${member.displayName} → ${targetChannel.name}, hosts=[${hostNames}]`);
  config.ignoredChannelIds.delete(targetChannel.id);

  const result = await joinAndRecord(targetChannel, hostIds, interaction.client);
  const msg = result.success
    ? `${result.message}\nHost(s) with clarity enhancement: **${hostNames}**`
    : result.message;

  await interaction.editReply(msg);
}
