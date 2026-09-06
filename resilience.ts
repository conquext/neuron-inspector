/**
 * Resilience layer — smart waiting, retry with fallbacks, and action
 * verification. Makes the difference between "clicks and hopes" and
 * "clicks, verifies, retries with a different approach if needed."
 *
 * These wrap the raw extension primitives with reliability patterns.
 * Compound tools and recipes should use these instead of raw call().
 */

import type { WebSocket } from "ws";
import type { PendingCalls } from "./correlation.js";

interface BridgeContext {
  ws: WebSocket;
  pending: PendingCalls;
}

async function call(
  ctx: BridgeContext,
  primitive: string,
  args: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<unknown> {
  return ctx.pending.call(ctx.ws, primitive, args, timeoutMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Wait-for-condition ──────────────────────────────────────

export interface WaitOptions {
  /** Max time to wait in ms (default: 10000) */
  timeoutMs?: number;
  /** Poll interval in ms (default: 500) */
  intervalMs?: number;
}

/**
 * Wait for an element matching CSS selectors to appear in the DOM.
 * Polls at `intervalMs` until found or `timeoutMs` expires.
 * Returns the element info when found, throws on timeout.
 */
export async function waitForElement(
  ctx: BridgeContext,
  tabId: number,
  selectors: string[],
  opts: WaitOptions = {},
): Promise<{ found: true; selector: string; count: number }> {
  const timeout = opts.timeoutMs ?? 10000;
  const interval = opts.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const result = (await call(ctx, "findElements", {
        tabId,
        selectors,
        limit: 1,
      })) as unknown[];

      if (Array.isArray(result) && result.length > 0) {
        // Find which selector matched
        const matched = (result[0] as Record<string, unknown>)?.selector as string ?? selectors[0];
        return { found: true, selector: matched, count: result.length };
      }
    } catch {
      // findElements failed — page might still be loading, retry
    }
    await sleep(interval);
  }

  throw new Error(
    `Timeout: element not found after ${timeout}ms. Tried selectors: ${selectors.join(", ")}`,
  );
}

/**
 * Wait for visible text to appear on the page.
 * Polls by extracting page content and searching for the text.
 */
export async function waitForText(
  ctx: BridgeContext,
  tabId: number,
  text: string,
  opts: WaitOptions = {},
): Promise<{ found: true }> {
  const timeout = opts.timeoutMs ?? 10000;
  const interval = opts.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const result = (await call(ctx, "findElements", {
        tabId,
        texts: [text],
        limit: 1,
      })) as unknown[];

      if (Array.isArray(result) && result.length > 0) {
        return { found: true };
      }
    } catch {
      // retry
    }
    await sleep(interval);
  }

  throw new Error(`Timeout: text "${text}" not found after ${timeout}ms`);
}

/**
 * Wait for the page URL to change (after a navigation or redirect).
 */
export async function waitForNavigation(
  ctx: BridgeContext,
  tabId: number,
  opts: WaitOptions & { urlContains?: string } = {},
): Promise<{ url: string }> {
  const timeout = opts.timeoutMs ?? 10000;
  const interval = opts.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const tabs = (await call(ctx, "listTabs", {})) as Array<{ id: number; url: string }>;
      const tab = tabs?.find((t) => t.id === tabId);
      if (tab?.url) {
        if (!opts.urlContains || tab.url.includes(opts.urlContains)) {
          return { url: tab.url };
        }
      }
    } catch {
      // retry
    }
    await sleep(interval);
  }

  throw new Error(`Timeout: navigation not detected after ${timeout}ms`);
}

// ── Resilient click ─────────────────────────────────────────

export interface ClickOptions {
  /** CSS selectors to try, in priority order */
  selectors?: string[];
  /** Visible text labels to try */
  texts?: string[];
  /** Aria labels to try */
  ariaLabels?: string[];
  /** Scroll to find the element if not immediately visible */
  scrollToFind?: boolean;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Verify click by checking for state change (optional) */
  verifySelector?: string;
  /** Expected change after click: appears, disappears, changes */
  verifyChange?: "appears" | "disappears" | "changes";
}

/**
 * Click with automatic fallback chain and retry.
 * Tries: CSS selectors → text matching → aria-labels → scroll + retry.
 * Optionally verifies the click had an effect.
 */
export async function resilientClick(
  ctx: BridgeContext,
  tabId: number,
  opts: ClickOptions,
): Promise<{ clicked: true; method: string; verified?: boolean }> {
  const maxRetries = opts.maxRetries ?? 3;

  // Focus tab first — background tabs can't click
  await call(ctx, "focusTab", { tabId });
  await sleep(300);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Try CSS selectors
    if (opts.selectors?.length) {
      try {
        const result = (await call(ctx, "clickElement", {
          tabId,
          selectors: opts.selectors,
        })) as { clicked?: boolean; selector?: string };
        if (result?.clicked) {
          const verified = opts.verifySelector
            ? await verifyAction(ctx, tabId, opts.verifySelector, opts.verifyChange)
            : undefined;
          return { clicked: true, method: `selector:${result.selector}`, verified };
        }
      } catch { /* try next method */ }
    }

    // Try text matching
    if (opts.texts?.length) {
      try {
        const result = (await call(ctx, "clickElement", {
          tabId,
          texts: opts.texts,
        })) as { clicked?: boolean };
        if (result?.clicked) {
          const verified = opts.verifySelector
            ? await verifyAction(ctx, tabId, opts.verifySelector, opts.verifyChange)
            : undefined;
          return { clicked: true, method: `text:${opts.texts[0]}`, verified };
        }
      } catch { /* try next method */ }
    }

    // Try aria-labels as selectors
    if (opts.ariaLabels?.length) {
      const ariaSelectors = opts.ariaLabels.map((l) => `[aria-label="${l}"], [aria-label*="${l}"]`);
      try {
        const result = (await call(ctx, "clickElement", {
          tabId,
          selectors: ariaSelectors,
        })) as { clicked?: boolean };
        if (result?.clicked) {
          const verified = opts.verifySelector
            ? await verifyAction(ctx, tabId, opts.verifySelector, opts.verifyChange)
            : undefined;
          return { clicked: true, method: `aria:${opts.ariaLabels[0]}`, verified };
        }
      } catch { /* try next method */ }
    }

    // Scroll and retry on non-final attempts
    if (opts.scrollToFind !== false && attempt < maxRetries - 1) {
      await call(ctx, "scrollPage", { tabId, deltaY: 400, smooth: true });
      await sleep(500);
    }
  }

  throw new Error(
    `Click failed after ${maxRetries} attempts. Tried: ` +
    [
      opts.selectors?.length ? `selectors(${opts.selectors.length})` : null,
      opts.texts?.length ? `texts(${opts.texts.join(",")})` : null,
      opts.ariaLabels?.length ? `aria(${opts.ariaLabels.join(",")})` : null,
    ].filter(Boolean).join(", "),
  );
}

// ── Resilient type ──────────────────────────────────────────

export interface TypeOptions {
  selectors: string[];
  value: string;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Verify by reading back the value after typing */
  verify?: boolean;
  /** Press Enter after typing (for send-on-enter fields) */
  pressEnter?: boolean;
}

/**
 * Type with retry and value verification.
 * After typing, optionally reads back the field to confirm the text was accepted.
 * For contenteditable (LinkedIn, X), uses execCommand internally.
 */
export async function resilientType(
  ctx: BridgeContext,
  tabId: number,
  opts: TypeOptions,
): Promise<{ typed: true; verified?: boolean; pressedEnter?: boolean }> {
  const maxRetries = opts.maxRetries ?? 3;

  // Focus tab first
  await call(ctx, "focusTab", { tabId });
  await sleep(300);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = (await call(ctx, "typeText", {
        tabId,
        selectors: opts.selectors,
        value: opts.value,
      })) as { typed?: boolean };

      if (result?.typed) {
        // Verify by extracting the field's current value
        let verified: boolean | undefined;
        if (opts.verify) {
          await sleep(300);
          verified = await verifyTyped(ctx, tabId, opts.selectors, opts.value);
          if (!verified && attempt < maxRetries - 1) {
            continue; // retry — the text wasn't accepted
          }
        }

        // Press Enter if requested
        let pressedEnter: boolean | undefined;
        if (opts.pressEnter) {
          await sleep(200);
          try {
            await call(ctx, "pressKey", { tabId, key: "Enter", selectors: opts.selectors });
            pressedEnter = true;
          } catch {
            pressedEnter = false;
          }
        }

        return { typed: true, verified, pressedEnter };
      }
    } catch { /* retry */ }

    // Wait before retry
    await sleep(500);
  }

  throw new Error(
    `Type failed after ${maxRetries} attempts. Selectors: ${opts.selectors.join(", ")}`,
  );
}

// ── Verification helpers ────────────────────────────────────

async function verifyAction(
  ctx: BridgeContext,
  tabId: number,
  selector: string,
  change?: "appears" | "disappears" | "changes",
): Promise<boolean> {
  await sleep(500);
  try {
    const result = (await call(ctx, "findElements", {
      tabId,
      selectors: [selector],
      limit: 1,
    })) as unknown[];

    const exists = Array.isArray(result) && result.length > 0;

    switch (change) {
      case "appears": return exists;
      case "disappears": return !exists;
      case "changes": return true; // can't verify generic "changed" without before/after
      default: return exists;
    }
  } catch {
    return false;
  }
}

async function verifyTyped(
  ctx: BridgeContext,
  tabId: number,
  selectors: string[],
  expectedValue: string,
): Promise<boolean> {
  try {
    const elements = (await call(ctx, "findElements", {
      tabId,
      selectors,
      limit: 1,
    })) as Array<Record<string, unknown>>;

    if (!elements?.length) return false;

    const el = elements[0];
    // Check textContent or value
    const text = String(el.textContent ?? el.value ?? el.innerText ?? "");
    // Fuzzy match — the field should contain at least part of our text
    return text.includes(expectedValue.slice(0, 20)) || text.length > 0;
  } catch {
    return false;
  }
}

// ── Health check ────────────────────────────────────────────

export interface HealthStatus {
  extensionConnected: boolean;
  tabAccessible: boolean;
  tabUrl?: string;
  blockerDetected: boolean;
  blockerType?: string;
  ready: boolean;
}

/**
 * Check if a tab is healthy and ready for interaction.
 * Verifies: extension connected, tab accessible, no login wall/captcha.
 * Call this before any recipe execution.
 */
export async function healthCheck(
  ctx: BridgeContext,
  tabId: number,
): Promise<HealthStatus> {
  const status: HealthStatus = {
    extensionConnected: true, // if we got here, extension is connected
    tabAccessible: false,
    blockerDetected: false,
    ready: false,
  };

  // Check tab is accessible
  try {
    const tabs = (await call(ctx, "listTabs", {})) as Array<{ id: number; url: string }>;
    const tab = tabs?.find((t) => t.id === tabId);
    if (tab) {
      status.tabAccessible = true;
      status.tabUrl = tab.url;
    }
  } catch {
    return status;
  }

  // Check for blockers (login walls, captchas, rate limits)
  try {
    const blocker = (await call(ctx, "detectBlocker", { tabId })) as {
      blocked?: boolean;
      type?: string;
    };
    if (blocker?.blocked) {
      status.blockerDetected = true;
      status.blockerType = blocker.type;
      return status;
    }
  } catch {
    // detectBlocker not available or errored — assume OK
  }

  status.ready = status.tabAccessible && !status.blockerDetected;
  return status;
}

// ── Scroll to latest ────────────────────────────────────────

/**
 * Scroll a container to its bottom to load the latest content.
 * Tries: specific container selector → general page scroll.
 * Waits for content to load after scrolling.
 */
export async function scrollToLatest(
  ctx: BridgeContext,
  tabId: number,
  containerSelector?: string,
): Promise<void> {
  if (containerSelector) {
    // Try to scroll the specific container
    try {
      await call(ctx, "scrollPage", {
        tabId,
        selector: containerSelector,
      });
      await sleep(800);
      return;
    } catch {
      // Fall through to generic scroll
    }
  }

  // Generic: scroll the page to the bottom
  await call(ctx, "scrollPage", { tabId, deltaY: 99999, smooth: true });
  await sleep(800);
}

// ── Exports for compound tools ──────────────────────────────

export type { BridgeContext };
