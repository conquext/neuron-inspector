import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import YAML from "yaml";
import type { ToolDef } from "./tools.js";

interface MonitorConfig {
  id: string;
  url: string;
  name: string;
  check_interval_minutes: number;
  condition: {
    type: "content_change" | "text_appears" | "text_disappears" | "price_below" | "new_items" | "selector_change";
    selector?: string;
    text?: string;
    threshold?: number;
    baseline?: string;
  };
  enabled: boolean;
  created_at: string;
  last_check_at?: string;
  last_result?: string;
  alert_count: number;
}

interface MonitorAlert {
  monitor_id: string;
  monitor_name: string;
  url: string;
  condition_type: string;
  triggered_at: string;
  details: string;
  previous_value?: string;
  current_value?: string;
}

interface MonitorStore {
  monitors: MonitorConfig[];
}

interface AlertStore {
  alerts: MonitorAlert[];
}

type CheckFn = (url: string, selector?: string) => Promise<{ text: string; items?: unknown[] }>;

const NEURON_DIR = path.join(os.homedir(), ".neuron");
const MONITORS_FILE = path.join(NEURON_DIR, "monitors.yaml");
const ALERTS_FILE = path.join(NEURON_DIR, "monitor-alerts.yaml");
const MAX_ALERTS = 100;

const activeIntervals = new Map<string, NodeJS.Timeout>();

function ensureNeuronDir(): void {
  if (!fs.existsSync(NEURON_DIR)) {
    fs.mkdirSync(NEURON_DIR, { recursive: true });
  }
}

function monitorsPath(): string {
  return MONITORS_FILE;
}

function alertsPath(): string {
  return ALERTS_FILE;
}

function loadMonitors(): MonitorConfig[] {
  ensureNeuronDir();
  if (!fs.existsSync(MONITORS_FILE)) {
    return [];
  }
  const content = fs.readFileSync(MONITORS_FILE, "utf-8");
  const store = YAML.parse(content) as MonitorStore | null;
  return store?.monitors || [];
}

function saveMonitors(monitors: MonitorConfig[]): void {
  ensureNeuronDir();
  const store: MonitorStore = { monitors };
  fs.writeFileSync(MONITORS_FILE, YAML.stringify(store), "utf-8");
}

function loadAlerts(): MonitorAlert[] {
  ensureNeuronDir();
  if (!fs.existsSync(ALERTS_FILE)) {
    return [];
  }
  const content = fs.readFileSync(ALERTS_FILE, "utf-8");
  const store = YAML.parse(content) as AlertStore | null;
  return store?.alerts || [];
}

function saveAlerts(alerts: MonitorAlert[]): void {
  ensureNeuronDir();
  const trimmed = alerts.slice(-MAX_ALERTS);
  const store: AlertStore = { alerts: trimmed };
  fs.writeFileSync(ALERTS_FILE, YAML.stringify(store), "utf-8");
}

function addAlert(alert: MonitorAlert): void {
  const alerts = loadAlerts();
  alerts.push(alert);
  saveAlerts(alerts);
}

function generateId(): string {
  return `mon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

async function checkMonitor(
  monitor: MonitorConfig,
  checkFn: CheckFn
): Promise<{ triggered: boolean; details?: string; currentValue?: string }> {
  try {
    const result = await checkFn(monitor.url, monitor.condition.selector);
    const { condition } = monitor;

    switch (condition.type) {
      case "content_change": {
        if (!condition.baseline) {
          return { triggered: false, currentValue: result.text };
        }
        if (result.text !== condition.baseline) {
          return {
            triggered: true,
            details: "Content changed",
            currentValue: result.text,
          };
        }
        return { triggered: false };
      }

      case "text_appears": {
        if (!condition.text) {
          throw new Error("text_appears condition requires 'text' parameter");
        }
        if (result.text.includes(condition.text)) {
          return {
            triggered: true,
            details: `Text "${condition.text}" appeared on page`,
            currentValue: result.text,
          };
        }
        return { triggered: false };
      }

      case "text_disappears": {
        if (!condition.text) {
          throw new Error("text_disappears condition requires 'text' parameter");
        }
        if (!condition.baseline) {
          return { triggered: false, currentValue: result.text };
        }
        if (condition.baseline.includes(condition.text) && !result.text.includes(condition.text)) {
          return {
            triggered: true,
            details: `Text "${condition.text}" disappeared from page`,
            currentValue: result.text,
          };
        }
        return { triggered: false };
      }

      case "price_below": {
        if (condition.threshold === undefined) {
          throw new Error("price_below condition requires 'threshold' parameter");
        }
        const priceMatch = result.text.match(/[\$\u20A6\u20AC\u00A3]?\s*([0-9,]+\.?[0-9]*)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/,/g, ""));
          if (price < condition.threshold) {
            return {
              triggered: true,
              details: `Price ${price} is below threshold ${condition.threshold}`,
              currentValue: price.toString(),
            };
          }
        }
        return { triggered: false };
      }

      case "new_items": {
        if (!condition.baseline) {
          return { triggered: false, currentValue: JSON.stringify(result.items || []) };
        }
        const baselineItems = JSON.parse(condition.baseline) as unknown[];
        const currentItems = result.items || [];
        if (currentItems.length > baselineItems.length) {
          return {
            triggered: true,
            details: `New items detected: ${currentItems.length - baselineItems.length} added`,
            currentValue: JSON.stringify(currentItems),
          };
        }
        return { triggered: false };
      }

      case "selector_change": {
        if (!condition.selector) {
          throw new Error("selector_change condition requires 'selector' parameter");
        }
        if (!condition.baseline) {
          return { triggered: false, currentValue: result.text };
        }
        if (result.text !== condition.baseline) {
          return {
            triggered: true,
            details: "Selector content changed",
            currentValue: result.text,
          };
        }
        return { triggered: false };
      }

      default:
        throw new Error(`Unknown condition type: ${condition.type}`);
    }
  } catch (error) {
    console.error(`Monitor check failed for ${monitor.id}:`, error);
    return { triggered: false };
  }
}

async function runMonitorCheck(monitor: MonitorConfig, checkFn: CheckFn): Promise<void> {
  const checkResult = await checkMonitor(monitor, checkFn);
  const monitors = loadMonitors();
  const monitorIndex = monitors.findIndex((m) => m.id === monitor.id);

  if (monitorIndex === -1) return;

  monitors[monitorIndex].last_check_at = new Date().toISOString();

  if (!monitors[monitorIndex].condition.baseline && checkResult.currentValue) {
    monitors[monitorIndex].condition.baseline = checkResult.currentValue;
  }

  if (checkResult.triggered) {
    monitors[monitorIndex].alert_count += 1;
    monitors[monitorIndex].last_result = "triggered";

    const alert: MonitorAlert = {
      monitor_id: monitor.id,
      monitor_name: monitor.name,
      url: monitor.url,
      condition_type: monitor.condition.type,
      triggered_at: new Date().toISOString(),
      details: checkResult.details || "Condition met",
      previous_value: monitor.condition.baseline,
      current_value: checkResult.currentValue,
    };

    addAlert(alert);
    console.error(`[MONITOR ALERT] ${monitor.name}: ${alert.details}`);

    if (checkResult.currentValue) {
      monitors[monitorIndex].condition.baseline = checkResult.currentValue;
    }
  } else {
    monitors[monitorIndex].last_result = "no_change";
  }

  saveMonitors(monitors);
}

export function startMonitor(checkFn: CheckFn): void {
  for (const interval of activeIntervals.values()) {
    clearInterval(interval);
  }
  activeIntervals.clear();

  const monitors = loadMonitors();

  for (const monitor of monitors) {
    if (!monitor.enabled) continue;

    const intervalMs = monitor.check_interval_minutes * 60 * 1000;
    const interval = setInterval(() => {
      runMonitorCheck(monitor, checkFn).catch((err) => {
        console.error(`Error running monitor ${monitor.id}:`, err);
      });
    }, intervalMs);

    activeIntervals.set(monitor.id, interval);
  }
}

export async function handleMonitorTool(
  name: string,
  args: Record<string, unknown>,
  checkFn?: CheckFn
): Promise<unknown> {
  switch (name) {
    case "neuron_monitor_create": {
      const url = args.url as string;
      const monitorName = args.name as string;
      const checkIntervalMinutes = (args.check_interval_minutes as number) || 60;
      const condition = args.condition as MonitorConfig["condition"];
      const enabled = args.enabled !== undefined ? (args.enabled as boolean) : true;

      if (!url || !monitorName || !condition) {
        throw new Error("Missing required parameters: url, name, condition");
      }

      const monitor: MonitorConfig = {
        id: generateId(),
        url,
        name: monitorName,
        check_interval_minutes: checkIntervalMinutes,
        condition,
        enabled,
        created_at: new Date().toISOString(),
        alert_count: 0,
      };

      const monitors = loadMonitors();
      monitors.push(monitor);
      saveMonitors(monitors);

      if (enabled && checkFn) {
        const intervalMs = checkIntervalMinutes * 60 * 1000;
        const interval = setInterval(() => {
          runMonitorCheck(monitor, checkFn).catch((err) => {
            console.error(`Error running monitor ${monitor.id}:`, err);
          });
        }, intervalMs);
        activeIntervals.set(monitor.id, interval);
      }

      return {
        success: true,
        monitor_id: monitor.id,
        message: `Monitor "${monitorName}" created successfully`,
      };
    }

    case "neuron_monitor_list": {
      const monitors = loadMonitors();
      return {
        monitors: monitors.map((m) => ({
          id: m.id,
          name: m.name,
          url: m.url,
          enabled: m.enabled,
          check_interval_minutes: m.check_interval_minutes,
          condition_type: m.condition.type,
          created_at: m.created_at,
          last_check_at: m.last_check_at,
          last_result: m.last_result,
          alert_count: m.alert_count,
        })),
      };
    }

    case "neuron_monitor_remove": {
      const monitorId = args.monitor_id as string;
      if (!monitorId) {
        throw new Error("Missing required parameter: monitor_id");
      }

      const monitors = loadMonitors();
      const filtered = monitors.filter((m) => m.id !== monitorId);

      if (filtered.length === monitors.length) {
        throw new Error(`Monitor ${monitorId} not found`);
      }

      saveMonitors(filtered);

      const interval = activeIntervals.get(monitorId);
      if (interval) {
        clearInterval(interval);
        activeIntervals.delete(monitorId);
      }

      return {
        success: true,
        message: `Monitor ${monitorId} removed`,
      };
    }

    case "neuron_monitor_check": {
      if (!checkFn) {
        throw new Error("Check function not available");
      }

      const monitorId = args.monitor_id as string | undefined;
      const monitors = loadMonitors();

      if (monitorId) {
        const monitor = monitors.find((m) => m.id === monitorId);
        if (!monitor) {
          throw new Error(`Monitor ${monitorId} not found`);
        }

        await runMonitorCheck(monitor, checkFn);
        const updated = loadMonitors().find((m) => m.id === monitorId);

        return {
          monitor_id: monitorId,
          last_check_at: updated?.last_check_at,
          last_result: updated?.last_result,
          alert_count: updated?.alert_count,
        };
      } else {
        const results = [];
        for (const monitor of monitors) {
          if (monitor.enabled) {
            await runMonitorCheck(monitor, checkFn);
            const updated = loadMonitors().find((m) => m.id === monitor.id);
            results.push({
              monitor_id: monitor.id,
              name: monitor.name,
              last_check_at: updated?.last_check_at,
              last_result: updated?.last_result,
            });
          }
        }
        return { checks: results };
      }
    }

    case "neuron_monitor_alerts": {
      const limit = (args.limit as number) || 20;
      const alerts = loadAlerts();
      return {
        alerts: alerts.slice(-limit).reverse(),
      };
    }

    default:
      throw new Error(`Unknown monitor tool: ${name}`);
  }
}

export const MONITOR_TOOLS: ToolDef[] = [
  {
    name: "neuron_monitor_create",
    description:
      "Create a persistent page monitor that watches a URL for changes and alerts when conditions are met (price drops, new job postings, content changes). Monitors run in the background at specified intervals.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to monitor",
        },
        name: {
          type: "string",
          description: "Human-readable name for this monitor",
        },
        check_interval_minutes: {
          type: "number",
          description: "How often to check the page (in minutes). Default: 60",
          default: 60,
        },
        condition: {
          type: "object",
          description: "The condition to watch for",
          properties: {
            type: {
              type: "string",
              enum: [
                "content_change",
                "text_appears",
                "text_disappears",
                "price_below",
                "new_items",
                "selector_change",
              ],
              description:
                "Type of condition: content_change (any change), text_appears, text_disappears, price_below (numeric comparison), new_items (list growth), selector_change (specific element change)",
            },
            selector: {
              type: "string",
              description: "CSS selector to watch (optional, used for selector_change and to narrow scope)",
            },
            text: {
              type: "string",
              description: "Text to match for text_appears or text_disappears conditions",
            },
            threshold: {
              type: "number",
              description: "Numeric threshold for price_below condition",
            },
          },
          required: ["type"],
        },
        enabled: {
          type: "boolean",
          description: "Whether the monitor is active. Default: true",
          default: true,
        },
      },
      required: ["url", "name", "condition"],
    },
  },
  {
    name: "neuron_monitor_list",
    description: "List all monitors with their status, last check time, and alert count",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "neuron_monitor_remove",
    description: "Remove a monitor by ID",
    inputSchema: {
      type: "object",
      properties: {
        monitor_id: {
          type: "string",
          description: "The ID of the monitor to remove",
        },
      },
      required: ["monitor_id"],
    },
  },
  {
    name: "neuron_monitor_check",
    description: "Force an immediate check on a monitor (or all monitors if no ID provided)",
    inputSchema: {
      type: "object",
      properties: {
        monitor_id: {
          type: "string",
          description: "The ID of the monitor to check. If omitted, checks all enabled monitors.",
        },
      },
    },
  },
  {
    name: "neuron_monitor_alerts",
    description: "Get recent alerts (triggered conditions) from monitors",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of alerts to return. Default: 20",
          default: 20,
        },
      },
    },
  },
];
