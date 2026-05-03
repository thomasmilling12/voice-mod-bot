import http from "http";
import { execSync } from "child_process";
import { config } from "./config";
import { logger } from "./logger";

export function startWebhookServer(): void {
  if (!config.webhookSecret) {
    logger.info("WEBHOOK_SECRET not set — auto-update webhook disabled");
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/update") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const auth = req.headers["x-webhook-secret"];
    if (auth !== config.webhookSecret) {
      res.writeHead(401);
      res.end("Unauthorized");
      logger.warn("Webhook: rejected request with wrong secret");
      return;
    }

    res.writeHead(200);
    res.end("Update triggered");
    logger.info("Webhook: pulling latest code and restarting...");

    try {
      const out = execSync("git pull --ff-only && bash deploy/update.sh", {
        cwd: process.cwd(),
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString().trim();
      logger.info(`Webhook update output: ${out}`);
    } catch (err) {
      logger.error(`Webhook update failed: ${err}`);
    }
  });

  server.on("error", (err) => {
    logger.error(`Webhook server error: ${err.message}`);
  });

  server.listen(config.webhookPort, "127.0.0.1", () => {
    logger.info(`Auto-update webhook listening on 127.0.0.1:${config.webhookPort}`);
  });
}
