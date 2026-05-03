import path from "path";

export const config = {
  token: process.env.DISCORD_BOT_TOKEN || "",
  voiceDisabled: process.env.VOICE_DISABLED === "true",
  autoJoinEnabled: process.env.AUTO_JOIN_ENABLED === "true",
  autoJoinMinMembers: parseInt(process.env.AUTO_JOIN_MIN_MEMBERS ?? "2"),
  watchdogIntervalHours: parseFloat(process.env.WATCHDOG_INTERVAL_HOURS ?? "12"),
  heartbeatChannelId: process.env.HEARTBEAT_CHANNEL_ID ?? process.env.LOG_CHANNEL_ID ?? null,
  webhookPort: parseInt(process.env.WEBHOOK_PORT ?? "9000"),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  recordingsDir: path.join(process.cwd(), "recordings"),
  maxSilenceMs: parseInt(process.env.MAX_SILENCE_MINUTES ?? "5") * 60_000,
  maxRecordingMs: parseInt(process.env.MAX_RECORDING_MINUTES ?? "180") * 60_000,
  reconnectCooldownMs: 10_000,
  sessionCooldownMs: parseInt(process.env.SESSION_COOLDOWN_MS ?? "60000"),
  maxRecordingAgeDays: parseInt(process.env.MAX_RECORDING_AGE_DAYS ?? "30"),
  deleteUploadedRecordings: process.env.DELETE_UPLOADED_RECORDINGS !== "false",
  notifyHostDm: process.env.NOTIFY_HOST_DM !== "false",
  diskWarningGb: parseFloat(process.env.DISK_WARNING_GB ?? "1"),
  logChannelId: process.env.LOG_CHANNEL_ID ?? null,
  recordingChannelId: process.env.RECORDING_CHANNEL_ID ?? process.env.LOG_CHANNEL_ID ?? "1496001557290946591",
  discordUploadLimitMb: parseFloat(process.env.DISCORD_UPLOAD_LIMIT_MB ?? "24"),
  alertChannelId: process.env.ALERT_CHANNEL_ID ?? null,
  adminUserIds: new Set(
    (process.env.ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean)
  ),
  adminRoleIds: new Set(
    (process.env.ADMIN_ROLE_IDS ?? "850391095845584937,850391378559238235,990011447193006101,1055823929358430248")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  ),
  ignoredChannelIds: new Set(
    (process.env.IGNORED_CHANNEL_IDS ?? "").split(",").filter(Boolean)
  ),
  hostClearness: {
    highpassHz: 80,
    lowpassHz: 12000,
    compressorThresholdDb: -20,
    normalizeTarget: -14,
  },
};

if (!config.token) {
  throw new Error("DISCORD_BOT_TOKEN environment variable is not set.");
}
