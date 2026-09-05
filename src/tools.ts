export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "neuron_query_dom",
    description: "Capture a DOM snapshot of the active page or a targeted subtree",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        selector: { type: "string", description: "CSS selector to scope (default: body)" },
        depth: { type: "number", description: "Max tree depth (default: 5)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_find_elements",
    description: "Find elements by CSS selectors or visible text",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        selectors: { type: "array", items: { type: "string" }, description: "CSS selectors to try" },
        texts: { type: "array", items: { type: "string" }, description: "Visible text to match" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_evaluate_js",
    description: "Run JavaScript in page context and return the result",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        expression: { type: "string", description: "JavaScript expression to evaluate" },
      },
      required: ["tabId", "expression"],
    },
  },
  {
    name: "neuron_get_requests",
    description: "Query recent HTTP requests from the extension's ring buffers, filtered by tab, platform, status, method, or URL pattern",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        platform: { type: "string", enum: ["ig", "x", "tk", "li", "fb"] },
        method: { type: "string" },
        urlPattern: { type: "string", description: "Substring match on URL" },
        statusMin: { type: "number" },
        statusMax: { type: "number" },
        limit: { type: "number", description: "Max results (default: 50)" },
      },
    },
  },
  {
    name: "neuron_get_errors",
    description: "Get recent failed HTTP requests (4xx/5xx) and console errors",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        platform: { type: "string", enum: ["ig", "x", "tk", "li", "fb"] },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
    },
  },
  {
    name: "neuron_get_ws_frames",
    description: "Query WebSocket frame history by platform",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["ig", "x", "tk", "li", "fb"] },
        direction: { type: "string", enum: ["send", "recv"] },
        transport: { type: "string", enum: ["ws", "sse"] },
        limit: { type: "number", description: "Max results (default: 100)" },
      },
    },
  },
  {
    name: "neuron_check_auth",
    description: "Check whether credentials for a social platform are still valid (cookies, headers, tokens)",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["ig", "x", "tk", "li", "fb"], description: "Platform code" },
      },
      required: ["platform"],
    },
  },
  {
    name: "neuron_detect_blocker",
    description: "Check if a tab is showing a rate limit wall, login prompt, captcha, or interstitial",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID to inspect" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_screenshot",
    description: "Capture a PNG screenshot of the visible tab area",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID (must be in foreground)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_session_diagnostics",
    description: "Get the agent session health snapshot — capture rate, stall detection, auth health, buffer size",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_diagnose",
    description: "Connection health — is the extension connected? Dev mode on? What tabs are open?",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_list_tabs",
    description: "List open Chrome tabs with platform detection and capture counts",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_get_logs",
    description: "Get recent console logs filtered by tab, level, and time",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Filter by tab ID" },
        levels: { type: "array", items: { type: "string" }, description: "Filter by levels: log, info, warn, error, debug" },
        limit: { type: "number", description: "Max results (default: 100)" },
        sinceMs: { type: "number", description: "Only logs after this timestamp" },
        search: { type: "string", description: "Substring search in log messages" },
      },
    },
  },
  {
    name: "neuron_export_har",
    description: "Export captured network traffic as HAR 1.2 JSON",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Filter by specific tab" },
        platform: { type: "string", enum: ["ig", "x", "tk", "li", "fb"], description: "Filter by platform" },
        sinceMs: { type: "number", description: "Only requests after this timestamp" },
        includeBody: { type: "boolean", description: "Include response bodies (default: false)" },
      },
    },
  },
  {
    name: "neuron_click",
    description: "Click an element by CSS selector or visible text",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        selectors: { type: "array", items: { type: "string" }, description: "CSS selectors to try" },
        texts: { type: "array", items: { type: "string" }, description: "Visible text to match" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_type",
    description: "Type text into an input, textarea, or contenteditable element",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        selectors: { type: "array", items: { type: "string" }, description: "CSS selectors to try" },
        value: { type: "string", description: "Text to type" },
      },
      required: ["tabId", "selectors", "value"],
    },
  },
  {
    name: "neuron_navigate",
    description: "Navigate a tab to a URL (http/https only)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["tabId", "url"],
    },
  },
  {
    name: "neuron_focus_tab",
    description: "Bring a tab to the foreground. Required before clicking, typing, or screenshotting on sites that need foreground focus (LinkedIn, Gmail, Facebook). Automatically focuses the tab's window too.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID to focus" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_open_tab",
    description: "Open a new tab, optionally to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open (optional)" },
      },
    },
  },
  {
    name: "neuron_reload",
    description: "Reload a tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_scroll",
    description: "Scroll a page by pixels (positive = down) or scroll a CSS selector into view. Returns scroll position and whether the page reached the bottom.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        deltaY: { type: "number", description: "Pixels to scroll vertically (positive = down, negative = up). Default: 600" },
        deltaX: { type: "number", description: "Pixels to scroll horizontally. Default: 0" },
        smooth: { type: "boolean", description: "Smooth scrolling. Default: true" },
        selector: { type: "string", description: "CSS selector to scroll into view (overrides deltaY/deltaX)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_run_sequence",
    description: "Execute a sequence of browser actions (click, type, navigate, wait, evaluate)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["click", "type", "navigate", "wait", "evaluate"] },
              selectors: { type: "array", items: { type: "string" } },
              texts: { type: "array", items: { type: "string" } },
              value: { type: "string" },
              url: { type: "string" },
              expression: { type: "string" },
              waitMs: { type: "number" },
            },
          },
          description: "Sequence steps (max 50)",
        },
        delayMs: { type: "number", description: "Delay between steps in ms (default: 500)" },
      },
      required: ["tabId", "steps"],
    },
  },
  // ── Post trigger ──────────────────────────────────────────
  {
    name: "neuron_trigger_post",
    description: "Trigger the IG post runner to claim and execute the next pending post task from the Neuron backend. Posts to Instagram using the logged-in session in Chrome.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Workflow / demo recording ─────────────────────────────
  {
    name: "neuron_list_workflows",
    description: "List all saved workflow recordings",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_workflow_status",
    description: "Get the current workflow engine status (idle, recording, replaying, demo)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_start_recording",
    description: "Start recording user interactions (clicks, typing, navigation) on the active tab as a replayable workflow",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_stop_recording",
    description: "Stop recording and save the workflow with a name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the saved workflow" },
      },
      required: ["name"],
    },
  },
  {
    name: "neuron_start_replay",
    description: "Replay a saved workflow — re-executes the recorded steps on the current tab",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "ID of the workflow to replay" },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "neuron_stop_replay",
    description: "Stop the current workflow replay or demo",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_start_demo",
    description: "Start a demo video recording of a workflow — replays the steps with cinematic overlays (chapters, captions, cursor) and captures to video",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "ID of the workflow to demo" },
        config: {
          type: "object",
          description: "Demo config overrides",
          properties: {
            showChapters: { type: "boolean" },
            showCaptions: { type: "boolean" },
            showCursor: { type: "boolean" },
            voiceover: { type: "boolean" },
            format: { type: "string", enum: ["mp4", "webm"] },
          },
        },
      },
      required: ["workflowId"],
    },
  },
  // ── Network mocking ──────────────────────────────────────
  {
    name: "neuron_get_mocks",
    description: "List all active network mock rules",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_set_mock",
    description: "Add a network mock rule — intercept requests matching a URL pattern and return a custom response. Use to test error states, slow APIs, or custom payloads without touching the real backend.",
    inputSchema: {
      type: "object",
      properties: {
        urlPattern: { type: "string", description: "URL pattern to match (glob or regex)" },
        matchType: { type: "string", enum: ["glob", "regex"], description: "Pattern type (default: glob)" },
        method: { type: "string", description: "HTTP method filter (GET, POST, etc). Omit to match all." },
        responseStatus: { type: "number", description: "HTTP status code to return (default: 200)" },
        responseBody: { type: "string", description: "Response body to return (JSON string)" },
        responseHeaders: { type: "object", description: "Custom response headers" },
        delay: { type: "number", description: "Response delay in ms (simulate slow API)" },
        label: { type: "string", description: "Human label for this mock rule" },
      },
      required: ["urlPattern", "responseBody"],
    },
  },
  {
    name: "neuron_clear_mocks",
    description: "Remove all network mock rules",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Accessibility audit ──────────────────────────────────
  {
    name: "neuron_a11y_audit",
    description: "Run a WCAG accessibility audit on a page — checks color contrast, missing alt text, form labels, heading structure, lang attribute, empty links, and tabindex misuse. Returns structured violations with severity and selectors.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID to audit" },
      },
      required: ["tabId"],
    },
  },
  // ── Performance snapshot ─────────────────────────────────
  {
    name: "neuron_perf_snapshot",
    description: "Capture a performance snapshot — Core Web Vitals (LCP, CLS), TTFB, FCP, resource breakdown by type, slow resources, blocking scripts, memory usage, and long tasks.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID to profile" },
      },
      required: ["tabId"],
    },
  },
  // ── Cookie & storage management ──────────────────────────
  {
    name: "neuron_get_cookies",
    description: "Get all cookies for a URL, including values, domain, expiry, secure, httpOnly, and sameSite flags",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to get cookies for (e.g. https://example.com)" },
      },
      required: ["url"],
    },
  },
  {
    name: "neuron_set_cookie",
    description: "Set a cookie on a domain",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL context for the cookie" },
        name: { type: "string" },
        value: { type: "string" },
        domain: { type: "string" },
        path: { type: "string", description: "Default: /" },
        secure: { type: "boolean" },
        httpOnly: { type: "boolean" },
        sameSite: { type: "string", enum: ["no_restriction", "lax", "strict", "unspecified"] },
        expirationDate: { type: "number", description: "Unix timestamp" },
      },
      required: ["url", "name", "value"],
    },
  },
  {
    name: "neuron_delete_cookie",
    description: "Delete a specific cookie by name and URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL context for the cookie" },
        name: { type: "string", description: "Cookie name to delete" },
      },
      required: ["url", "name"],
    },
  },
  {
    name: "neuron_get_storage",
    description: "Read all localStorage or sessionStorage entries for the current page (values truncated at 500 chars)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        type: { type: "string", enum: ["localStorage", "sessionStorage"], description: "Storage type (default: localStorage)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_clear_storage",
    description: "Clear all localStorage or sessionStorage entries for the current page",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        type: { type: "string", enum: ["localStorage", "sessionStorage"], description: "Storage type (default: localStorage)" },
      },
      required: ["tabId"],
    },
  },
  // ── Response body search ──────────────────────────────────
  {
    name: "neuron_search_traffic",
    description: "Search across all captured response bodies in ring buffers for a string or regex pattern. Returns matching requests with context snippets around the match.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (string or regex pattern)" },
        regex: { type: "boolean", description: "Treat query as regex (default: false)" },
        limit: { type: "number", description: "Max results to return (default: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "neuron_discover_apis",
    description: "Analyze captured network traffic and produce a structured API map. Groups endpoints by normalized URL (IDs replaced with {id}), shows call counts, statuses, content types, auth presence, avg duration, and sample response shapes.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ── Security scan ─────────────────────────────────────────
  {
    name: "neuron_security_scan",
    description: "Comprehensive security audit of a page. Scans for leaked secrets (API keys, tokens, credentials) in inline scripts, localStorage, and response bodies. Checks security headers, CORS config, mixed content, insecure forms, exposed source maps, and password field autocomplete. Returns structured findings with severity levels.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID to scan" },
      },
      required: ["tabId"],
    },
  },
  // ── Page diff ─────────────────────────────────────────────
  {
    name: "neuron_snapshot_state",
    description: "Capture a snapshot of the current page state — DOM structure, element visibility, text content, meta tags, URL. Store it in memory with a label for later comparison. Use with neuron_diff_states to detect changes over time (useful for SPA testing, mutation tracking, or detecting dynamic content updates).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        label: { type: "string", description: "Snapshot label (default: snapshot_{timestamp})" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "neuron_diff_states",
    description: "Compare two page snapshots created with neuron_snapshot_state. Returns added, removed, and changed elements, plus URL/title changes. Useful for detecting what changed on a page after an action (button click, form submit, navigation, etc).",
    inputSchema: {
      type: "object",
      properties: {
        before: { type: "string", description: "Label of the first snapshot" },
        after: { type: "string", description: "Label of the second snapshot" },
      },
      required: ["before", "after"],
    },
  },
  // ── Data extraction ───────────────────────────────────────
  {
    name: "neuron_extract_data",
    description: "Extract structured data from repeating page patterns (product listings, search results, social feeds, tables). If a CSS selector is provided, extracts from those elements. Otherwise auto-detects repeating patterns (articles, cards, list items) and extracts text, links, images, data attributes. Returns up to 200 items.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        selector: { type: "string", description: "CSS selector to extract from (optional — auto-detects if omitted)" },
      },
      required: ["tabId"],
    },
  },
  // ── Request replay ───────────────────────────────────────
  {
    name: "neuron_replay_request",
    description: "Re-fire an HTTP request from the extension's service worker context (with the browser's cookies/session). Modify method, headers, or body before sending. Like Postman but using the live browser session. Response bodies truncated at 50KB.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Request URL" },
        method: { type: "string", description: "HTTP method (default: GET)" },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body (for POST/PUT/PATCH)" },
      },
      required: ["url"],
    },
  },
  // ── Network waterfall ────────────────────────────────────
  {
    name: "neuron_waterfall",
    description: "Network waterfall timing breakdown — DNS, TCP, TLS, TTFB, download timing for each resource loaded by the page, ordered by start time. Shows the critical render-blocking path and identifies the slowest resources.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
      },
      required: ["tabId"],
    },
  },
  // ── SEO audit ────────────────────────────────────────────
  {
    name: "neuron_seo_audit",
    description: "SEO audit of a page — title, meta description, Open Graph, Twitter Cards, canonical URL, heading hierarchy, image alt text, structured data (JSON-LD/microdata), word count, internal/external link ratio, viewport, lang attribute. Returns findings with severity levels.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
      },
      required: ["tabId"],
    },
  },
  // ── Element watcher ──────────────────────────────────────
  {
    name: "neuron_watch_element",
    description: "Start watching a CSS selector for changes (text, visibility, attributes). Polls at a configurable interval and accumulates changes. Use neuron_get_watches to check for changes, neuron_stop_watch to stop.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Chrome tab ID" },
        selector: { type: "string", description: "CSS selector to watch" },
        intervalMs: { type: "number", description: "Poll interval in ms (default: 2000)" },
      },
      required: ["tabId", "selector"],
    },
  },
  {
    name: "neuron_get_watches",
    description: "Get all active element watches and their accumulated changes",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_stop_watch",
    description: "Stop watching an element and return the final list of accumulated changes",
    inputSchema: {
      type: "object",
      properties: {
        watchId: { type: "string", description: "Watch ID returned by neuron_watch_element" },
      },
      required: ["watchId"],
    },
  },
];

/** Map MCP tool name → extension primitive name */
export function toolToPrimitive(toolName: string): string {
  const map: Record<string, string> = {
    neuron_query_dom: "queryDOM",
    neuron_find_elements: "findElements",
    neuron_evaluate_js: "evaluateJS",
    neuron_get_requests: "getRecentRequests",
    neuron_get_errors: "getRecentErrors",
    neuron_get_ws_frames: "getWsFrames",
    neuron_check_auth: "checkAuth",
    neuron_detect_blocker: "detectBlocker",
    neuron_screenshot: "captureScreenshot",
    neuron_session_diagnostics: "getSessionDiagnostics",
    neuron_diagnose: "diagnose",
    neuron_list_tabs: "listTabs",
    neuron_get_logs: "getRecentLogs",
    neuron_export_har: "exportHAR",
    neuron_click: "clickElement",
    neuron_type: "typeText",
    neuron_navigate: "navigateTo",
    neuron_focus_tab: "focusTab",
    neuron_open_tab: "openTab",
    neuron_reload: "reloadTab",
    neuron_scroll: "scrollPage",
    neuron_run_sequence: "runSequence",
    neuron_trigger_post: "triggerPost",
    neuron_list_workflows: "listWorkflows",
    neuron_workflow_status: "getWorkflowStatus",
    neuron_start_recording: "startRecording",
    neuron_stop_recording: "stopRecording",
    neuron_start_replay: "startReplay",
    neuron_stop_replay: "stopReplay",
    neuron_start_demo: "startDemo",
    neuron_get_mocks: "getMockRules",
    neuron_set_mock: "setMockRule",
    neuron_clear_mocks: "clearMocks",
    neuron_a11y_audit: "a11yAudit",
    neuron_perf_snapshot: "perfSnapshot",
    neuron_get_cookies: "getCookies",
    neuron_set_cookie: "setCookie",
    neuron_delete_cookie: "deleteCookie",
    neuron_get_storage: "getStorage",
    neuron_clear_storage: "clearStorage",
    neuron_search_traffic: "searchTraffic",
    neuron_discover_apis: "discoverApis",
    neuron_security_scan: "securityScan",
    neuron_snapshot_state: "snapshotState",
    neuron_diff_states: "diffStates",
    neuron_extract_data: "extractData",
    neuron_replay_request: "replayRequest",
    neuron_waterfall: "waterfall",
    neuron_seo_audit: "seoAudit",
    neuron_watch_element: "watchElement",
    neuron_get_watches: "getWatches",
    neuron_stop_watch: "stopWatch",
  };
  return map[toolName] ?? toolName;
}
