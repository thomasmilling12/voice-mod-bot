import path from "path";

export const config = {
  token: process.env.DISCORD_BOT_TOKEN || "",
  voiceDisabled: process.env.VOICE_DISABLED === "true",
  recordingsDir: path.join(process.cwd(), "recordings"),
  maxSilenceMs: 300_000,
  reconnectCooldownMs: 10_000,
  sessionCooldownMs: parseInt(process.env.SESSION_COOLDOWN_MS ?? "60000"),
  maxRecordingAgeDays: parseInt(process.env.MAX_RECORDING_AGE_DAYS ?? "30"),
  diskWarningGb: parseFloat(process.env.DISK_WARNING_GB ?? "1"),
  logChannelId: process.env.LOG_CHANNEL_ID ?? null,
  alertChannelId: process.env.ALERT_CHANNEL_ID ?? null,
  ignoredChannelIds: new Set(
    (process.env.IGNORED_CHANNEL_IDS ?? "").split(",").filter(Boolean)
  ),
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
