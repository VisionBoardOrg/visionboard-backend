import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

interface ExtWebSocket extends WebSocket {
  workspaceId?: string;
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
  [key: string]: unknown;
}

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });

  console.log("⚡ WebSocket server initialized on path /ws");

  wss.on("connection", (ws: ExtWebSocket) => {
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw: string) => {
      try {
        const data: WsMessage = JSON.parse(raw.toString());

        if (data.type === "join" && data.workspaceId) {
          ws.workspaceId = data.workspaceId;
          console.log(`🔌 WebSocket client joined workspace room: ${data.workspaceId}`);
          ws.send(JSON.stringify({ type: "joined", workspaceId: data.workspaceId }));
          return;
        }

        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        // Broadcast events to all clients in the same workspace room
        if (data.workspaceId) {
          broadcastToWorkspace(data.workspaceId, data, ws);
        }
      } catch (err) {
        console.error("Malformed WebSocket message:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  // Keep-alive heartbeat interval (every 30 seconds)
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((wsClient) => {
      const client = wsClient as ExtWebSocket;
      if (client.isAlive === false) return client.terminate();
      client.isAlive = false;
      client.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

/**
 * Broadcasts a message to all connected WebSocket clients subscribed to a workspace.
 */
export function broadcastToWorkspace(
  workspaceId: string,
  message: WsMessage,
  senderWs?: WebSocket
) {
  if (!wss) return;

  const payload = JSON.stringify(message);

  wss.clients.forEach((client) => {
    const extWs = client as ExtWebSocket;
    if (
      extWs.readyState === WebSocket.OPEN &&
      extWs.workspaceId === workspaceId &&
      extWs !== senderWs
    ) {
      extWs.send(payload);
    }
  });
}
