# neuron-inspector

**51 browser tools for AI agents.** Your AI can't see your browser. This fixes that.

Inspect DOM, automate clicks, run JavaScript, search network traffic, audit security, check accessibility, scan SEO, mock APIs, extract structured data, record demos — all from Claude Code, Cursor, Windsurf, or any MCP client.

No API keys. No cloud. Runs on localhost.

[![npm](https://img.shields.io/npm/v/neuron-inspector)](https://www.npmjs.com/package/neuron-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

```bash
npx neuron-inspector
```

---

## Get started

### 1. Install the Chrome extension

Download from **[neuron.ng/extension](https://neuron.ng/extension)** and sideload:

1. Download and extract the zip
2. Open `chrome://extensions` and enable **Developer Mode**
3. Click **Load unpacked** and select the extracted folder
4. The extension icon appears in your toolbar

### 2. Connect to your AI tool

**Claude Code:**
```bash
claude mcp add neuron-inspector -- npx neuron-inspector
```

**Cursor** — add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "neuron-inspector": {
      "command": "npx",
      "args": ["neuron-inspector"]
    }
  }
}
```

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "neuron-inspector": {
      "command": "npx",
      "args": ["neuron-inspector"]
    }
  }
}
```

### 3. Use it

Open any page in Chrome. Ask your AI agent to interact with it. Done.

---

## What you can do

### Ask your agent to debug a page

> "Why is this page slow?"

The agent calls `neuron_perf_snapshot` and gets back Core Web Vitals, render-blocking scripts, memory usage, and the heaviest resources.

> "Check this page for security issues"

`neuron_security_scan` finds leaked API keys in inline scripts, missing CSP headers, mixed content, insecure forms, exposed source maps.

> "Is this page accessible?"

`neuron_a11y_audit` runs a WCAG audit — color contrast failures, missing alt text, broken heading hierarchy, unlabeled form fields.

### Ask your agent to explore traffic

> "What APIs is this SPA calling?"

`neuron_discover_apis` maps every endpoint from observed traffic — call counts, status codes, auth patterns, response shapes.

> "Search all network responses for 'user_id'"

`neuron_search_traffic` does full-text search across every captured response body.

> "Show me the network waterfall"

`neuron_waterfall` gives DNS, TCP, TLS, TTFB timing per resource — the same view as DevTools Network, but in your agent's context.

### Ask your agent to interact with the page

> "Click the Sign Up button"

`neuron_click` finds it by CSS selector or visible text and clicks it.

> "Fill in the email field with test@example.com"

`neuron_type` targets the input and types into it.

> "Scroll down and extract all the product listings"

`neuron_scroll` + `neuron_extract_data` — scrolls the page and pulls structured data from repeating patterns (cards, tables, feeds).

### Ask your agent to test edge cases

> "Mock the payments API to return a 500 error"

`neuron_set_mock` intercepts matching requests and returns your custom response. Test error states without touching the real backend.

> "Take a snapshot, click submit, then tell me what changed"

`neuron_snapshot_state` before, action, `neuron_diff_states` after — detects DOM changes, added/removed elements, URL changes.

### Ask your agent to record and replay

> "Record what I'm doing as a workflow"

`neuron_start_recording` captures clicks, typing, and navigation. `neuron_start_demo` replays it as a polished video with chapter markers and cursor overlay.

---

## All 51 tools

### Inspect & Debug
| Tool | What it does |
|------|-------------|
| `neuron_query_dom` | DOM snapshot of the page or a subtree |
| `neuron_find_elements` | Find elements by CSS selector or visible text |
| `neuron_evaluate_js` | Run JavaScript in page context |
| `neuron_get_logs` | Console logs filtered by level, tab, search |
| `neuron_screenshot` | PNG screenshot of the visible area |
| `neuron_diagnose` | Connection health check |
| `neuron_list_tabs` | Open tabs with platform detection |

### Browse & Automate
| Tool | What it does |
|------|-------------|
| `neuron_click` | Click by selector or text |
| `neuron_type` | Type into inputs and contenteditable |
| `neuron_scroll` | Scroll by pixels or into view |
| `neuron_navigate` | Navigate to a URL |
| `neuron_open_tab` | Open a new tab |
| `neuron_reload` | Reload a tab |
| `neuron_run_sequence` | Multi-step automation (click, type, wait, eval) |

### Network Intelligence
| Tool | What it does |
|------|-------------|
| `neuron_get_requests` | Query HTTP requests by tab, method, status, URL |
| `neuron_get_errors` | Recent 4xx/5xx and console errors |
| `neuron_get_ws_frames` | WebSocket and SSE frame history |
| `neuron_export_har` | Export as HAR 1.2 |
| `neuron_search_traffic` | Full-text search across response bodies |
| `neuron_discover_apis` | Auto-map API endpoints from traffic |
| `neuron_replay_request` | Re-fire a request with the browser's live session |
| `neuron_waterfall` | DNS/TLS/TTFB timing per resource |

### Security
| Tool | What it does |
|------|-------------|
| `neuron_security_scan` | Leaked secrets, missing headers, CORS, mixed content |
| `neuron_check_auth` | Verify platform credentials |
| `neuron_detect_blocker` | Detect rate limits, captchas, login walls |

### Quality
| Tool | What it does |
|------|-------------|
| `neuron_a11y_audit` | WCAG audit — contrast, labels, headings, tabindex |
| `neuron_perf_snapshot` | Core Web Vitals, resource breakdown, memory |
| `neuron_seo_audit` | Meta, OG, headings, structured data, links |

### Network Mocking
| Tool | What it does |
|------|-------------|
| `neuron_set_mock` | Intercept requests, return custom responses |
| `neuron_get_mocks` | List active mock rules |
| `neuron_clear_mocks` | Remove all mocks |

### Cookies & Storage
| Tool | What it does |
|------|-------------|
| `neuron_get_cookies` | Read cookies for a URL |
| `neuron_set_cookie` | Set a cookie |
| `neuron_delete_cookie` | Delete a cookie |
| `neuron_get_storage` | Read localStorage / sessionStorage |
| `neuron_clear_storage` | Clear storage |

### Page Monitoring
| Tool | What it does |
|------|-------------|
| `neuron_snapshot_state` | Capture page state for later diff |
| `neuron_diff_states` | Compare two snapshots |
| `neuron_watch_element` | Watch a selector for changes |
| `neuron_get_watches` | Check accumulated changes |
| `neuron_stop_watch` | Stop watching |
| `neuron_extract_data` | Extract structured data from feeds, tables, listings |

### Demo Recording
| Tool | What it does |
|------|-------------|
| `neuron_start_recording` | Record interactions as a workflow |
| `neuron_stop_recording` | Save the recording |
| `neuron_list_workflows` | List saved workflows |
| `neuron_start_replay` | Replay a workflow |
| `neuron_stop_replay` | Stop replay |
| `neuron_start_demo` | Record a demo video with chapters + cursor |
| `neuron_workflow_status` | Engine state |

### Other
| Tool | What it does |
|------|-------------|
| `neuron_trigger_post` | Trigger the post runner |
| `neuron_session_diagnostics` | Agent session health |

---

## Recipes — purpose-built agents

The 51 tools are primitives. A **recipe** turns them into a purpose-built agent — a QA engineer, a job applicant, a web researcher. Recipes are shareable, and they get better with every run.

### Built-in recipes

| Recipe | What it does |
|--------|-------------|
| **[Web Researcher](recipes/web-researcher/)** | Deep-dives into topics, cross-references sources, produces reports with citations |
| **[Job Applicant](recipes/job-applicant/)** | Searches job boards, evaluates fit, writes cover letters, fills forms, tracks outcomes |
| **[QA Engineer](recipes/qa-engineer/)** | Tests web apps — finds bugs, checks a11y, audits security, builds regression suites |

### How recipes work

A recipe is a folder with instructions (`agent.md`) and config (`recipe.yaml`). The instructions tell the AI *how* to use the browser tools for a specific purpose. The config declares variables you fill in (your resume, your target URL, your preferences).

**Recipes are alive.** Each run captures outcomes to `memory/`. After enough runs, the agent reviews what worked and updates its own strategy in `learnings.md`. A job applicant that discovers technical-tone cover letters get 3x more responses will start writing technical-tone cover letters by default.

**Recipes feed each other.** The web researcher produces reports that the job applicant reads to tailor cover letters. The QA engineer reads its own previous reports to re-check if old bugs are fixed. Output from one recipe is input to another.

### Use a recipe

Copy a recipe's `agent.md` into your project as a CLAUDE.md (or append it), fill in the `{{variables}}` from `recipe.yaml`, and run. The recipe tells your AI agent exactly how to use the 51 tools for that purpose.

### Build your own

See [RECIPE-SPEC.md](RECIPE-SPEC.md) for the full format. The core idea: write the instructions you'd give a skilled human, reference the tools by name, add reflect/evolve sections so the agent improves itself, and declare your variables so others can import and customize.

---

## Requirements

- Node.js 18+
- Chrome or any Chromium browser
- [Neuron extension](https://neuron.ng/extension)

## Links

- **Extension download:** [neuron.ng/extension](https://neuron.ng/extension)
- **npm:** [npmjs.com/package/neuron-inspector](https://www.npmjs.com/package/neuron-inspector)
- **Recipe spec:** [RECIPE-SPEC.md](RECIPE-SPEC.md)

## License

MIT
