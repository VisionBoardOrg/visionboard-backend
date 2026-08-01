import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";

export const sprintsRouter = Router();
sprintsRouter.use(requireAuth);

sprintsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : "";
  if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const sprints = await prisma.sprint.findMany({
    where: { workspaceId },
    include: { tasks: { include: { assignee: { select: { id: true, name: true } } } } },
    orderBy: { startDate: "desc" },
  });
  res.json({ sprints });
});

sprintsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const { workspaceId, name, goal, startDate, endDate, velocity } = req.body as {
    workspaceId: string; name: string; goal?: string; startDate: string; endDate: string; velocity?: number;
  };
  if (!workspaceId || !name || !startDate || !endDate) { res.status(400).json({ error: "workspaceId, name, startDate, endDate required" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const sprint = await prisma.sprint.create({
    data: { workspaceId, name, goal, startDate: new Date(startDate), endDate: new Date(endDate), velocity },
  });
  res.status(201).json({ sprint });
});

sprintsRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const sprintId = String(req.params.id);
  const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
  if (!sprint) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: sprint.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, status, velocity } = req.body as { name?: string; status?: string; velocity?: number };
  const updated = await prisma.sprint.update({
    where: { id: sprintId },
    data: { name: name ?? undefined, status: (status as never) ?? undefined, velocity: velocity ?? undefined },
  });
  res.json({ sprint: updated });
});
