import { Collection, REST, Routes } from "discord.js";
import { logger } from "./logger";
import { config } from "./config";
import * as join from "./commands/join";
import * as leave from "./commands/leave";
import * as status from "./commands/status";
import * as recordings from "./commands/recordings";
import * as sethost from "./commands/sethost";
import * as addhost from "./commands/addhost";
import * as removehost from "./commands/removehost";
import * as download from "./commands/download";
import * as ignore from "./commands/ignore";
import * as clip from "./commands/clip";
import * as record from "./commands/record";
import * as endrecord from "./commands/endrecord";
import * as health from "./commands/health";
import * as pause from "./commands/pause";
import * as resume from "./commands/resume";

export type CommandModule = {
  data: { name: string; toJSON(): object };
  execute: (interaction: any) => Promise<void>;
};

export const commands = new Collection<string, CommandModule>();

const commandList: CommandModule[] = [
  join, leave, status, recordings, sethost, addhost, removehost, download, ignore, clip, record, endrecord, health, pause, resume,
];

for (const cmd of commandList) {
  commands.set(cmd.data.name, cmd);
}

export async function registerSlashCommands(clientId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const body = commandList.map((c) => c.data.toJSON());
  try {
    logger.info(`Registering ${body.length} global slash commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger.info("Slash commands registered.");
  } catch (err) {
    logger.error(`Failed to register commands: ${err}`);
  }
}
