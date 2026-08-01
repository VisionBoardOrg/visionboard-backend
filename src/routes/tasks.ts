import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { broadcastToWorkspace } from "../socket";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);


// GET /api/tasks?milestoneId= OR ?sprintId=
tasksRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const milestoneId = req.query.milestoneId ? String(req.query.milestoneId) : undefined;
  const sprintId = req.query.sprintId ? String(req.query.sprintId) : undefined;
  const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : undefined;

  let where: Record<string, unknown> = {};
  let wsId: string | undefined = undefined;

  if (milestoneId) {
    const ms = await prisma.milestone.findUnique({ where: { id: milestoneId }, include: { goal: true } });
    if (!ms) { res.status(404).json({ error: "Milestone not found" }); return; }
    wsId = ms.goal.workspaceId;
    where = { milestoneId };
  } else if (sprintId) {
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    wsId = sprint.workspaceId;
    where = { sprintId };
  } else if (workspaceId) {
    wsId = workspaceId;
    where = { milestone: { goal: { workspaceId } } };
  }

  if (!wsId) { res.status(400).json({ error: "Provide milestoneId, sprintId, or workspaceId" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: wsId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const tasks = await prisma.task.findMany({
    where,
    include: { assignee: { select: { id: true, name: true, image: true } } },
    orderBy: { order: "asc" },
  });
  res.json({ tasks });
});

// POST /api/tasks
tasksRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const { milestoneId, title, description, priority, storyPoints, assigneeId, sprintId, dueDate } = req.body as {
    milestoneId: string; title: string; description?: string; priority?: string; storyPoints?: number;
    assigneeId?: string; sprintId?: string; dueDate?: string;
  };

  if (!milestoneId || !title) { res.status(400).json({ error: "milestoneId and title required" }); return; }
  const ms = await prisma.milestone.findUnique({ where: { id: milestoneId }, include: { goal: true } });
  if (!ms) { res.status(404).json({ error: "Milestone not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ms.goal.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const count = await prisma.task.count({ where: { milestoneId } });
  const task = await prisma.task.create({
    data: {
      milestoneId, title, description,
      priority: (priority as never) ?? "medium",
      storyPoints: storyPoints ?? null,
      assigneeId: assigneeId ?? null,
      sprintId: sprintId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      order: count,
    },
  });
  res.status(201).json({ task });
});

// PATCH /api/tasks/:id
tasksRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const taskId = String(req.params.id);
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { milestone: { include: { goal: true } } },
  });
  if (!task) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: task.milestone.goal.workspaceId, userId } },
  });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, description, status, priority, storyPoints, assigneeId, sprintId, dueDate, order } = req.body as Partial<{
    title: string; description: string; status: string; priority: string; storyPoints: number;
    assigneeId: string | null; sprintId: string | null; dueDate: string; order: number;
  }>;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: title ?? undefined,
      description: description ?? undefined,
      status: (status as never) ?? undefined,
      priority: (priority as never) ?? undefined,
      storyPoints: storyPoints ?? undefined,
      assigneeId: assigneeId !== undefined ? assigneeId : undefined,
      sprintId: sprintId !== undefined ? sprintId : undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      order: order ?? undefined,
    },
  });

  await prisma.activityLog.create({
    data: {
      workspaceId: task.milestone.goal.workspaceId, userId,
      entityType: "task", entityId: task.id, action: "updated", diff: req.body as never,
    },
  });

  broadcastToWorkspace(task.milestone.goal.workspaceId, {
    type: "TASK_UPDATED",
    workspaceId: task.milestone.goal.workspaceId,
    taskId: task.id,
    milestoneId: task.milestoneId,
    status: updated.status,
    assigneeId: updated.assigneeId,
    task: updated as Record<string, unknown>,
  });

  res.json({ task: updated });
});

// DELETE /api/tasks/:id
tasksRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const taskId = String(req.params.id);
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { milestone: { include: { goal: true } } },
  });
  if (!task) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: task.milestone.goal.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  await prisma.task.delete({ where: { id: taskId } });
  res.json({ success: true });
});
