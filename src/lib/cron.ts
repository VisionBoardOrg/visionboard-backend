import cron from "node-cron";

export function setupCronJobs() {
  // Run progress insights daily at 8am UTC for all paid workspaces
  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] Running scheduled progress insights...");
    try {
      const baseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
      await fetch(`${baseUrl}/api/cron/progress-insights`, {
        headers: { "x-cron-secret": process.env.CRON_SECRET ?? "dev-cron-secret" },
      });
    } catch (e) {
      console.error("[cron] Scheduled job failed:", e);
    }
  });

  console.log("[cron] Scheduled: progress insights daily at 8am UTC");
}
