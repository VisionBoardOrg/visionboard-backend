import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { callClaudeText } from "../lib/anthropic";

export const cronRouter = Router();

// This endpoint is called by Vercel Cron or an external scheduler.
// Secure it by checking a secret token in production.
cronRouter.get("/progress-insights", async (req: Request, res: Response): Promise<void> => {
  const token = req.headers["x-cron-secret"];
  if (process.env.NODE_ENV === "production" && token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

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
});
