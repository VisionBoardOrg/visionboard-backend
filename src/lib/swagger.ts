import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "VisionBoard API",
      version: "1.0.0",
      description: "Full REST API and AI Server for VisionBoard workspace, goals, sprints, tasks, and Claude-powered AI features.",
      contact: {
        name: "VisionBoard Development Team",
      },
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Local Development Server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your NextAuth JWT token or Authorization header",
        },
      },
      schemas: {
        Workspace: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            slug: { type: "string" },
            plan: { type: "string", enum: ["free", "pro", "enterprise"] },
            aiCreditsUsed: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Goal: {
          type: "object",
          properties: {
            id: { type: "string" },
            workspaceId: { type: "string" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            status: { type: "string", enum: ["not_started", "in_progress", "completed", "archived"] },
            targetDate: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Milestone: {
          type: "object",
          properties: {
            id: { type: "string" },
            goalId: { type: "string" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            status: { type: "string" },
            targetDate: { type: "string", format: "date-time", nullable: true },
            order: { type: "integer" },
          },
        },
        Task: {
          type: "object",
          properties: {
            id: { type: "string" },
            milestoneId: { type: "string", nullable: true },
            sprintId: { type: "string", nullable: true },
            title: { type: "string" },
            status: { type: "string", enum: ["todo", "in_progress", "done", "blocked"] },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
            storyPoints: { type: "integer", nullable: true },
            assigneeId: { type: "string", nullable: true },
          },
        },
        Sprint: {
          type: "object",
          properties: {
            id: { type: "string" },
            workspaceId: { type: "string" },
            name: { type: "string" },
            goal: { type: "string", nullable: true },
            startDate: { type: "string", format: "date-time" },
            endDate: { type: "string", format: "date-time" },
            status: { type: "string", enum: ["planned", "active", "completed"] },
          },
        },
        Document: {
          type: "object",
          properties: {
            id: { type: "string" },
            workspaceId: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            icon: { type: "string", nullable: true },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        BoardItem: {
          type: "object",
          properties: {
            id: { type: "string" },
            workspaceId: { type: "string" },
            type: { type: "string", enum: ["sticky", "text", "shape", "card"] },
            content: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            color: { type: "string", nullable: true },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Health Check",
          tags: ["System"],
          responses: {
            200: {
              description: "Server is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      ts: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/workspaces": {
        get: {
          summary: "List user workspaces",
          tags: ["Workspaces"],
          responses: {
            200: {
              description: "Array of user workspaces",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Workspace" },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create a new workspace",
          tags: ["Workspaces"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Created workspace",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Workspace" } } },
            },
          },
        },
      },
      "/api/workspaces/{id}": {
        get: {
          summary: "Get workspace details by ID",
          tags: ["Workspaces"],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: { description: "Workspace details" },
            404: { description: "Workspace not found" },
          },
        },
      },
      "/api/goals": {
        get: {
          summary: "List workspace goals",
          tags: ["Goals"],
          parameters: [
            { name: "workspaceId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: { description: "List of goals with milestones and tasks" },
          },
        },
        post: {
          summary: "Create a new goal",
          tags: ["Goals"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "title"],
                  properties: {
                    workspaceId: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    targetDate: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Created goal" },
          },
        },
      },
      "/api/goals/{id}": {
        patch: {
          summary: "Update goal",
          tags: ["Goals"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    status: { type: "string" },
                    targetDate: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Updated goal" } },
        },
        delete: {
          summary: "Delete goal",
          tags: ["Goals"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Goal deleted" } },
        },
      },
      "/api/milestones": {
        post: {
          summary: "Create milestone",
          tags: ["Milestones"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["goalId", "title"],
                  properties: {
                    goalId: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    targetDate: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created milestone" } },
        },
      },
      "/api/milestones/{id}": {
        patch: {
          summary: "Update milestone",
          tags: ["Milestones"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated milestone" } },
        },
        delete: {
          summary: "Delete milestone",
          tags: ["Milestones"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Deleted milestone" } },
        },
      },
      "/api/tasks": {
        post: {
          summary: "Create task",
          tags: ["Tasks"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    milestoneId: { type: "string" },
                    sprintId: { type: "string" },
                    title: { type: "string" },
                    priority: { type: "string" },
                    storyPoints: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created task" } },
        },
      },
      "/api/tasks/{id}": {
        patch: {
          summary: "Update task",
          tags: ["Tasks"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated task" } },
        },
        delete: {
          summary: "Delete task",
          tags: ["Tasks"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Deleted task" } },
        },
      },
      "/api/sprints": {
        get: {
          summary: "List sprints",
          tags: ["Sprints"],
          parameters: [{ name: "workspaceId", in: "query", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Array of sprints with tasks" } },
        },
        post: {
          summary: "Create sprint",
          tags: ["Sprints"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "name", "startDate", "endDate"],
                  properties: {
                    workspaceId: { type: "string" },
                    name: { type: "string" },
                    goal: { type: "string" },
                    startDate: { type: "string" },
                    endDate: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created sprint" } },
        },
      },
      "/api/sprints/{id}": {
        patch: {
          summary: "Update sprint",
          tags: ["Sprints"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated sprint" } },
        },
      },
      "/api/documents": {
        get: {
          summary: "List workspace documents",
          tags: ["Documents"],
          parameters: [{ name: "workspaceId", in: "query", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "List of documents" } },
        },
        post: {
          summary: "Create document",
          tags: ["Documents"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "title"],
                  properties: {
                    workspaceId: { type: "string" },
                    title: { type: "string" },
                    content: { type: "string" },
                    icon: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created document" } },
        },
      },
      "/api/documents/{id}": {
        put: {
          summary: "Update document",
          tags: ["Documents"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated document" } },
        },
        delete: {
          summary: "Delete document",
          tags: ["Documents"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Deleted document" } },
        },
      },
      "/api/board-items": {
        get: {
          summary: "List board items",
          tags: ["Board Items"],
          parameters: [{ name: "workspaceId", in: "query", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "List of canvas board items" } },
        },
        post: {
          summary: "Create board item",
          tags: ["Board Items"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "type", "content"],
                  properties: {
                    workspaceId: { type: "string" },
                    type: { type: "string" },
                    content: { type: "string" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    color: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created board item" } },
        },
      },
      "/api/board-items/{id}": {
        patch: {
          summary: "Update board item",
          tags: ["Board Items"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated board item" } },
        },
        delete: {
          summary: "Delete board item",
          tags: ["Board Items"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Deleted board item" } },
        },
      },
      "/api/ai/roadmap-generator": {
        post: {
          summary: "AI Roadmap Generator",
          description: "Generates structured milestones and tasks from natural language project text using Claude.",
          tags: ["AI Features"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "text"],
                  properties: {
                    workspaceId: { type: "string" },
                    text: { type: "string", description: "At least 20 characters of project description" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Generated roadmap proposal with generationId" },
            400: { description: "Validation error" },
          },
        },
      },
      "/api/ai/roadmap-generator/commit": {
        post: {
          summary: "Commit AI Roadmap",
          description: "Applies an accepted AI generated roadmap proposal into the database as real milestones and tasks.",
          tags: ["AI Features"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["generationId", "goalId", "milestones"],
                  properties: {
                    generationId: { type: "string" },
                    goalId: { type: "string" },
                    milestones: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Milestones created in database" } },
        },
      },
      "/api/ai/goal-deconstructor": {
        post: {
          summary: "AI Goal Deconstructor",
          description: "Breaks down a high-level goal objective into Key Results, Tasks, Owners, and Sprint recommendations.",
          tags: ["AI Features"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "objective"],
                  properties: {
                    workspaceId: { type: "string" },
                    objective: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Deconstructed objective output" } },
        },
      },
      "/api/ai/progress-insights": {
        post: {
          summary: "AI Progress Insights",
          description: "Analyzes workspace goals, active sprints, and overdue tasks to produce a plain prose risk summary.",
          tags: ["AI Features"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId"],
                  properties: {
                    workspaceId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Insight summary narrative" } },
        },
      },
      "/api/ai/nl-board-edit": {
        post: {
          summary: "AI Natural Language Board Edit",
          description: "Parses natural language commands like 'move sprint 1 tasks to done' into structured workspace action changes.",
          tags: ["AI Features"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workspaceId", "command"],
                  properties: {
                    workspaceId: { type: "string" },
                    command: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Parsed board edit action proposal" } },
        },
      },
      "/api/cron/trigger": {
        post: {
          summary: "Trigger Cron Job Manually",
          tags: ["System"],
          responses: {
            200: { description: "Cron job executed successfully" },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
