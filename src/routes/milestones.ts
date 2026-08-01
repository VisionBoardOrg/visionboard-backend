import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";

export const milestonesRouter = Router();
milestonesRouter.use(requireAuth);

// GET /api/milestones?goalId=
milestonesRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const goalId = req.query.goalId ? String(req.query.goalId) : "";
  if (!goalId) { res.status(400).json({ error: "goalId required" }); return; }

  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: goal.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const milestones = await prisma.milestone.findMany({
    where: { goalId },
    include: { tasks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });
  res.json({ milestones });
});

// POST /api/milestones
milestonesRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const { goalId, title, description, targetDate, startDate, order } = req.body as {
    goalId: string; title: string; description?: string; targetDate?: string; startDate?: string; order?: number;
  };
  if (!goalId || !title) { res.status(400).json({ error: "goalId and title required" }); return; }

  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: goal.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const milestone = await prisma.milestone.create({
    data: {
      goalId, title,
      description: description ?? null,
      targetDate: targetDate ? new Date(targetDate) : null,
      startDate: startDate ? new Date(startDate) : null,
      order: order ?? 0,
    },
  });
  res.status(201).json({ milestone });
});

// PATCH /api/milestones/:id
milestonesRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const milestoneId = String(req.params.id);
  const ms = await prisma.milestone.findUnique({ where: { id: milestoneId }, include: { goal: true } });
  if (!ms) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ms.goal.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, description, status, targetDate, startDate, order, dependsOn } = req.body as Partial<{
    title: string; description: string; status: string; targetDate: string; startDate: string; order: number; dependsOn: string[];
  }>;

  const updated = await prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      title: title ?? undefined,
      description: description ?? undefined,
      status: (status as never) ?? undefined,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      order: order ?? undefined,
      dependsOn: dependsOn ?? undefined,
    },
  });

  await prisma.activityLog.create({
    data: { workspaceId: ms.goal.workspaceId, userId, entityType: "milestone", entityId: ms.id, action: "updated", diff: req.body as never },
  });

  res.json({ milestone: updated });
});

// DELETE /api/milestones/:id
milestonesRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const milestoneId = String(req.params.id);
  const ms = await prisma.milestone.findUnique({ where: { id: milestoneId }, include: { goal: true } });
  if (!ms) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ms.goal.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  await prisma.milestone.delete({ where: { id: milestoneId } });
  res.json({ success: true });
});
