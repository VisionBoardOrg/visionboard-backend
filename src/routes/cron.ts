import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { callClaudeText } from "../lib/anthropic";
import crypto from "crypto";

export const cronRouter = Router();

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function verifyCronAuth(req: Request): boolean {
  const token = (req.headers["x-cron-secret"] || req.headers.authorization?.replace(/^Bearer\s+/i, "")) as string | undefined;
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || expectedSecret.length < 16) {
    if (process.env.NODE_ENV === "production") {
      return false;
    }
    return token ? safeCompare(token, "dev-cron-secret") : false;
  }

  return token ? safeCompare(token, expectedSecret) : false;
}

// This endpoint is called by Vercel Cron or an external scheduler.
// Secure it by checking a secret token in production.
cronRouter.get("/progress-insights", async (req: Request, res: Response): Promise<void> => {
  if (!verifyCronAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Process all active workspaces on growth/enterprise (they get unlimited AI)
    const workspaces = await prisma.workspace.findMany({
      where: { plan: { in: ["growth", "enterprise"] } },
      include: {
        goals: { include: { milestones: { include: { tasks: true } } } },
        sprints: { where: { status: "active" }, include: { tasks: true } },
        members: { orderBy: { joinedAt: "asc" }, take: 1, include: { user: { select: { id: true } } } },
      },
    });

    const results = [];

    for (const ws of workspaces) {
      const ctx = ws.goals.map((g) => {
        const tasks = g.milestones.flatMap((m) => m.tasks);
        const done = tasks.filter((t) => t.status === "done").length;
        const blocked = tasks.filter((t) => t.status === "blocked").length;
        return `Goal: ${g.title} — ${done}/${tasks.length} done, ${blocked} blocked`;
      }).join("\n");

      if (!ctx) continue;

      try {
        const insight = await callClaudeText(
          "You are a project intelligence assistant. Write a 2-sentence risk summary. Be specific, actionable.",
          `Workspace: ${ws.name}\n${ctx}\nToday: ${new Date().toISOString().split("T")[0]}`
        );

        const firstMember = ws.members[0]?.user;
        if (firstMember) {
          await prisma.aIGenerationLog.create({
            data: {
              workspaceId: ws.id,
              userId: firstMember.id,
              feature: "progress_insights",
              promptInput: ctx,
              modelOutput: insight,
              accepted: true,
            },
          });
        }
        results.push({ workspaceId: ws.id, insight });
      } catch (e) {
        console.error(`[cron] Failed for workspace ${ws.id}:`, e);
      }
    }

    res.json({ processed: results.length, results });
  } catch (error) {
    console.error("[cron] Database connection error or query failure:", error);
    res.status(500).json({ error: "Failed to execute cron job due to database error" });
  }
});

// Automated due-date, milestone delay, and goal health sweeper
cronRouter.get("/sweeps", async (req: Request, res: Response): Promise<void> => {
  if (!verifyCronAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 1. Task due dates & overdue
    const [overdueTasks, dueSoonTasks] = await Promise.all([
      prisma.task.findMany({
        where: { status: { not: "done" }, dueDate: { lt: now } },
        select: { id: true, title: true, dueDate: true, assigneeId: true },
      }),
      prisma.task.findMany({
        where: { status: { not: "done" }, dueDate: { gte: now, lte: twentyFourHoursFromNow } },
        select: { id: true, title: true, dueDate: true, assigneeId: true },
      }),
    ]);

    // 2. Auto-mark overdue milestones as delayed
    const slippingMilestones = await prisma.milestone.findMany({
      where: { status: { notIn: ["completed", "delayed"] }, targetDate: { lt: now } },
      select: { id: true, title: true, targetDate: true },
    });

    if (slippingMilestones.length > 0) {
      await prisma.milestone.updateMany({
        where: { id: { in: slippingMilestones.map((m) => m.id) } },
        data: { status: "delayed" },
      });
    }

    res.json({
      success: true,
      timestamp: now.toISOString(),
      tasks: {
        overdueCount: overdueTasks.length,
        dueSoonCount: dueSoonTasks.length,
      },
      milestones: {
        newlyDelayedCount: slippingMilestones.length,
        delayedIds: slippingMilestones.map((m) => m.id),
      },
    });
  } catch (error) {
    console.error("[cron/sweeps] Sweeper failed:", error);
    res.status(500).json({ error: "Sweeper error" });
  }
});
