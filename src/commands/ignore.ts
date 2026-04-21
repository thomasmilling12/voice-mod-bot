import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ChannelType,
} from "discord.js";
import { config } from "../config";

export const data = new SlashCommandBuilder()
  .setName("ignore")
  .setDescription("Toggle auto-join ignore for a voice channel.")
  .addChannelOption((opt) =>
    opt.setName("channel").setDescription("Voice channel to toggle").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);

  if (channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({ content: "That is not a voice channel.", ephemeral: true });
    return;
  }

  if (config.ignoredChannelIds.has(channel.id)) {
    config.ignoredChannelIds.delete(channel.id);
    await interaction.reply({ content: `**${channel.name}** removed from ignore list — bot will auto-join again.` });
  } else {
    config.ignoredChannelIds.add(channel.id);
    await interaction.reply({ content: `**${channel.name}** added to ignore list — bot will not auto-join this channel.` });
  }
}
