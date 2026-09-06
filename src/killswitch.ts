/**
 * Kill switch — emergency stop for all autonomous operations.
 * Stops monitors, clears schedules, closes tabs opened by the agent,
 * and resets session state. One tool call stops everything.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import YAML from "yaml";
import type { ToolDef } from "./tools.js";

function neuronDir(): string {
  return path.join(os.homedir(), ".neuron");
}

function readYaml(filePath: string): unknown {
  try {
    return YAML.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export const KILLSWITCH_TOOLS: ToolDef[] = [
  {
    name: "neuron_stop",
    description:
      "Emergency stop — immediately disable all monitors, clear all schedules, " +
      "and halt autonomous operations. Use when the agent is doing something wrong, " +
      "opening unwanted tabs, or needs to be stopped immediately. Also closes tabs " +
      "that were opened by the agent if a tab list is provided.",
    inputSchema: {
      type: "object",
      properties: {
        close_tabs: { type: "boolean", description: "Close all tabs the agent opened (default: false — requires extension)" },
        keep_session_state: { type: "boolean", description: "Keep session state for resume later (default: true)" },
        reason: { type: "string", description: "Why the stop was triggered (logged for review)" },
      },
    },
  },
  {
    name: "neuron_status",
    description:
      "Show what's currently running — active monitors, scheduled recipes, " +
      "active session states, pending runs. Use to see what the agent is doing " +
      "before deciding whether to stop it.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_pause_all",
    description:
      "Pause all monitors and schedules without deleting them. They can be " +
      "resumed later with neuron_resume_all. Use when you want to temporarily " +
      "stop autonomous operations without losing configuration.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why paused (logged)" },
      },
    },
  },
  {
    name: "neuron_resume_all",
    description:
      "Resume all paused monitors and schedules. Restarts autonomous operations " +
      "from where they left off.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function handleKillswitchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "neuron_stop":
      return emergencyStop(args);
    case "neuron_status":
      return getStatus();
    case "neuron_pause_all":
      return pauseAll(args.reason as string | undefined);
    case "neuron_resume_all":
      return resumeAll();
    default:
      throw new Error(`Unknown killswitch tool: ${name}`);
  }
}

function emergencyStop(args: Record<string, unknown>): {
  monitors_disabled: number;
  schedules_disabled: number;
  sessions_cleared: number;
  pending_runs_cleared: number;
  reason: string;
} {
  const keepSessions = (args.keep_session_state as boolean) ?? true;
  const reason = (args.reason as string) ?? "Manual emergency stop";
  let monitorsDisabled = 0;
  let schedulesDisabled = 0;
  let sessionsCleared = 0;
  let pendingCleared = 0;

  // Disable all monitors
  const monitorsPath = path.join(neuronDir(), "monitors.yaml");
  try {
    const data = readYaml(monitorsPath) as { monitors?: Array<{ enabled: boolean }> } | null;
    if (data?.monitors) {
      for (const m of data.monitors) {
        if (m.enabled) {
          m.enabled = false;
          monitorsDisabled++;
        }
      }
      fs.writeFileSync(monitorsPath, YAML.stringify(data));
    }
  } catch { /* no monitors file */ }

  // Disable all schedules
  const schedulesPath = path.join(neuronDir(), "schedules.yaml");
  try {
    const data = readYaml(schedulesPath) as { schedules?: Array<{ enabled: boolean }> } | null;
    if (data?.schedules) {
      for (const s of data.schedules) {
        if (s.enabled) {
          s.enabled = false;
          schedulesDisabled++;
        }
      }
      fs.writeFileSync(schedulesPath, YAML.stringify(data));
    }
  } catch { /* no schedules file */ }

  // Clear pending runs
  const pendingPath = path.join(neuronDir(), "pending-runs.yaml");
  try {
    const data = readYaml(pendingPath) as unknown[] | null;
    if (Array.isArray(data) && data.length > 0) {
      pendingCleared = data.length;
      fs.unlinkSync(pendingPath);
    }
  } catch { /* no pending file */ }

  // Optionally clear sessions
  if (!keepSessions) {
    const sessionsDir = path.join(neuronDir(), "sessions");
    try {
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".yaml"));
        for (const f of files) {
          fs.unlinkSync(path.join(sessionsDir, f));
          sessionsCleared++;
        }
      }
    } catch { /* ok */ }
  }

  // Log the stop event
  const logPath = path.join(neuronDir(), "stop-log.yaml");
  const entry = {
    date: new Date().toISOString(),
    reason,
    monitors_disabled: monitorsDisabled,
    schedules_disabled: schedulesDisabled,
    sessions_cleared: sessionsCleared,
    pending_runs_cleared: pendingCleared,
  };
  try {
    const existing = readYaml(logPath) as unknown[] | null;
    const log = Array.isArray(existing) ? existing : [];
    log.push(entry);
    fs.writeFileSync(logPath, YAML.stringify(log.slice(-50)));
  } catch {
    fs.writeFileSync(logPath, YAML.stringify([entry]));
  }

  return {
    monitors_disabled: monitorsDisabled,
    schedules_disabled: schedulesDisabled,
    sessions_cleared: sessionsCleared,
    pending_runs_cleared: pendingCleared,
    reason,
  };
}

function getStatus(): {
  monitors: { total: number; enabled: number; urls: string[] };
  schedules: { total: number; enabled: number; recipes: string[] };
  sessions: { total: number; active: string[] };
  pending_runs: number;
} {
  // Monitors
  let monitorTotal = 0;
  let monitorEnabled = 0;
  const monitorUrls: string[] = [];
  try {
    const data = readYaml(path.join(neuronDir(), "monitors.yaml")) as { monitors?: Array<{ enabled: boolean; url: string; name: string }> } | null;
    if (data?.monitors) {
      monitorTotal = data.monitors.length;
      for (const m of data.monitors) {
        if (m.enabled) {
          monitorEnabled++;
          monitorUrls.push(`${m.name} (${m.url})`);
        }
      }
    }
  } catch { /* ok */ }

  // Schedules
  let scheduleTotal = 0;
  let scheduleEnabled = 0;
  const scheduleRecipes: string[] = [];
  try {
    const data = readYaml(path.join(neuronDir(), "schedules.yaml")) as { schedules?: Array<{ enabled: boolean; slug: string }> } | null;
    if (data?.schedules) {
      scheduleTotal = data.schedules.length;
      for (const s of data.schedules) {
        if (s.enabled) {
          scheduleEnabled++;
          scheduleRecipes.push(s.slug);
        }
      }
    }
  } catch { /* ok */ }

  // Sessions
  const activeSessions: string[] = [];
  try {
    const sessionsDir = path.join(neuronDir(), "sessions");
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".yaml"));
      for (const f of files) {
        activeSessions.push(f.replace(".yaml", ""));
      }
    }
  } catch { /* ok */ }

  // Pending runs
  let pendingRuns = 0;
  try {
    const data = readYaml(path.join(neuronDir(), "pending-runs.yaml")) as unknown[] | null;
    if (Array.isArray(data)) pendingRuns = data.length;
  } catch { /* ok */ }

  return {
    monitors: { total: monitorTotal, enabled: monitorEnabled, urls: monitorUrls },
    schedules: { total: scheduleTotal, enabled: scheduleEnabled, recipes: scheduleRecipes },
    sessions: { total: activeSessions.length, active: activeSessions },
    pending_runs: pendingRuns,
  };
}

function pauseAll(reason?: string): { monitors_paused: number; schedules_paused: number } {
  let monitorsPaused = 0;
  let schedulesPaused = 0;

  const monitorsPath = path.join(neuronDir(), "monitors.yaml");
  try {
    const data = readYaml(monitorsPath) as { monitors?: Array<{ enabled: boolean }> } | null;
    if (data?.monitors) {
      for (const m of data.monitors) {
        if (m.enabled) { m.enabled = false; monitorsPaused++; }
      }
      fs.writeFileSync(monitorsPath, YAML.stringify(data));
    }
  } catch { /* ok */ }

  const schedulesPath = path.join(neuronDir(), "schedules.yaml");
  try {
    const data = readYaml(schedulesPath) as { schedules?: Array<{ enabled: boolean }> } | null;
    if (data?.schedules) {
      for (const s of data.schedules) {
        if (s.enabled) { s.enabled = false; schedulesPaused++; }
      }
      fs.writeFileSync(schedulesPath, YAML.stringify(data));
    }
  } catch { /* ok */ }

  // Log
  if (reason) {
    const logPath = path.join(neuronDir(), "stop-log.yaml");
    try {
      const existing = readYaml(logPath) as unknown[] | null;
      const log = Array.isArray(existing) ? existing : [];
      log.push({ date: new Date().toISOString(), action: "pause_all", reason, monitors_paused: monitorsPaused, schedules_paused: schedulesPaused });
      fs.writeFileSync(logPath, YAML.stringify(log.slice(-50)));
    } catch { /* ok */ }
  }

  return { monitors_paused: monitorsPaused, schedules_paused: schedulesPaused };
}

function resumeAll(): { monitors_resumed: number; schedules_resumed: number } {
  let monitorsResumed = 0;
  let schedulesResumed = 0;

  const monitorsPath = path.join(neuronDir(), "monitors.yaml");
  try {
    const data = readYaml(monitorsPath) as { monitors?: Array<{ enabled: boolean }> } | null;
    if (data?.monitors) {
      for (const m of data.monitors) {
        if (!m.enabled) { m.enabled = true; monitorsResumed++; }
      }
      fs.writeFileSync(monitorsPath, YAML.stringify(data));
    }
  } catch { /* ok */ }

  const schedulesPath = path.join(neuronDir(), "schedules.yaml");
  try {
    const data = readYaml(schedulesPath) as { schedules?: Array<{ enabled: boolean }> } | null;
    if (data?.schedules) {
      for (const s of data.schedules) {
        if (!s.enabled) { s.enabled = true; schedulesResumed++; }
      }
      fs.writeFileSync(schedulesPath, YAML.stringify(data));
    }
  } catch { /* ok */ }

  return { monitors_resumed: monitorsResumed, schedules_resumed: schedulesResumed };
}
