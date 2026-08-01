import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";

export const boardItemsRouter = Router();
boardItemsRouter.use(requireAuth);

boardItemsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : "";
  if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const items = await prisma.boardItem.findMany({
    where: { workspaceId },
    include: { linkedGoal: true, linkedMilestone: { include: { tasks: true } } },
  });
  res.json({ boardItems: items });
});

boardItemsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const { workspaceId, entityType, x, y, width, height, label, linkedGoalId, linkedMilestoneId, color } = req.body as {
    workspaceId: string; entityType: string; x?: number; y?: number; width?: number; height?: number;
    label?: string; linkedGoalId?: string; linkedMilestoneId?: string; color?: string;
  };
  if (!workspaceId || !entityType) { res.status(400).json({ error: "workspaceId and entityType required" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const item = await prisma.boardItem.create({
    data: {
      workspaceId,
      entityType: entityType as never,
      x: x ?? 100, y: y ?? 100, width: width ?? 200, height: height ?? 120,
      label: label ?? null, linkedGoalId: linkedGoalId ?? null, linkedMilestoneId: linkedMilestoneId ?? null, color: color ?? null,
    },
  });
  res.status(201).json({ boardItem: item });
});

boardItemsRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const itemId = String(req.params.id);
  const item = await prisma.boardItem.findUnique({ where: { id: itemId } });
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: item.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { x, y, width, height, label, color } = req.body as Partial<{ x: number; y: number; width: number; height: number; label: string; color: string }>;
  const updated = await prisma.boardItem.update({
    where: { id: itemId },
    data: { x: x ?? undefined, y: y ?? undefined, width: width ?? undefined, height: height ?? undefined, label: label ?? undefined, color: color ?? undefined },
  });
  res.json({ boardItem: updated });
});

boardItemsRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const itemId = String(req.params.id);
  const item = await prisma.boardItem.findUnique({ where: { id: itemId } });
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: item.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  await prisma.boardItem.delete({ where: { id: itemId } });
  res.json({ success: true });
});
