import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { PendingCalls } from "./correlation.js";
import { TOOLS, toolToPrimitive } from "./tools.js";
import { RECIPE_TOOLS, handleRecipeTool } from "./recipe-tools.js";

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
  mcp.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
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
  mcp.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
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

// ── Start ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error(`[bridge] MCP server ready on stdio (${TOOLS.length} browser + ${RECIPE_TOOLS.length} recipe tools)`);
}

main().catch((err) => {
  console.error("[bridge] Fatal:", err);
  process.exit(1);
});
