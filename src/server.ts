import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z, type ZodTypeAny } from "zod";
import { PendingCalls } from "./correlation.js";
import { TOOLS, toolToPrimitive } from "./tools.js";
import { RECIPE_TOOLS, handleRecipeTool } from "./recipe-tools.js";
import { COMPOUND_TOOLS, handleCompoundTool } from "./compound-tools.js";

// ── JSON-schema → Zod raw shape ──────────────────────────────
// The tool defs describe params as JSON schema; the MCP SDK (v1.30+) requires a
// Zod raw shape at registration. Convert here so the tool defs stay declarative.
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

// ── WebSocket server (extension connects here) ──────────────

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (ws) => {
  console.error(`[bridge] Extension connected`);
  extensionWs = ws;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle tool-call responses from the extension
      if (msg.type === "response" && msg.requestId) {
        pending.onResponse(msg);
        return;
      }

      // Other messages (state_snapshot, credentials_updated, flow, heartbeat)
      // are push events — log and ignore for MCP purposes
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

console.error(`[bridge] WebSocket server listening on 127.0.0.1:${PORT}`);

// ── MCP server (Claude Code / Cursor connects via stdio) ────

const mcp = new McpServer({
  name: "neuron-inspector",
  version: "0.2.0",
});

// Browser tools (forwarded to extension via WebSocket)
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
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });
}

// Recipe tools (local, no extension needed)
for (const tool of RECIPE_TOOLS) {
  mcp.tool(tool.name, tool.description, shapeFromSchema(tool.inputSchema as JsonProp), async (args) => {
    try {
      const result = await handleRecipeTool(tool.name, args as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });
}

// Compound tools (bridge-side orchestration, forward to extension)
for (const tool of COMPOUND_TOOLS) {
  mcp.tool(tool.name, tool.description, shapeFromSchema(tool.inputSchema as JsonProp), async (args) => {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      return {
        content: [{ type: "text", text: "Extension not connected. Open Chrome with the Neuron extension and enable developer mode." }],
        isError: true,
      };
    }

    try {
      const result = await handleCompoundTool(
        tool.name,
        args as Record<string, unknown>,
        { ws: extensionWs, pending },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });
}

// ── Start ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  const total = TOOLS.length + COMPOUND_TOOLS.length + RECIPE_TOOLS.length;
  console.error(`[bridge] MCP server ready on stdio (${total} tools: ${TOOLS.length} browser + ${COMPOUND_TOOLS.length} compound + ${RECIPE_TOOLS.length} recipe)`);
}

main().catch((err) => {
  console.error("[bridge] Fatal:", err);
  process.exit(1);
});
