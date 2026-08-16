import { PlanTier } from "@prisma/client";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

type Feature =
  | "create_workspace" | "invite_member" | "ai_credit"
  | "timeline_gantt" | "sprint_tracking" | "integrations" | "sso";

const PLAN_LIMITS: Record<PlanTier, Record<Feature, boolean | number>> = {
  free: {
    create_workspace: 1, invite_member: 5, ai_credit: 10,
    timeline_gantt: false, sprint_tracking: false, integrations: false, sso: false,
  },
  startup: {
    create_workspace: 5, invite_member: 25, ai_credit: 100,
    timeline_gantt: true, sprint_tracking: true, integrations: false, sso: false,
  },
  growth: {
    create_workspace: -1, invite_member: 100, ai_credit: -1,
    timeline_gantt: true, sprint_tracking: true, integrations: true, sso: false,
  },
  enterprise: {
    create_workspace: -1, invite_member: -1, ai_credit: -1,
    timeline_gantt: true, sprint_tracking: true, integrations: true, sso: true,
  },
};

export function checkPlanLimit(
  plan: PlanTier,
  feature: Feature,
  currentCount: number
): { allowed: boolean; reason?: string; upgradePrompt?: string } {
  const limit = PLAN_LIMITS[plan][feature];

  if (typeof limit === "boolean") {
    if (!limit) {
      return {
        allowed: false,
        reason: `${feature.replace("_", " ")} is not available on the ${plan} plan.`,
        upgradePrompt: `Upgrade your plan to access this feature.`,
      };
    }
    return { allowed: true };
  }

  if (limit === -1) return { allowed: true }; // unlimited

  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows up to ${limit} for ${feature.replace("_", " ")}.`,
      upgradePrompt: "Upgrade your plan to increase this limit.",
    };
  }

  return { allowed: true };
}

/**
 * Atomically verifies AI credit availability AND consumes one credit in a
 * single database operation. This eliminates the TOCTOU race condition where
 * N concurrent requests could each pass the middleware check before any of
 * them increment aiCreditsUsed.
 *
 * @returns { consumed: boolean; reason?: string; upgradePrompt?: string }
 */
export async function consumeAICredit(
  workspaceId: string
): Promise<{ consumed: boolean; reason?: string; upgradePrompt?: string }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true, aiCreditsUsed: true },
  });

  if (!workspace) {
    return { consumed: false, reason: "Workspace not found" };
  }

  const limit = PLAN_LIMITS[workspace.plan].ai_credit;

  if (typeof limit === "boolean") {
    if (!limit) {
      return {
        consumed: false,
        reason: `ai credit is not available on the ${workspace.plan} plan.`,
        upgradePrompt: `Upgrade your plan to access this feature.`,
      };
    }
  }

  if (limit === -1) {
    const result = await prisma.workspace.updateMany({
      where: { id: workspaceId },
      data: { aiCreditsUsed: { increment: 1 } },
    });
    return { consumed: result.count > 0 };
  }

  const check = checkPlanLimit(workspace.plan, "ai_credit", workspace.aiCreditsUsed);
  if (!check.allowed) {
    return { consumed: false, reason: check.reason, upgradePrompt: check.upgradePrompt };
  }

  const result = await prisma.workspace.updateMany({
    where: {
      id: workspaceId,
      aiCreditsUsed: { lt: limit as number },
    },
    data: { aiCreditsUsed: { increment: 1 } },
  });

  if (result.count === 0) {
    return {
      consumed: false,
      reason: `Your ${workspace.plan} plan allows up to ${limit} for ai credit.`,
      upgradePrompt: "Upgrade your plan to increase this limit.",
    };
  }

  return { consumed: true };
}

/**
 * Express middleware factory — checks a specific plan limit before proceeding.
 * NOTE: For ai_credit, prefer consumeAICredit() inside the route handler to
 * atomically reserve the credit and prevent race conditions.
 */
export function requirePlanFeature(
  feature: Feature,
  getWorkspaceId: (req: Request) => string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workspaceId = getWorkspaceId(req);

    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required" });
      return;
    }

    if (feature === "ai_credit") {
      const result = await consumeAICredit(workspaceId);
      if (!result.consumed) {
        res.status(403).json({ error: result.reason, upgradePrompt: result.upgradePrompt });
        return;
      }
      (req as Request & { _aiCreditConsumed?: boolean })._aiCreditConsumed = true;
      next();
      return;
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, aiCreditsUsed: true, _count: { select: { members: true } } },
    });

    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const count = workspace._count.members;
    const check = checkPlanLimit(workspace.plan, feature, count);

    if (!check.allowed) {
      res.status(403).json({ error: check.reason, upgradePrompt: check.upgradePrompt });
      return;
    }

    next();
  };
}
