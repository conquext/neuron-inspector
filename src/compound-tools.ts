/**
 * Compound tools — high-level operations that chain multiple extension
 * primitives in one MCP call. The AI spends inference on judgment,
 * not puppetry.
 *
 * These run server-side in the bridge. The extension doesn't need to
 * know about them — they just issue sequences of existing TOOL_CALL
 * messages via the same PendingCalls correlation.
 */

import type { WebSocket } from "ws";
import type { PendingCalls } from "./correlation.js";
import type { ToolDef } from "./tools.js";

// ── Types ───────────────────────────────────────────────────

interface BridgeContext {
  ws: WebSocket;
  pending: PendingCalls;
}

// ── Helpers ─────────────────────────────────────────────────

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

// ── Tool definitions ────────────────────────────────────────

export const COMPOUND_TOOLS: ToolDef[] = [
  {
    name: "neuron_research_page",
    description:
      "Deep-read a single URL in one call. Navigates to the page, waits for load, scrolls " +
      "to trigger lazy content, extracts structured data, captures console errors, and takes " +
      "a screenshot. Returns everything the AI needs to understand the page without multiple " +
      "round-trips. Use instead of separate navigate → scroll → extract → screenshot chains.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to research" },
        tabId: { type: "number", description: "Use an existing tab (optional — opens a new tab if omitted)" },
        scrolls: { type: "number", description: "Number of scroll-downs to trigger lazy content (default: 3)" },
        screenshot: { type: "boolean", description: "Capture a screenshot (default: true)" },
        extractSelector: { type: "string", description: "CSS selector to extract from (optional — auto-extracts if omitted)" },
      },
      required: ["url"],
    },
  },
  {
    name: "neuron_research_profiles",
    description:
      "Research multiple URLs in parallel. Opens each URL in a separate tab, scrolls to load " +
      "lazy content, extracts structured data from each, and returns all results in one response. " +
      "Up to 8 URLs per call. 5-10x faster than researching one at a time. Use for batch " +
      "profile research, multi-page data collection, or comparing pages side by side.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "URLs to research (max 8)",
        },
        scrolls: { type: "number", description: "Scroll-downs per page to load lazy content (default: 2)" },
        delayMs: { type: "number", description: "Delay between opening tabs to avoid rate limits (default: 1500ms)" },
        closeTabs: { type: "boolean", description: "Close the tabs after extracting (default: true)" },
      },
      required: ["urls"],
    },
  },
  {
    name: "neuron_search_and_collect",
    description:
      "Run a search on any site and collect results across multiple pages. Navigates to the URL, " +
      "types the query into the search box, extracts results, optionally paginates (clicks 'next' / " +
      "scrolls for infinite scroll), and returns all collected items. One call replaces the typical " +
      "navigate → find search box → type → extract → scroll → extract → click next → extract chain.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Starting URL (e.g. 'https://linkedin.com/search/results/people/')" },
        query: { type: "string", description: "Search query to type" },
        searchSelector: {
          type: "string",
          description: "CSS selector for the search input (optional — auto-detects input[type=search], input[name=q], etc.)",
        },
        pages: { type: "number", description: "Max pages to collect from (default: 1)" },
        nextSelector: {
          type: "string",
          description: "CSS selector for the next/pagination button (optional — tries common patterns)",
        },
        scrollForMore: { type: "boolean", description: "Use infinite scroll instead of pagination (default: false)" },
        extractSelector: { type: "string", description: "CSS selector for result items (optional — auto-extracts)" },
        delayMs: { type: "number", description: "Delay between pages in ms (default: 2000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "neuron_fill_and_submit",
    description:
      "Fill a form and optionally submit it in one call. Takes a map of field selectors to values, " +
      "fills each one, optionally screenshots the filled form for review, and clicks the submit button " +
      "if specified. Returns the before/after page state diff so you can verify what changed. " +
      "Replaces the typical find → type → find → type → screenshot → click chain.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              selectors: { type: "array", items: { type: "string" }, description: "CSS selectors to try for this field" },
              texts: { type: "array", items: { type: "string" }, description: "Visible text labels to match" },
              value: { type: "string", description: "Value to type into the field" },
            },
          },
          description: "Fields to fill — each has selectors/texts to find the input and a value to type",
        },
        submitSelector: {
          type: "string",
          description: "CSS selector for the submit button (optional — omit to fill without submitting)",
        },
        submitText: {
          type: "string",
          description: "Visible text on the submit button (alternative to submitSelector)",
        },
        screenshot: { type: "boolean", description: "Screenshot the form after filling, before submit (default: true)" },
        delayMs: { type: "number", description: "Delay between field fills in ms (default: 200)" },
      },
      required: ["tabId", "fields"],
    },
  },
  {
    name: "neuron_audit_page",
    description:
      "Run all quality audits on a page in one call — accessibility (WCAG), security scan, " +
      "performance snapshot, SEO audit, and console errors. Returns a combined report. " +
      "Replaces 5 separate tool calls (a11y_audit + security_scan + perf_snapshot + seo_audit + get_errors).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID to audit" },
        audits: {
          type: "array",
          items: { type: "string" },
          description: "Which audits to run (default: all). Options: a11y, security, performance, seo, errors",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_monitor_action",
    description:
      "Snapshot page state, perform an action (click/type/navigate), then diff to see what changed. " +
      "One call replaces the snapshot_state → click → wait → snapshot_state → diff_states chain. " +
      "Use to verify that a button click, form submit, or navigation actually did what was expected.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        action: {
          type: "object",
          properties: {
            type: { type: "string", description: "Action type: click, type, navigate" },
            selectors: { type: "array", items: { type: "string" }, description: "CSS selectors (for click/type)" },
            texts: { type: "array", items: { type: "string" }, description: "Visible text (for click)" },
            value: { type: "string", description: "Value to type (for type action)" },
            url: { type: "string", description: "URL to navigate to (for navigate action)" },
          },
          description: "The action to perform between snapshots",
        },
        waitMs: { type: "number", description: "Wait time after action before diffing (default: 1500)" },
        screenshot: { type: "boolean", description: "Screenshot after action (default: true)" },
      },
      required: ["tabId", "action"],
    },
  },
];

// ── Handlers ────────────────────────────────────────────────

export async function handleCompoundTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  switch (name) {
    case "neuron_research_page":
      return researchPage(args, ctx);
    case "neuron_research_profiles":
      return researchProfiles(args, ctx);
    case "neuron_search_and_collect":
      return searchAndCollect(args, ctx);
    case "neuron_fill_and_submit":
      return fillAndSubmit(args, ctx);
    case "neuron_audit_page":
      return auditPage(args, ctx);
    case "neuron_monitor_action":
      return monitorAction(args, ctx);
    default:
      throw new Error(`Unknown compound tool: ${name}`);
  }
}

// ── Implementations ─────────────────────────────────────────

async function researchPage(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const url = args.url as string;
  const scrollCount = (args.scrolls as number) ?? 3;
  const wantScreenshot = (args.screenshot as boolean) ?? true;
  const extractSel = args.extractSelector as string | undefined;

  // Open tab or reuse
  let tabId = args.tabId as number | undefined;
  if (!tabId) {
    const tab = (await call(ctx, "openTab", { url })) as { tabId?: number };
    tabId = tab?.tabId;
    await sleep(2000); // initial page load
  } else {
    await call(ctx, "navigateTo", { tabId, url });
    await sleep(2000);
  }

  if (!tabId) throw new Error("Failed to open tab");

  // Scroll to trigger lazy content
  for (let i = 0; i < scrollCount; i++) {
    await call(ctx, "scrollPage", { tabId, deltaY: 800, smooth: true });
    await sleep(600);
  }

  // Extract structured data
  const extractArgs: Record<string, unknown> = { tabId };
  if (extractSel) extractArgs.selector = extractSel;
  const data = await call(ctx, "extractData", extractArgs);

  // Get errors
  const errors = await call(ctx, "getRecentErrors", { tabId, limit: 10 });

  // Screenshot
  let screenshot: unknown = null;
  if (wantScreenshot) {
    try {
      screenshot = await call(ctx, "captureScreenshot", { tabId });
    } catch {
      // non-fatal — tab might not be in foreground
    }
  }

  return {
    url,
    tabId,
    data,
    errors,
    screenshot,
  };
}

async function researchProfiles(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const urls = (args.urls as string[]).slice(0, 8);
  const scrollCount = (args.scrolls as number) ?? 2;
  const delayMs = (args.delayMs as number) ?? 1500;
  const closeTabs = (args.closeTabs as boolean) ?? true;

  const results: Array<{
    url: string;
    tabId: number | null;
    data: unknown;
    error: string | null;
  }> = [];

  const openTabs: number[] = [];

  // Open all tabs with delay between each
  for (const url of urls) {
    try {
      const tab = (await call(ctx, "openTab", { url })) as { tabId?: number };
      const tabId = tab?.tabId ?? null;
      results.push({ url, tabId, data: null, error: null });
      if (tabId) openTabs.push(tabId);
    } catch (err) {
      results.push({ url, tabId: null, data: null, error: (err as Error).message });
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  // Wait for all pages to load
  await sleep(2500);

  // Extract from each tab
  for (const result of results) {
    if (!result.tabId) continue;
    try {
      // Scroll to load lazy content
      for (let i = 0; i < scrollCount; i++) {
        await call(ctx, "scrollPage", { tabId: result.tabId, deltaY: 600, smooth: true });
        await sleep(400);
      }
      result.data = await call(ctx, "extractData", { tabId: result.tabId });
    } catch (err) {
      result.error = (err as Error).message;
    }
  }

  // Close tabs
  if (closeTabs) {
    for (const tabId of openTabs) {
      try {
        await call(ctx, "evaluateJS", { tabId, expression: "window.close()" });
      } catch {
        // non-fatal
      }
    }
  }

  return {
    count: results.length,
    successful: results.filter((r) => r.data && !r.error).length,
    failed: results.filter((r) => r.error).length,
    results,
  };
}

async function searchAndCollect(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const url = args.url as string;
  const query = args.query as string | undefined;
  const searchSel = args.searchSelector as string | undefined;
  const maxPages = (args.pages as number) ?? 1;
  const nextSel = args.nextSelector as string | undefined;
  const scrollMore = (args.scrollForMore as boolean) ?? false;
  const extractSel = args.extractSelector as string | undefined;
  const delayMs = (args.delayMs as number) ?? 2000;

  // Navigate
  const tab = (await call(ctx, "openTab", { url })) as { tabId?: number };
  const tabId = tab?.tabId;
  if (!tabId) throw new Error("Failed to open tab");
  await sleep(2500);

  // Type query if provided
  if (query) {
    const searchSelectors = searchSel
      ? [searchSel]
      : ["input[type='search']", "input[name='q']", "input[name='keywords']",
         "input[name='query']", "input[placeholder*='earch']", "input[aria-label*='earch']"];
    await call(ctx, "typeText", { tabId, selectors: searchSelectors, value: query });
    await sleep(500);
    // Press enter
    await call(ctx, "evaluateJS", {
      tabId,
      expression: `document.querySelector("${searchSelectors.join('","')}").dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}))`,
    });
    await sleep(delayMs);
  }

  // Collect results across pages
  const allItems: unknown[] = [];

  for (let page = 0; page < maxPages; page++) {
    // Scroll to load content
    for (let i = 0; i < 3; i++) {
      await call(ctx, "scrollPage", { tabId, deltaY: 600, smooth: true });
      await sleep(400);
    }

    // Extract
    const extractArgs: Record<string, unknown> = { tabId };
    if (extractSel) extractArgs.selector = extractSel;
    const pageData = (await call(ctx, "extractData", extractArgs)) as { items?: unknown[] } | unknown;
    const items = (pageData as { items?: unknown[] })?.items ?? (Array.isArray(pageData) ? pageData : [pageData]);
    allItems.push(...items);

    // Paginate
    if (page < maxPages - 1) {
      if (scrollMore) {
        // Infinite scroll — keep scrolling
        for (let i = 0; i < 5; i++) {
          await call(ctx, "scrollPage", { tabId, deltaY: 1000, smooth: true });
          await sleep(800);
        }
      } else {
        // Click next button
        const nextSelectors = nextSel
          ? [nextSel]
          : ["button[aria-label='Next']", "a[aria-label='Next']", ".pagination-next",
             "button:has(> svg[aria-label='Next'])", "[data-test='pagination-next']"];
        try {
          await call(ctx, "clickElement", { tabId, selectors: nextSelectors });
          await sleep(delayMs);
        } catch {
          break; // no more pages
        }
      }
    }
  }

  return {
    tabId,
    query,
    pages_collected: Math.min(maxPages, allItems.length > 0 ? maxPages : 1),
    total_items: allItems.length,
    items: allItems,
  };
}

async function fillAndSubmit(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const tabId = args.tabId as number;
  const fields = args.fields as Array<{
    selectors?: string[];
    texts?: string[];
    value: string;
  }>;
  const submitSel = args.submitSelector as string | undefined;
  const submitText = args.submitText as string | undefined;
  const wantScreenshot = (args.screenshot as boolean) ?? true;
  const delayMs = (args.delayMs as number) ?? 200;

  // Snapshot before
  await call(ctx, "snapshotState", { tabId, label: "pre-fill" });

  // Fill each field
  const fieldResults: Array<{ selectors?: string[]; status: string }> = [];
  for (const field of fields) {
    try {
      await call(ctx, "typeText", {
        tabId,
        selectors: field.selectors,
        texts: field.texts,
        value: field.value,
      });
      fieldResults.push({ selectors: field.selectors, status: "filled" });
    } catch (err) {
      fieldResults.push({ selectors: field.selectors, status: `error: ${(err as Error).message}` });
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  // Screenshot
  let screenshot: unknown = null;
  if (wantScreenshot) {
    try {
      screenshot = await call(ctx, "captureScreenshot", { tabId });
    } catch { /* non-fatal */ }
  }

  // Submit if requested
  let submitted = false;
  if (submitSel || submitText) {
    try {
      await call(ctx, "clickElement", {
        tabId,
        selectors: submitSel ? [submitSel] : undefined,
        texts: submitText ? [submitText] : undefined,
      });
      submitted = true;
      await sleep(1500);
    } catch (err) {
      return {
        fields: fieldResults,
        screenshot,
        submitted: false,
        submit_error: (err as Error).message,
      };
    }
  }

  // Snapshot after
  await call(ctx, "snapshotState", { tabId, label: "post-fill" });
  const diff = await call(ctx, "diffStates", { before: "pre-fill", after: "post-fill" });

  return {
    fields: fieldResults,
    screenshot,
    submitted,
    diff,
  };
}

async function auditPage(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const tabId = args.tabId as number;
  const requestedAudits = (args.audits as string[]) ?? ["a11y", "security", "performance", "seo", "errors"];

  const results: Record<string, unknown> = {};

  // Run audits in parallel where possible (they're read-only, no conflicts)
  const promises: Array<[string, Promise<unknown>]> = [];

  if (requestedAudits.includes("a11y")) {
    promises.push(["a11y", call(ctx, "a11yAudit", { tabId })]);
  }
  if (requestedAudits.includes("security")) {
    promises.push(["security", call(ctx, "securityScan", { tabId })]);
  }
  if (requestedAudits.includes("performance")) {
    promises.push(["performance", call(ctx, "perfSnapshot", { tabId })]);
  }
  if (requestedAudits.includes("seo")) {
    promises.push(["seo", call(ctx, "seoAudit", { tabId })]);
  }
  if (requestedAudits.includes("errors")) {
    promises.push(["errors", call(ctx, "getRecentErrors", { tabId, limit: 20 })]);
  }

  // Await all in parallel
  const settled = await Promise.allSettled(promises.map(([, p]) => p));
  for (let i = 0; i < promises.length; i++) {
    const [key] = promises[i];
    const result = settled[i];
    results[key] = result.status === "fulfilled" ? result.value : { error: (result.reason as Error).message };
  }

  return {
    tabId,
    audits_run: requestedAudits,
    results,
  };
}

async function monitorAction(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const tabId = args.tabId as number;
  const action = args.action as {
    type: string;
    selectors?: string[];
    texts?: string[];
    value?: string;
    url?: string;
  };
  const waitMs = (args.waitMs as number) ?? 1500;
  const wantScreenshot = (args.screenshot as boolean) ?? true;

  // Snapshot before
  await call(ctx, "snapshotState", { tabId, label: "before-action" });

  // Perform action
  let actionResult: unknown = null;
  switch (action.type) {
    case "click":
      actionResult = await call(ctx, "clickElement", {
        tabId,
        selectors: action.selectors,
        texts: action.texts,
      });
      break;
    case "type":
      actionResult = await call(ctx, "typeText", {
        tabId,
        selectors: action.selectors,
        value: action.value,
      });
      break;
    case "navigate":
      actionResult = await call(ctx, "navigateTo", { tabId, url: action.url });
      break;
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }

  // Wait for effects
  await sleep(waitMs);

  // Screenshot
  let screenshot: unknown = null;
  if (wantScreenshot) {
    try {
      screenshot = await call(ctx, "captureScreenshot", { tabId });
    } catch { /* non-fatal */ }
  }

  // Snapshot after and diff
  await call(ctx, "snapshotState", { tabId, label: "after-action" });
  const diff = await call(ctx, "diffStates", { before: "before-action", after: "after-action" });

  // Check for errors
  const errors = await call(ctx, "getRecentErrors", { tabId, limit: 5 });

  return {
    action: action.type,
    actionResult,
    screenshot,
    diff,
    errors,
  };
}
