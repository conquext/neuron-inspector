import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as YAML from "yaml";
import type { ToolDef } from "./tools.js";

interface SessionState {
  session_id: string;
  recipe_slug: string;
  cursor: unknown;
  working_set: unknown[];
  completed: unknown[];
  progress: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  checkpoints: number;
}

/** Returns the sessions directory, creating it if needed */
function sessionsDir(): string {
  const dir = join(homedir(), ".neuron", "sessions");
  if (!existsSync(dir)) {
    mkdir(dir, { recursive: true }).catch(() => {});
  }
  return dir;
}

/** Returns the path to a session file */
function sessionPath(sessionId: string): string {
  return join(sessionsDir(), `${sessionId}.yaml`);
}

/** Load a session from disk, returns null if not found */
async function loadSession(sessionId: string): Promise<SessionState | null> {
  const path = sessionPath(sessionId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = await readFile(path, "utf-8");
    return YAML.parse(content) as SessionState;
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error);
    return null;
  }
}

/** Save a session to disk */
async function saveSession(state: SessionState): Promise<void> {
  const path = sessionPath(state.session_id);
  const content = YAML.stringify(state);
  await writeFile(path, content, "utf-8");
}

/** Extract recipe slug from session_id (format: slug or slug-label) */
function extractRecipeSlug(sessionId: string): string {
  // If session_id contains a hyphen, take everything before the last hyphen as the slug
  // Otherwise, the whole session_id is the slug
  const parts = sessionId.split("-");
  if (parts.length > 1) {
    return parts.slice(0, -1).join("-");
  }
  return sessionId;
}

export const SESSION_TOOLS: ToolDef[] = [
  {
    name: "neuron_session_save",
    description:
      "Save or update session state. Merges with existing state to support resumption across MCP sessions.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Session identifier (typically recipe slug or slug-label, e.g. 'instagram-scrape' or 'instagram-scrape-batch1')",
        },
        cursor: {
          description:
            "Where to resume — typically an index into working_set, a page number, or an ID",
        },
        working_set: {
          type: "array",
          description: "The full list of items to process",
        },
        completed: {
          type: "array",
          description: "Items already processed",
        },
        progress: {
          type: "object",
          description:
            "Arbitrary progress data (e.g. {sent: 23, total: 50, failed: 2})",
        },
        metadata: {
          type: "object",
          description: "Any extra context (e.g. target username, config)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "neuron_session_load",
    description:
      "Load session state. Returns null if no session exists, allowing recipes to decide whether to resume or start fresh.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session identifier",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "neuron_session_list",
    description:
      "List all active sessions with progress summaries. Useful for resuming interrupted work or cleaning up stale sessions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "neuron_session_delete",
    description:
      "Delete a session (mark it complete). The session file is removed from disk.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session identifier to delete",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "neuron_session_checkpoint",
    description:
      "Quick progress update — increment cursor and move an item from working_set to completed. This is the hot-path call that recipes use after each action (e.g. after scraping one profile, sending one message, etc).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session identifier",
        },
        completed_item: {
          description:
            "The item just processed. Will be appended to the completed array.",
        },
      },
      required: ["session_id", "completed_item"],
    },
  },
];

export async function handleSessionTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "neuron_session_save": {
      const sessionId = args.session_id as string;
      if (!sessionId) {
        throw new Error("session_id is required");
      }

      // Load existing session or create new
      let state = await loadSession(sessionId);
      const now = new Date().toISOString();

      if (!state) {
        // New session
        state = {
          session_id: sessionId,
          recipe_slug: extractRecipeSlug(sessionId),
          cursor: args.cursor ?? 0,
          working_set: (args.working_set as unknown[]) ?? [],
          completed: (args.completed as unknown[]) ?? [],
          progress: (args.progress as Record<string, unknown>) ?? {},
          metadata: (args.metadata as Record<string, unknown>) ?? {},
          created_at: now,
          updated_at: now,
          checkpoints: 0,
        };
      } else {
        // Merge with existing
        if (args.cursor !== undefined) state.cursor = args.cursor;
        if (args.working_set !== undefined)
          state.working_set = args.working_set as unknown[];
        if (args.completed !== undefined)
          state.completed = args.completed as unknown[];
        if (args.progress !== undefined)
          state.progress = {
            ...state.progress,
            ...(args.progress as Record<string, unknown>),
          };
        if (args.metadata !== undefined)
          state.metadata = {
            ...state.metadata,
            ...(args.metadata as Record<string, unknown>),
          };
        state.updated_at = now;
      }

      await saveSession(state);
      return {
        status: "saved",
        session_id: sessionId,
        updated_at: state.updated_at,
      };
    }

    case "neuron_session_load": {
      const sessionId = args.session_id as string;
      if (!sessionId) {
        throw new Error("session_id is required");
      }

      const state = await loadSession(sessionId);
      return state; // Returns null if not found
    }

    case "neuron_session_list": {
      const dir = sessionsDir();
      if (!existsSync(dir)) {
        return { sessions: [] };
      }

      const files = await readdir(dir);
      const yamlFiles = files.filter((f) => f.endsWith(".yaml"));

      const sessions = await Promise.all(
        yamlFiles.map(async (file) => {
          const sessionId = file.replace(".yaml", "");
          const state = await loadSession(sessionId);
          if (!state) return null;

          return {
            session_id: state.session_id,
            recipe_slug: state.recipe_slug,
            created_at: state.created_at,
            updated_at: state.updated_at,
            checkpoints: state.checkpoints,
            progress: state.progress,
            working_set_size: state.working_set.length,
            completed_size: state.completed.length,
          };
        })
      );

      return {
        sessions: sessions.filter((s) => s !== null),
      };
    }

    case "neuron_session_delete": {
      const sessionId = args.session_id as string;
      if (!sessionId) {
        throw new Error("session_id is required");
      }

      const path = sessionPath(sessionId);
      if (existsSync(path)) {
        await unlink(path);
        return { status: "deleted", session_id: sessionId };
      }
      return { status: "not_found", session_id: sessionId };
    }

    case "neuron_session_checkpoint": {
      const sessionId = args.session_id as string;
      const completedItem = args.completed_item;

      if (!sessionId) {
        throw new Error("session_id is required");
      }
      if (completedItem === undefined) {
        throw new Error("completed_item is required");
      }

      // Fast path — load, update, save
      const state = await loadSession(sessionId);
      if (!state) {
        throw new Error(
          `Session ${sessionId} not found. Call neuron_session_save first.`
        );
      }

      // Increment cursor (assume it's numeric, but handle any type)
      if (typeof state.cursor === "number") {
        state.cursor = state.cursor + 1;
      }

      // Move item to completed
      state.completed.push(completedItem);
      state.checkpoints += 1;
      state.updated_at = new Date().toISOString();

      await saveSession(state);

      return {
        status: "checkpoint_saved",
        session_id: sessionId,
        cursor: state.cursor,
        completed_count: state.completed.length,
        checkpoints: state.checkpoints,
      };
    }

    default:
      throw new Error(`Unknown session tool: ${toolName}`);
  }
}
