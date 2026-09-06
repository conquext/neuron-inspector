import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z, type ZodTypeAny } from "zod";
import { PendingCalls } from "./correlation.js";
import { TOOLS, toolToPrimitive } from "./tools.js";
import { RECIPE_TOOLS, handleRecipeTool } from "./recipe-tools.js";
import { COMPOUND_TOOLS, handleCompoundTool } from "./compound-tools.js";
import { SCHEDULER_TOOLS, handleSchedulerTool, startScheduler } from "./scheduler.js";
import { SESSION_TOOLS, handleSessionTool } from "./session-state.js";
import { MONITOR_TOOLS, handleMonitorTool, startMonitor } from "./monitor.js";
import { KILLSWITCH_TOOLS, handleKillswitchTool } from "./killswitch.js";
import * as net from "node:net";

// ── JSON-schema → Zod raw shape ──────────────────────────────
type JsonProp = { type?: string; description?: string; enum?: string[]; items?: JsonProp; properties?: Record<string, JsonProp>; required?: string[] };

function propToZod(p: JsonProp): ZodTypeAny {
  let zt: ZodTypeAny;
  if (Array.isArray(p?.enum) && p.enum.length > 0) {
    zt = z.enum(p.enum as [string, ...string[]]);
  } else {
    switch (p?.type) {
      case "number":
      case "integer": zt = z.number(); break;
      case "boolean": zt = z.boolean(); break;
      case "array": zt = z.array(p.items ? propToZod(p.items) : z.any()); break;
      case "object": zt = p.properties ? z.object(shapeFromSchema(p)) : z.record(z.string(), z.any()); break;
      case "string": zt = z.string(); break;
      default: zt = z.any();
    }
  }
  if (p?.description) zt = zt.describe(p.description);
  return zt;
}

function shapeFromSchema(schema: JsonProp): Record<string, ZodTypeAny> {
  const props = schema?.properties ?? {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const shape: Record<string, ZodTypeAny> = {};
  for (const [k, v] of Object.entries(props)) {
    const zt = propToZod(v);
    shape[k] = required.includes(k) ? zt : zt.optional();
  }
  return shape;
}

const PORT = parseInt(process.env.NEURON_BRIDGE_PORT ?? "7377", 10);

// ── State ────────────────────────────────────────────────────

let extensionWs: WebSocket | null = null;
const pending = new PendingCalls();
let mode: "primary" | "proxy" = "primary";

// ── Port check: is another bridge already running? ──────────

function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => { s.close(); resolve(false); });
    s.listen(port, "127.0.0.1");
  });
}

// ── Start as primary (WebSocket server) or proxy (WS client) ─

async function startBridge(): Promise<void> {
  const taken = await isPortTaken(PORT);

  if (!taken) {
    // Primary mode — start WebSocket server, extension connects here
    mode = "primary";
    const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

    wss.on("connection", (ws) => {
      console.error(`[bridge] Extension connected`);
      extensionWs = ws;

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "response" && msg.requestId) {
            pending.onResponse(msg);
            return;
          }

          // Handle tool calls FROM the extension (for killswitch/local tools)
          if (msg.type === "TOOL_CALL" && msg.requestId && msg.payload?.name) {
            const toolName = msg.payload.name as string;
            const toolArgs = (msg.payload.args as Record<string, unknown>) ?? {};

            // Check if it's a local tool (killswitch, recipe, scheduler, session, monitor)
            const localHandlers: Record<string, (n: string, a: Record<string, unknown>) => Promise<unknown>> = {
              neuron_stop: handleKillswitchTool,
              neuron_status: handleKillswitchTool,
              neuron_pause_all: handleKillswitchTool,
              neuron_resume_all: handleKillswitchTool,
              neuron_recipe_list: handleRecipeTool,
              neuron_recipe_get: handleRecipeTool,
              neuron_rules_get: handleRecipeTool,
              neuron_schedule_list: handleSchedulerTool,
              neuron_session_list: handleSessionTool,
              neuron_monitor_list: (n, a) => handleMonitorTool(n, a),
              neuron_monitor_alerts: (n, a) => handleMonitorTool(n, a),
            };

            const handler = localHandlers[toolName];
            if (handler) {
              handler(toolName, toolArgs)
                .then((result) => {
                  ws.send(JSON.stringify({ type: "response", requestId: msg.requestId, payload: result }));
                })
                .catch((err) => {
                  ws.send(JSON.stringify({ type: "response", requestId: msg.requestId, error: (err as Error).message }));
                });
              return;
            }
          }
        } catch {
          // ignore unparseable messages
        }
      });

      ws.on("close", () => {
        console.error(`[bridge] Extension disconnected`);
        if (extensionWs === ws) extensionWs = null;
        pending.clear();
      });
    });

    console.error(`[bridge] Primary mode — WebSocket server on 127.0.0.1:${PORT}`);
  } else {
    // Proxy mode — another bridge owns the port. Connect as a WS client
    // and relay tool calls through it.
    mode = "proxy";
    console.error(`[bridge] Port ${PORT} in use — switching to proxy mode`);

    function connectProxy(): void {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

      ws.on("open", () => {
        console.error(`[bridge] Proxy connected to primary bridge`);
        extensionWs = ws;
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "response" && msg.requestId) {
            pending.onResponse(msg);
          }
        } catch {
          // ignore
        }
      });

      ws.on("close", () => {
        console.error(`[bridge] Proxy disconnected from primary — reconnecting in 3s`);
        extensionWs = null;
        pending.clear();
        setTimeout(connectProxy, 3000);
      });

      ws.on("error", () => {
        // onclose will handle reconnect
      });
    }

    connectProxy();
  }
}

// ── MCP server (Claude Code / Cursor connects via stdio) ────

const mcp = new McpServer({
  name: "neuron-inspector",
  version: "0.5.1",
});

// ── Helper: register tool groups ────────────────────────────

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function registerLocalTools(tools: { name: string; description: string; inputSchema: Record<string, unknown> }[], handler: ToolHandler): void {
  for (const tool of tools) {
    mcp.tool(tool.name, tool.description, shapeFromSchema(tool.inputSchema as JsonProp), async (args) => {
      try {
        const result = await handler(tool.name, args as Record<string, unknown>);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    });
  }
}

function registerBrowserTools(tools: { name: string; description: string; inputSchema: Record<string, unknown> }[], handler: (name: string, args: Record<string, unknown>, ctx: { ws: WebSocket; pending: PendingCalls }) => Promise<unknown>): void {
  for (const tool of tools) {
    mcp.tool(tool.name, tool.description, shapeFromSchema(tool.inputSchema as JsonProp), async (args) => {
      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        return {
          content: [{ type: "text", text: "Extension not connected. Open Chrome with the Neuron extension and enable developer mode." }],
          isError: true,
        };
      }
      try {
        const result = await handler(tool.name, args as Record<string, unknown>, { ws: extensionWs, pending });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    });
  }
}

// ── Register all tool groups ────────────────────────────────

// Browser primitives (forwarded to extension via WebSocket)
for (const tool of TOOLS) {
  mcp.tool(tool.name, tool.description, shapeFromSchema(tool.inputSchema as JsonProp), async (args) => {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      return {
        content: [{ type: "text", text: "Extension not connected. Open Chrome with the Neuron extension and enable developer mode." }],
        isError: true,
      };
    }
    try {
      const primitiveName = toolToPrimitive(tool.name);
      const result = await pending.call(extensionWs, primitiveName, args as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  });
}

// Compound tools (bridge-side orchestration → extension)
registerBrowserTools(COMPOUND_TOOLS, handleCompoundTool);

// Recipe + rules tools (local filesystem)
registerLocalTools(RECIPE_TOOLS, handleRecipeTool);

// Scheduler tools (local filesystem + timers)
registerLocalTools(SCHEDULER_TOOLS, handleSchedulerTool);

// Session state tools (local filesystem)
registerLocalTools(SESSION_TOOLS, handleSessionTool);

// Kill switch tools (local filesystem)
registerLocalTools(KILLSWITCH_TOOLS, handleKillswitchTool);

// Monitor tools (local filesystem + extension for checks)
for (const tool of MONITOR_TOOLS) {
  mcp.tool(tool.name, tool.description, shapeFromSchema(tool.inputSchema as JsonProp), async (args) => {
    try {
      const checkFn = async (url: string, selector?: string): Promise<{ text: string; items?: unknown[] }> => {
        if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
          throw new Error("Extension not connected");
        }
        const tab = (await pending.call(extensionWs, "openTab", { url })) as { tabId?: number };
        const tabId = tab?.tabId;
        if (!tabId) throw new Error("Failed to open tab");
        await new Promise((r) => setTimeout(r, 3000));
        await pending.call(extensionWs, "scrollPage", { tabId, deltaY: 600, smooth: true });
        await new Promise((r) => setTimeout(r, 500));
        const extractArgs: Record<string, unknown> = { tabId };
        if (selector) extractArgs.selector = selector;
        const data = await pending.call(extensionWs, "extractData", extractArgs);
        try { await pending.call(extensionWs, "evaluateJS", { tabId, expression: "window.close()" }); } catch { /* ok */ }
        return { text: JSON.stringify(data), items: Array.isArray(data) ? data : undefined };
      };

      const result = await handleMonitorTool(tool.name, args as Record<string, unknown>, checkFn);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  });
}

// ── Start ────────────────────────────────────────────────────

async function main(): Promise<void> {
  await startBridge();

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  const total = TOOLS.length + COMPOUND_TOOLS.length + RECIPE_TOOLS.length +
    SCHEDULER_TOOLS.length + SESSION_TOOLS.length + MONITOR_TOOLS.length + KILLSWITCH_TOOLS.length;
  console.error(
    `[bridge] MCP server ready on stdio [${mode}] (${total} tools: ` +
    `${TOOLS.length} browser + ${COMPOUND_TOOLS.length} compound + ` +
    `${RECIPE_TOOLS.length} recipe + ${SCHEDULER_TOOLS.length} scheduler + ` +
    `${SESSION_TOOLS.length} session + ${MONITOR_TOOLS.length} monitor + ` +
    `${KILLSWITCH_TOOLS.length} control)`,
  );

  // Background services only in primary mode
  if (mode === "primary") {
    startScheduler();
    startMonitor(async (url, selector) => {
      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        throw new Error("Extension not connected — monitor check skipped");
      }
      const tab = (await pending.call(extensionWs, "openTab", { url })) as { tabId?: number };
      const tabId = tab?.tabId;
      if (!tabId) throw new Error("Failed to open tab for monitor");
      await new Promise((r) => setTimeout(r, 3000));
      await pending.call(extensionWs, "scrollPage", { tabId, deltaY: 600, smooth: true });
      await new Promise((r) => setTimeout(r, 500));
      const args: Record<string, unknown> = { tabId };
      if (selector) args.selector = selector;
      const data = await pending.call(extensionWs, "extractData", args);
      try { await pending.call(extensionWs, "evaluateJS", { tabId, expression: "window.close()" }); } catch { /* ok */ }
      return { text: JSON.stringify(data), items: Array.isArray(data) ? data : undefined };
    });
  }
}

main().catch((err) => {
  console.error("[bridge] Fatal:", err);
  process.exit(1);
});
