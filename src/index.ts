import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { logger } from "./logger";
import { config } from "./config";
import { commands, registerSlashCommands } from "./commandRegistry";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  await registerSlashCommands(c.user.id);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction as ChatInputCommandInteraction);
  } catch (err) {
    logger.error(`Error in command ${interaction.commandName}: ${err}`);
    const reply = { content: "An error occurred.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

client.on(Events.Error, (err) => {
  logger.error(`Client error: ${err.message}`);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down (SIGTERM)...");
  client.destroy();
  process.exit(0);
});

client.login(config.token).catch((err) => {
  logger.error(`Login failed: ${err.message}`);
  process.exit(1);
});
