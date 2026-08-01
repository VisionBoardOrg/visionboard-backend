import { Router, Request, Response } from "express";
import { requireAuth, asAuthed } from "../middleware/auth";
import { requirePlanFeature } from "../middleware/planLimit";
import { callClaudeJSON, callClaudeText } from "../lib/anthropic";
import { prisma } from "../lib/prisma";
import { z } from "zod";

export const aiRouter = Router();
aiRouter.use(requireAuth);

// ─────────────────────────────────────────────
// 1. ROADMAP GENERATOR
// ─────────────────────────────────────────────
const roadmapSchema = z.object({
  workspaceId: z.string(),
  text: z.string().min(20, "Please provide more detail — at least 20 characters"),
});

interface GeneratedMilestone {
  title: string;
  description: string;
  targetDate: string; // ISO date string relative to today
  dependsOn: string[]; // milestone titles this depends on
  suggestedTasks: string[];
}

aiRouter.post(
  "/roadmap-generator",
  requirePlanFeature("ai_credit", (req) => req.body.workspaceId),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = roadmapSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { workspaceId, text } = parsed.data;
    const userId = asAuthed(req).userId;

    const systemPrompt = `You are a product roadmap expert. The user will describe their goals, ideas, or existing plans in natural language.
Your task: extract a structured roadmap as JSON.

Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "milestones": [
    {
      "title": "string (concise, action-oriented milestone name)",
      "description": "string (1-2 sentences describing what success looks like)",
      "targetDate": "string (ISO-8601 date, relative to today: ${new Date().toISOString().split("T")[0]})",
      "dependsOn": ["array of other milestone titles this blocks on"],
      "suggestedTasks": ["array of 2-4 concrete subtasks"]
    }
  ]
}

Rules:
- Generate 3-7 milestones that form a logical sequence.
- targetDate must be realistic given the context (spread over weeks/months, not days).
- If the user mentions specific dates, honour them.
- dependsOn must only reference titles of other milestones you're generating.
- Return ONLY the JSON object. No explanation, no code fences.`;

    try {
      const result = await callClaudeJSON<{ milestones: GeneratedMilestone[] }>(
        systemPrompt,
        `Here is the project description:\n\n${text}`
      );

      // Log generation
      const log = await prisma.aIGenerationLog.create({
        data: {
          workspaceId,
          userId,
          feature: "roadmap_generator",
          promptInput: text,
          modelOutput: JSON.stringify(result),
          accepted: null, // pending user review
        },
      });

      // Increment AI credit usage
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { aiCreditsUsed: { increment: 1 } },
      });

      res.json({ milestones: result.milestones, generationId: log.id });
    } catch (err) {
      console.error("[ai/roadmap-generator]", err);
      res.status(500).json({ error: "AI generation failed. Please try again." });
    }
  }
);

// Confirm and commit roadmap to DB
aiRouter.post("/roadmap-generator/commit", async (req: Request, res: Response): Promise<void> => {
  const { generationId, goalId, milestones } = req.body as {
    generationId: string;
    goalId: string;
    milestones: GeneratedMilestone[];
  };
  const userId = asAuthed(req).userId;

  if (!generationId || !goalId || !milestones?.length) {
    res.status(400).json({ error: "generationId, goalId, and milestones are required" });
    return;
  }

  const goal = await prisma.goal.findUnique({ where: { id: goalId }, select: { workspaceId: true } });
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: goal.workspaceId, userId } },
  });
  if (!member) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const aiLog = await prisma.aIGenerationLog.findUnique({
    where: { id: generationId },
  });
  if (!aiLog) {
    res.status(404).json({ error: "AI generation log not found" });
    return;
  }
  if (aiLog.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (aiLog.workspaceId !== goal.workspaceId) {
    res.status(400).json({ error: "Generation and goal belong to different workspaces" });
    return;
  }

  const created = await prisma.$transaction(
    milestones.map((m, i) =>
      prisma.milestone.create({
        data: {
          goalId,
          title: m.title,
          description: m.description,
          targetDate: new Date(m.targetDate),
          order: i,
          tasks: {
            create: m.suggestedTasks.map((t, ti) => ({
              title: t,
              order: ti,
              assigneeId: userId,
            })),
          },
        },
      })
    )
  );

  // Mark generation as accepted
  await prisma.aIGenerationLog.update({
    where: { id: generationId },
    data: { accepted: true, entityCreated: JSON.stringify({ type: "milestones", ids: created.map((m) => m.id) }) },
  });

  // Activity log
  await prisma.activityLog.create({
    data: {
      workspaceId: goal.workspaceId,
      userId,
      entityType: "goal",
      entityId: goalId,
      action: "ai_roadmap_applied",
      diff: { milestonesCreated: created.length },
    },
  });

  res.json({ milestones: created });
});

// ─────────────────────────────────────────────
// 2. GOAL DECONSTRUCTOR
// ─────────────────────────────────────────────
const deconstructSchema = z.object({
  workspaceId: z.string(),
  objective: z.string().min(10),
});

aiRouter.post(
  "/goal-deconstructor",
  requirePlanFeature("ai_credit", (req) => req.body.workspaceId),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = deconstructSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { workspaceId, objective } = parsed.data;
    const userId = asAuthed(req).userId;

    // Fetch workspace member names for owner suggestions
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true } } },
    });
    const memberList = members.map((m) => `${m.user.name} (${m.role})`).join(", ");

    const systemPrompt = `You are an OKR and product strategy expert. Given a high-level objective, generate a structured breakdown.

Return ONLY valid JSON:
{
  "keyResults": [
    { "title": "string (measurable key result)", "target": number, "unit": "string" }
  ],
  "tasks": [
    { "title": "string", "priority": "high|medium|low", "storyPoints": number }
  ],
  "suggestedOwners": [
    { "task": "string (task title)", "suggestedMember": "string (name from team)" }
  ],
  "suggestedSprint": "string (e.g. 'Sprint 1 — 2 weeks')"
}

Workspace team: ${memberList || "no members yet"}
Today: ${new Date().toISOString().split("T")[0]}
Rules: 2-5 key results, 3-8 tasks. Return ONLY the JSON.`;

    try {
      const result = await callClaudeJSON(systemPrompt, `Objective: ${objective}`);

      await prisma.aIGenerationLog.create({
        data: {
          workspaceId, userId,
          feature: "goal_deconstructor",
          promptInput: objective,
          modelOutput: JSON.stringify(result),
          accepted: null,
        },
      });
      await prisma.workspace.update({ where: { id: workspaceId }, data: { aiCreditsUsed: { increment: 1 } } });

      res.json(result);
    } catch (err) {
      console.error("[ai/goal-deconstructor]", err);
      res.status(500).json({ error: "AI generation failed." });
    }
  }
);

// ─────────────────────────────────────────────
// 3. PROGRESS INSIGHTS
// ─────────────────────────────────────────────
aiRouter.post(
  "/progress-insights",
  requirePlanFeature("ai_credit", (req) => req.body.workspaceId),
  async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req.body as { workspaceId: string };
    const userId = asAuthed(req).userId;

    if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }

    const goals = await prisma.goal.findMany({
      where: { workspaceId },
      include: { milestones: { include: { tasks: true } } },
    });

    const sprints = await prisma.sprint.findMany({
      where: { workspaceId, status: "active" },
      include: { tasks: true },
    });

    // Build context for Claude
    const ctx = goals.map((g) => {
      const tasks = g.milestones.flatMap((m) => m.tasks);
      const done = tasks.filter((t) => t.status === "done").length;
      const blocked = tasks.filter((t) => t.status === "blocked").length;
      const overdue = g.milestones.filter(
        (m) => m.targetDate && new Date(m.targetDate) < new Date() && m.status !== "completed"
      ).length;
      return `Goal: ${g.title} — ${done}/${tasks.length} tasks done, ${blocked} blocked, ${overdue} overdue milestones`;
    }).join("\n");

    const sprintCtx = sprints.map((s) => {
      const done = s.tasks.filter((t) => t.status === "done").reduce((a, t) => a + (t.storyPoints ?? 0), 0);
      const total = s.tasks.reduce((a, t) => a + (t.storyPoints ?? 0), 0);
      return `Sprint: ${s.name} — ${done}/${total} story points complete (ends ${s.endDate?.toISOString().split("T")[0] ?? "unknown"})`;
    }).join("\n");

    const systemPrompt = `You are a project intelligence assistant. Analyse the following workspace data and produce a concise risk/insight summary (2-4 sentences max). Be specific and actionable. Mention specific goal/sprint names. Do NOT use bullet points — write in plain prose.`;

    try {
      const insight = await callClaudeText(
        systemPrompt,
        `Workspace data:\n${ctx}\n\n${sprintCtx}\nToday: ${new Date().toISOString().split("T")[0]}`
      );

      await prisma.aIGenerationLog.create({
        data: {
          workspaceId, userId,
          feature: "progress_insights",
          promptInput: ctx + "\n" + sprintCtx,
          modelOutput: insight,
          accepted: true,
        },
      });
      await prisma.workspace.update({ where: { id: workspaceId }, data: { aiCreditsUsed: { increment: 1 } } });

      res.json({ insight });
    } catch (err) {
      console.error("[ai/progress-insights]", err);
      res.status(500).json({ error: "AI generation failed." });
    }
  }
);

// ─────────────────────────────────────────────
// 4. NATURAL LANGUAGE BOARD EDIT
// ─────────────────────────────────────────────
const nlSchema = z.object({
  workspaceId: z.string(),
  command: z.string().min(5),
});

aiRouter.post(
  "/nl-board-edit",
  requirePlanFeature("ai_credit", (req) => req.body.workspaceId),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = nlSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { workspaceId, command } = parsed.data;
    const userId = asAuthed(req).userId;

    // Fetch entities for context
    const [milestones, sprints, members] = await Promise.all([
      prisma.milestone.findMany({ where: { goal: { workspaceId } }, include: { goal: true }, take: 20 }),
      prisma.sprint.findMany({ where: { workspaceId }, take: 10 }),
      prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true } } } }),
    ]);

    const context = {
      milestones: milestones.map((m) => ({ id: m.id, title: m.title, status: m.status, goalTitle: m.goal.title })),
      sprints: sprints.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      members: members.map((m) => ({ id: m.userId, name: m.user.name })),
    };

    const systemPrompt = `You are a board editing assistant. Parse the user's natural language command into a structured action.

Workspace context (use IDs from this data):
${JSON.stringify(context, null, 2)}

Return ONLY valid JSON:
{
  "action": "update|move|assign|create",
  "entity": "milestone|task|goal|sprint",
  "id": "string (entity id from context, or null for create)",
  "changes": { "fieldName": "newValue" },
  "description": "string (plain English summary of what will happen, for user confirmation UI)"
}

If you cannot find a matching entity or the command is ambiguous, return:
{ "action": "error", "entity": "unknown", "id": null, "changes": {}, "description": "string explaining what's unclear" }

Return ONLY the JSON.`;

    try {
      const action = await callClaudeJSON(systemPrompt, `Command: "${command}"`);

      await prisma.aIGenerationLog.create({
        data: {
          workspaceId, userId,
          feature: "nl_board_edit",
          promptInput: command,
          modelOutput: JSON.stringify(action),
          accepted: null, // user must confirm
        },
      });
      await prisma.workspace.update({ where: { id: workspaceId }, data: { aiCreditsUsed: { increment: 1 } } });

      res.json({ action });
    } catch (err) {
      console.error("[ai/nl-board-edit]", err);
      res.status(500).json({ error: "AI generation failed." });
    }
  }
);
