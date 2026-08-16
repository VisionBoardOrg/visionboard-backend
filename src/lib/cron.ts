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

  // Run user deletion cleanup daily at midnight (00:00 UTC)
  cron.schedule("0 0 * * *", async () => {
    console.log("[cron] Running scheduled user deletion cleanup...");
    try {
      const frontendUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const res = await fetch(`${frontendUrl}/api/cron/cleanup-users`, {
        headers: { "x-cron-secret": process.env.CRON_SECRET ?? "dev-cron-secret" },
      });
      const data = await res.json();
      console.log("[cron] User deletion cleanup completed:", data);
    } catch (e) {
      console.error("[cron] Scheduled user cleanup job failed:", e);
    }
  });

  console.log("[cron] Scheduled: progress insights daily at 8am UTC & user cleanup daily at midnight UTC");
}
