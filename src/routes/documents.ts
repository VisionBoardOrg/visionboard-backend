import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : "";
  const linkedGoalId = req.query.linkedGoalId ? String(req.query.linkedGoalId) : undefined;
  const linkedMilestoneId = req.query.linkedMilestoneId ? String(req.query.linkedMilestoneId) : undefined;
  const linkedTaskId = req.query.linkedTaskId ? String(req.query.linkedTaskId) : undefined;

  if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const docs = await prisma.document.findMany({
    where: {
      workspaceId,
      linkedGoalId: linkedGoalId ?? undefined,
      linkedMilestoneId: linkedMilestoneId ?? undefined,
      linkedTaskId: linkedTaskId ?? undefined,
    },
    include: { author: { select: { id: true, name: true, image: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ documents: docs });
});

documentsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const { workspaceId, title, content, linkedGoalId, linkedMilestoneId, linkedTaskId } = req.body as {
    workspaceId: string; title: string; content?: unknown; linkedGoalId?: string; linkedMilestoneId?: string; linkedTaskId?: string;
  };
  if (!workspaceId || !title) { res.status(400).json({ error: "workspaceId and title required" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const doc = await prisma.document.create({
    data: {
      workspaceId, title,
      content: (content ?? {}) as never,
      authorId: userId,
      linkedGoalId: linkedGoalId ?? null,
      linkedMilestoneId: linkedMilestoneId ?? null,
      linkedTaskId: linkedTaskId ?? null,
    },
  });
  res.status(201).json({ document: doc });
});

documentsRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const docId = String(req.params.id);
  const doc = await prisma.document.findUnique({ where: { id: docId }, include: { author: { select: { id: true, name: true } } } });
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json({ document: doc });
});

documentsRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const docId = String(req.params.id);
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, content, linkedGoalId, linkedMilestoneId, linkedTaskId } = req.body as Partial<{
    title: string; content: unknown; linkedGoalId: string | null; linkedMilestoneId: string | null; linkedTaskId: string | null;
  }>;

  const updated = await prisma.document.update({
    where: { id: docId },
    data: {
      title: title ?? undefined,
      content: (content as never) ?? undefined,
      linkedGoalId: linkedGoalId !== undefined ? linkedGoalId : undefined,
      linkedMilestoneId: linkedMilestoneId !== undefined ? linkedMilestoneId : undefined,
      linkedTaskId: linkedTaskId !== undefined ? linkedTaskId : undefined,
    },
  });
  res.json({ document: updated });
});

documentsRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const docId = String(req.params.id);
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }
  await prisma.document.delete({ where: { id: docId } });
  res.json({ success: true });
});
