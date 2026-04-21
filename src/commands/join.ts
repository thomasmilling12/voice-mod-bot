import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  VoiceChannel,
  GuildMember,
} from "discord.js";
import { joinAndRecord, isRecording } from "../voiceManager";
import { logger } from "../logger";

export const data = new SlashCommandBuilder()
  .setName("join")
  .setDescription("Join a voice channel and start recording the car meet.")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Voice channel to join (defaults to your current channel)")
      .setRequired(false)
  )
  .addUserOption((opt) =>
    opt
      .setName("host")
      .setDescription("The host whose voice will get clarity enhancement")
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("This command must be used in a server.");
    return;
  }

  if (isRecording(guild.id)) {
    await interaction.editReply(
      "Already recording in this server. Use `/leave` to stop first."
    );
    return;
  }

  const member = interaction.member as GuildMember;
  const channelOption = interaction.options.getChannel("channel");
  const hostOption = interaction.options.getUser("host");

  let targetChannel: VoiceChannel | null = null;

  if (channelOption) {
    targetChannel = channelOption as VoiceChannel;
  } else if (member.voice?.channelId) {
    targetChannel = guild.channels.cache.get(
      member.voice.channelId
    ) as VoiceChannel | null;
  }

  if (!targetChannel) {
    await interaction.editReply(
      "You need to be in a voice channel, or specify one with the `channel` option."
    );
    return;
  }

  if (targetChannel.type !== 2) {
    await interaction.editReply("That channel is not a voice channel.");
    return;
  }

  const hostId = hostOption?.id ?? member.id;
  const hostMember = guild.members.cache.get(hostId);
  const hostName = hostMember?.displayName ?? hostId;

  logger.info(
    `User ${member.displayName} requested recording in ${targetChannel.name}, host=${hostName}`
  );

  const result = await joinAndRecord(
    targetChannel,
    hostId,
    interaction.client
  );

  const hostLine = `Host (announcer voice): **${hostName}**`;
  const msg = result.success
    ? `${result.message}\n${hostLine}`
    : result.message;

  await interaction.editReply(msg);
}
