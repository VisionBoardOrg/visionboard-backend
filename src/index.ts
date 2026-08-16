import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./lib/swagger";
import { workspacesRouter } from "./routes/workspaces";
import { goalsRouter } from "./routes/goals";
import { milestonesRouter } from "./routes/milestones";
import { tasksRouter } from "./routes/tasks";
import { sprintsRouter } from "./routes/sprints";
import { documentsRouter } from "./routes/documents";
import { boardItemsRouter } from "./routes/board-items";
import { aiRouter } from "./routes/ai";
import { cronRouter } from "./routes/cron";
import { setupCronJobs } from "./lib/cron";
import { initWebSocketServer } from "./socket";

const app = express();
const PORT = process.env.PORT ?? 4000;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

// ── Middleware ─────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = [
  FRONTEND_URL,
  process.env.APP_URL,
  process.env.NEXTAUTH_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: "4mb" }));

// ── Request logging ────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Health check & Documentation ─────────
app.get("/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (_req, res) => res.json(swaggerSpec));

// ── API Routes ─────────────────────────────
app.use("/api/workspaces", workspacesRouter);
app.use("/api/goals", goalsRouter);
app.use("/api/milestones", milestonesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/sprints", sprintsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/board-items", boardItemsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/cron", cronRouter);

// ── 404 fallthrough ────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ── Error handler ──────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start HTTP & WebSocket Server ──────────
const server = http.createServer(app);
initWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`✅ VisionBoard backend running on http://localhost:${PORT}`);
  setupCronJobs();
});

export default app;

