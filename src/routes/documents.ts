import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { prisma } from "../lib/prisma";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

function estimateContentBytes(content: unknown): bigint {
  try {
    return BigInt(Buffer.byteLength(JSON.stringify(content ?? {}), "utf8"));
  } catch {
    return 0n;
  }
}

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
    select: {
      id: true,
      title: true,
      authorId: true,
      workspaceId: true,
      linkedGoalId: true,
      linkedMilestoneId: true,
      linkedTaskId: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, image: true } },
    },
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

  const contentBytes = estimateContentBytes(content);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        workspaceId, title,
        content: (content ?? {}) as never,
        authorId: userId,
        linkedGoalId: linkedGoalId ?? null,
        linkedMilestoneId: linkedMilestoneId ?? null,
        linkedTaskId: linkedTaskId ?? null,
      },
    });

    if (contentBytes > 0n) {
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { storageUsedBytes: { increment: contentBytes } },
      });
    }

    return created;
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
  const doc = await prisma.document.findUnique({ where: { id: docId }, select: { id: true, workspaceId: true, content: true } });
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, content, linkedGoalId, linkedMilestoneId, linkedTaskId } = req.body as Partial<{
    title: string; content: unknown; linkedGoalId: string | null; linkedMilestoneId: string | null; linkedTaskId: string | null;
  }>;

  const oldBytes = estimateContentBytes(doc.content);
  const newContent = content !== undefined ? content : doc.content;
  const newBytes = estimateContentBytes(newContent);
  const byteDelta = newBytes - oldBytes;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.document.update({
      where: { id: docId },
      data: {
        title: title ?? undefined,
        content: content !== undefined ? (content as never) : undefined,
        linkedGoalId: linkedGoalId !== undefined ? linkedGoalId : undefined,
        linkedMilestoneId: linkedMilestoneId !== undefined ? linkedMilestoneId : undefined,
        linkedTaskId: linkedTaskId !== undefined ? linkedTaskId : undefined,
      },
    });

    if (byteDelta !== 0n) {
      await tx.workspace.update({
        where: { id: doc.workspaceId },
        data: { storageUsedBytes: { increment: byteDelta } },
      });
    }

    return result;
  });

  res.json({ document: updated });
});

documentsRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = asAuthed(req).userId;
  const docId = String(req.params.id);
  const doc = await prisma.document.findUnique({ where: { id: docId }, select: { id: true, authorId: true, workspaceId: true, content: true } });
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } } });
  if (!member) { res.status(403).json({ error: "Forbidden" }); return; }

  const isAuthor = doc.authorId === userId;
  const isAdmin = member.role === "admin";
  if (!isAuthor && !isAdmin) {
    res.status(403).json({ error: "Only the document author or an admin can delete documents" });
    return;
  }

  const contentBytes = estimateContentBytes(doc.content);

  await prisma.$transaction(async (tx) => {
    await tx.document.delete({ where: { id: docId } });

    if (contentBytes > 0n) {
      await tx.workspace.update({
        where: { id: doc.workspaceId },
        data: { storageUsedBytes: { decrement: contentBytes } },
      });
    }
  });

  res.json({ success: true });
});
