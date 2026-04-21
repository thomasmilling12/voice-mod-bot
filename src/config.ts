import path from "path";

export const config = {
  token: process.env.DISCORD_BOT_TOKEN || "",
  prefix: "!",
  recordingsDir: path.join(process.cwd(), "recordings"),
  maxSilenceMs: 300_000,
  reconnectCooldownMs: 10_000,
  hostClearness: {
    highpassHz: 80,
    lowpassHz: 12000,
    compressorThresholdDb: -20,
    normalizeTarget: -3,
  },
};

if (!config.token) {
  throw new Error("DISCORD_BOT_TOKEN environment variable is not set.");
}
