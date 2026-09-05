import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "os";
import YAML from "yaml";
import type { ToolDef } from "./tools.js";

interface ScheduleEntry {
  id: string;
  slug: string;
  interval_minutes?: number;
  cron_hour?: number;
  cron_days?: number[];
  variables?: Record<string, unknown>;
  rules?: string[];
  enabled: boolean;
  created_at: string;
  last_run_at?: string;
  next_run_at?: string;
  run_count: number;
}

interface ScheduleData {
  schedules: ScheduleEntry[];
}

interface PendingRun {
  slug: string;
  variables?: Record<string, unknown>;
  rules?: string[];
  scheduled_at: string;
  schedule_id: string;
}

interface PendingRunsData {
  pending: PendingRun[];
}

const timers = new Map<string, NodeJS.Timeout>();

function schedulesPath(): string {
  const neuronDir = path.join(os.homedir(), ".neuron");
  if (!fs.existsSync(neuronDir)) {
    fs.mkdirSync(neuronDir, { recursive: true });
  }
  return path.join(neuronDir, "schedules.yaml");
}

function pendingRunsPath(): string {
  const neuronDir = path.join(os.homedir(), ".neuron");
  return path.join(neuronDir, "pending-runs.yaml");
}

function loadSchedules(): ScheduleData {
  const p = schedulesPath();
  if (!fs.existsSync(p)) {
    return { schedules: [] };
  }
  const content = fs.readFileSync(p, "utf-8");
  const data = YAML.parse(content);
  return data || { schedules: [] };
}

function saveSchedules(data: ScheduleData): void {
  const p = schedulesPath();
  fs.writeFileSync(p, YAML.stringify(data), "utf-8");
}

function loadPendingRuns(): PendingRunsData {
  const p = pendingRunsPath();
  if (!fs.existsSync(p)) {
    return { pending: [] };
  }
  const content = fs.readFileSync(p, "utf-8");
  const data = YAML.parse(content);
  return data || { pending: [] };
}

function savePendingRuns(data: PendingRunsData): void {
  const p = pendingRunsPath();
  fs.writeFileSync(p, YAML.stringify(data), "utf-8");
}

function generateId(): string {
  return `sched_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function computeNextCronRun(hour: number, days?: number[]): Date {
  const now = new Date();
  let next = new Date(now);

  next.setHours(hour, 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  if (days && days.length > 0) {
    const maxIterations = 7;
    let iterations = 0;
    while (!days.includes(next.getDay()) && iterations < maxIterations) {
      next.setDate(next.getDate() + 1);
      iterations++;
    }
  }

  return next;
}

function scheduleJob(entry: ScheduleEntry): void {
  if (!entry.enabled) return;

  clearSchedule(entry.id);

  if (entry.interval_minutes !== undefined) {
    const intervalMs = entry.interval_minutes * 60 * 1000;
    const timer = setInterval(() => {
      triggerRun(entry);
    }, intervalMs);
    timers.set(entry.id, timer);

    const nextRun = new Date(Date.now() + intervalMs);
    updateNextRun(entry.id, nextRun.toISOString());
  } else if (entry.cron_hour !== undefined) {
    const scheduleNextCron = () => {
      const nextRun = computeNextCronRun(entry.cron_hour!, entry.cron_days);
      const delayMs = nextRun.getTime() - Date.now();

      updateNextRun(entry.id, nextRun.toISOString());

      const timer = setTimeout(() => {
        triggerRun(entry);
        scheduleNextCron();
      }, delayMs);

      timers.set(entry.id, timer);
    };

    scheduleNextCron();
  }
}

function clearSchedule(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timers.delete(id);
  }
}

function triggerRun(entry: ScheduleEntry): void {
  const now = new Date().toISOString();

  console.error(`[scheduler] Triggering scheduled run: ${entry.slug} (schedule_id: ${entry.id})`);

  const pendingData = loadPendingRuns();
  pendingData.pending.push({
    slug: entry.slug,
    variables: entry.variables,
    rules: entry.rules,
    scheduled_at: now,
    schedule_id: entry.id,
  });
  savePendingRuns(pendingData);

  const data = loadSchedules();
  const idx = data.schedules.findIndex((s) => s.id === entry.id);
  if (idx !== -1) {
    data.schedules[idx].last_run_at = now;
    data.schedules[idx].run_count = (data.schedules[idx].run_count || 0) + 1;
    saveSchedules(data);
  }
}

function updateNextRun(id: string, nextRunAt: string): void {
  const data = loadSchedules();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx !== -1) {
    data.schedules[idx].next_run_at = nextRunAt;
    saveSchedules(data);
  }
}

export function startScheduler(): void {
  const data = loadSchedules();
  for (const entry of data.schedules) {
    if (entry.enabled) {
      scheduleJob(entry);
    }
  }
  console.error(`[scheduler] Started ${data.schedules.filter((s) => s.enabled).length} schedule(s)`);
}

export const SCHEDULER_TOOLS: ToolDef[] = [
  {
    name: "neuron_schedule_recipe",
    description: "Schedule a recipe to run on an interval or at a specific time",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Recipe slug to schedule",
        },
        interval_minutes: {
          type: "number",
          description: "Run every N minutes (mutually exclusive with cron_hour)",
        },
        cron_hour: {
          type: "number",
          description: "Run daily at this hour 0-23 (mutually exclusive with interval_minutes)",
          minimum: 0,
          maximum: 23,
        },
        cron_days: {
          type: "array",
          items: {
            type: "number",
            minimum: 0,
            maximum: 6,
          },
          description: "Days of week to run (0=Sunday, 6=Saturday). Only valid with cron_hour.",
        },
        variables: {
          type: "object",
          description: "Variables to pass to the recipe",
        },
        rules: {
          type: "array",
          items: { type: "string" },
          description: "Rules to pass to the recipe",
        },
        enabled: {
          type: "boolean",
          description: "Whether the schedule is enabled",
          default: true,
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_schedule_list",
    description: "List all scheduled recipes with their next run time, last run time, run count, and enabled status",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "neuron_schedule_remove",
    description: "Remove a scheduled recipe",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: {
          type: "string",
          description: "ID of the schedule to remove",
        },
      },
      required: ["schedule_id"],
    },
  },
  {
    name: "neuron_schedule_toggle",
    description: "Enable or disable a schedule without removing it",
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: {
          type: "string",
          description: "ID of the schedule to toggle",
        },
        enabled: {
          type: "boolean",
          description: "Whether to enable or disable the schedule",
        },
      },
      required: ["schedule_id", "enabled"],
    },
  },
];

export async function handleSchedulerTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case "neuron_schedule_recipe": {
      const { slug, interval_minutes, cron_hour, cron_days, variables, rules, enabled } = args;

      if (typeof slug !== "string") {
        throw new Error("slug must be a string");
      }

      if (interval_minutes !== undefined && cron_hour !== undefined) {
        throw new Error("Cannot specify both interval_minutes and cron_hour");
      }

      if (interval_minutes === undefined && cron_hour === undefined) {
        throw new Error("Must specify either interval_minutes or cron_hour");
      }

      if (cron_days !== undefined && cron_hour === undefined) {
        throw new Error("cron_days can only be used with cron_hour");
      }

      const entry: ScheduleEntry = {
        id: generateId(),
        slug,
        interval_minutes: interval_minutes as number | undefined,
        cron_hour: cron_hour as number | undefined,
        cron_days: cron_days as number[] | undefined,
        variables: variables as Record<string, unknown> | undefined,
        rules: rules as string[] | undefined,
        enabled: enabled !== undefined ? (enabled as boolean) : true,
        created_at: new Date().toISOString(),
        run_count: 0,
      };

      const data = loadSchedules();
      data.schedules.push(entry);
      saveSchedules(data);

      if (entry.enabled) {
        scheduleJob(entry);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                schedule_id: entry.id,
                message: `Scheduled recipe ${slug}${
                  entry.interval_minutes
                    ? ` to run every ${entry.interval_minutes} minutes`
                    : entry.cron_hour !== undefined
                      ? ` to run daily at ${entry.cron_hour}:00${
                          entry.cron_days ? ` on days ${entry.cron_days.join(", ")}` : ""
                        }`
                      : ""
                }`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "neuron_schedule_list": {
      const data = loadSchedules();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                schedules: data.schedules.map((s) => ({
                  id: s.id,
                  slug: s.slug,
                  interval_minutes: s.interval_minutes,
                  cron_hour: s.cron_hour,
                  cron_days: s.cron_days,
                  enabled: s.enabled,
                  created_at: s.created_at,
                  last_run_at: s.last_run_at,
                  next_run_at: s.next_run_at,
                  run_count: s.run_count,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "neuron_schedule_remove": {
      const { schedule_id } = args;

      if (typeof schedule_id !== "string") {
        throw new Error("schedule_id must be a string");
      }

      const data = loadSchedules();
      const idx = data.schedules.findIndex((s) => s.id === schedule_id);

      if (idx === -1) {
        throw new Error(`Schedule ${schedule_id} not found`);
      }

      clearSchedule(schedule_id);
      data.schedules.splice(idx, 1);
      saveSchedules(data);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Removed schedule ${schedule_id}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "neuron_schedule_toggle": {
      const { schedule_id, enabled } = args;

      if (typeof schedule_id !== "string") {
        throw new Error("schedule_id must be a string");
      }

      if (typeof enabled !== "boolean") {
        throw new Error("enabled must be a boolean");
      }

      const data = loadSchedules();
      const idx = data.schedules.findIndex((s) => s.id === schedule_id);

      if (idx === -1) {
        throw new Error(`Schedule ${schedule_id} not found`);
      }

      data.schedules[idx].enabled = enabled;
      saveSchedules(data);

      if (enabled) {
        scheduleJob(data.schedules[idx]);
      } else {
        clearSchedule(schedule_id);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Schedule ${schedule_id} ${enabled ? "enabled" : "disabled"}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown scheduler tool: ${name}`);
  }
}
