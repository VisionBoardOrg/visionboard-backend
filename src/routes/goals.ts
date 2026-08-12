import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { z } from "zod";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

async function verifyMember(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
}

const createSchema = z.object({
  workspaceId: z.string(),
  title: z.string().min(1).max(200),
  objective: z.string().min(1),
  keyResults: z.array(z.object({ id: z.string(), title: z.string(), target: z.number(), current: z.number(), unit: z.string() })).optional(),
  targetDate: z.string().optional(),
  status: z.enum(["draft", "active", "completed", "cancelled"]).optional(),
});

// GET /api/goals?workspaceId=&limit=&cursor=
goalsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : "";
  if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }

  const member = await verifyMember(workspaceId, userId);
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const limit = Math.min(
    req.query.limit ? parseInt(String(req.query.limit), 10) : 50,
    100
  );
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

  const goals = await prisma.goal.findMany({
    where: { workspaceId },
    take: limit + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    select: {
      id: true,
      title: true,
      objective: true,
      status: true,
      healthScore: true,
      targetDate: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      milestones: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          targetDate: true,
          startDate: true,
          order: true,
          _count: { select: { tasks: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const hasNext = goals.length > limit;
  const paginatedGoals = hasNext ? goals.slice(0, -1) : goals;
  const nextCursor = hasNext ? paginatedGoals[paginatedGoals.length - 1].id : null;

  res.json({ goals: paginatedGoals, nextCursor, hasNext });
});

// POST /api/goals
goalsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const member = await verifyMember(parsed.data.workspaceId, userId);
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const goal = await prisma.goal.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      title: parsed.data.title,
      objective: parsed.data.objective,
      keyResults: (parsed.data.keyResults ?? []) as never,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
      status: parsed.data.status ?? "draft",
      ownerId: userId,
    },
  });

  await prisma.activityLog.create({
    data: { workspaceId: goal.workspaceId, userId, entityType: "goal", entityId: goal.id, action: "created" },
  });

  res.status(201).json({ goal });
});

// GET /api/goals/:id
goalsRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const goalId = String(req.params.id);
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    include: {
      milestones: { include: { tasks: { orderBy: { order: "asc" } }, documents: true }, orderBy: { order: "asc" } },
      documents: true,
      comments: { include: { author: { select: { id: true, name: true, image: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!goal) { res.status(404).json({ error: "Not found" }); return; }
  const member = await verifyMember(goal.workspaceId, userId);
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json({ goal });
});

// PATCH /api/goals/:id
goalsRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const goalId = String(req.params.id);
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) { res.status(404).json({ error: "Not found" }); return; }
  const member = await verifyMember(goal.workspaceId, userId);
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, objective, keyResults, targetDate, status, healthScore } = req.body as Partial<{
    title: string; objective: string; keyResults: unknown[]; targetDate: string; status: string; healthScore: number;
  }>;

  const updated = await prisma.goal.update({
    where: { id: goalId },
    data: {
      title: title ?? undefined,
      objective: objective ?? undefined,
      keyResults: (keyResults as never) ?? undefined,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      status: (status as never) ?? undefined,
      healthScore: healthScore ?? undefined,
    },
  });

  await prisma.activityLog.create({
    data: { workspaceId: goal.workspaceId, userId, entityType: "goal", entityId: goal.id, action: "updated", diff: req.body as never },
  });

  res.json({ goal: updated });
});

// DELETE /api/goals/:id
goalsRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const goalId = String(req.params.id);
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) { res.status(404).json({ error: "Not found" }); return; }
  const member = await verifyMember(goal.workspaceId, userId);
  if (!member || !["admin", "pm"].includes(member.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  await prisma.goal.delete({ where: { id: goalId } });
  res.json({ success: true });
});
