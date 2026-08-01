import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

// GET /api/workspaces — list user's workspaces
workspacesRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId } } },
    include: {
      _count: { select: { members: true, goals: true, documents: true } },
      members: { where: { userId }, select: { role: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ workspaces });
});

// GET /api/workspaces/:id — single workspace
workspacesRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaceId = String(req.params.id);

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      _count: { select: { goals: true, documents: true, boardItems: true } },
    },
  });
  res.json({ workspace });
});

// PATCH /api/workspaces/:id
workspacesRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaceId = String(req.params.id);

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member || member.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { name } = req.body as { name?: string };
  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: name ?? undefined },
  });
  res.json({ workspace });
});
