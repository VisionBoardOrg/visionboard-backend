import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { prisma } from "./lib/prisma";

interface ExtWebSocket extends WebSocket {
  workspaceId?: string;
  userId?: string;
  isAlive?: boolean;
}

export interface WsMessage {
  type: "join" | "TASK_UPDATED" | "CARD_UPDATED" | "ping" | "pong";
  workspaceId?: string;
  taskId?: string;
  milestoneId?: string;
  status?: string;
  assigneeId?: string | null;
  task?: Record<string, unknown>;
  boardItem?: Record<string, unknown>;
  /** Auth token sent on join — only used during the handshake, never broadcast */
  token?: string;
  [key: string]: unknown;
}

const JWT_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

/** Verify a NextAuth JWT and return the userId, or null if invalid. */
function verifyJwt(token: string): string | null {
  if (!JWT_SECRET) {
    console.warn("[ws] AUTH_SECRET not set — cannot verify WebSocket tokens");
    return null;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
    return (payload.id ?? payload.sub) as string ?? null;
  } catch {
    return null;
  }
}

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });

  console.log("⚡ WebSocket server initialized on path /ws");

  wss.on("connection", (ws: ExtWebSocket, _req: IncomingMessage) => {
    ws.isAlive = true;
    // Not yet authenticated — workspaceId and userId are unset until a valid
    // "join" message is received.

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (raw: Buffer | string) => {
      // Reject oversized messages before parsing
      const rawStr = raw.toString();
      if (rawStr.length > 64_000) {
        console.warn("[ws] Oversized message discarded");
        return;
      }

      let data: WsMessage;
      try {
        data = JSON.parse(rawStr) as WsMessage;
      } catch {
        console.error("[ws] Malformed WebSocket message");
        return;
      }

      // ── JOIN: authenticate and subscribe to a workspace room ──────────────
      if (data.type === "join") {
        if (!data.workspaceId || typeof data.workspaceId !== "string") {
          ws.close(1008, "workspaceId required");
          return;
        }

        // Require a valid auth token
        if (!data.token || typeof data.token !== "string") {
          ws.close(1008, "Authentication required");
          return;
        }

        const userId = verifyJwt(data.token);
        if (!userId) {
          ws.close(1008, "Invalid or expired token");
          return;
        }

        // Verify the user is actually a member of the requested workspace
        try {
          const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: data.workspaceId, userId } },
            select: { userId: true },
          });

          if (!member) {
            ws.close(1008, "Not a member of this workspace");
            return;
          }
        } catch (err) {
          console.error("[ws] Membership check failed:", err);
          ws.close(1011, "Internal error during auth");
          return;
        }

        ws.workspaceId = data.workspaceId;
        ws.userId = userId;

        ws.send(JSON.stringify({ type: "joined", workspaceId: data.workspaceId }));
        return;
      }

      // ── All other messages require an authenticated connection ─────────────
      if (!ws.workspaceId || !ws.userId) {
        // Silently drop — client should join first
        return;
      }

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // Broadcast events to all authenticated clients in the same workspace room
      if (data.workspaceId === ws.workspaceId) {
        broadcastToWorkspace(ws.workspaceId, data, ws);
      }
    });

    ws.on("error", (err) => {
      console.error("[ws] WebSocket error:", err);
    });
  });

  // Keep-alive heartbeat (every 30 seconds) — terminate dead connections
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((wsClient) => {
      const client = wsClient as ExtWebSocket;
      if (client.isAlive === false) return client.terminate();
      client.isAlive = false;
      client.ping();
    });
  }, 30_000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

/**
 * Broadcasts a message to all authenticated WebSocket clients in a workspace.
 * The sender is excluded from the broadcast.
 */
export function broadcastToWorkspace(
  workspaceId: string,
  message: WsMessage,
  senderWs?: WebSocket
) {
  if (!wss) return;

  // Strip the auth token before broadcasting — never forward it to other clients
  const { token: _token, ...safeMessage } = message;
  const payload = JSON.stringify(safeMessage);

  wss.clients.forEach((client) => {
    const extWs = client as ExtWebSocket;
    if (
      extWs.readyState === WebSocket.OPEN &&
      extWs.workspaceId === workspaceId &&
      extWs.userId !== undefined && // only authenticated clients
      extWs !== senderWs
    ) {
      extWs.send(payload);
    }
  });
}
