# Recipe Spec v1

A recipe turns neuron-inspector's 51 browser tools into a purpose-built agent. It's shareable — someone else imports it, fills in their variables, and runs it. It's alive — each run captures outcomes, and the agent's strategy evolves based on what works.

## Format

```
recipes/my-agent/
├── agent.md              # The brain — strategy, personality, guardrails
├── recipe.yaml           # Metadata, variables, pipes, tool requirements
├── learnings.md          # Distilled patterns from past runs (auto-updated)
├── workflows/            # Deterministic step sequences (optional)
│   └── fill-form.yaml
├── tools/                # Custom MCP tools beyond the 51 (optional)
│   └── parse-pdf.ts
└── memory/               # Run outcomes (gitignored, local-only)
    └── 2026-09-05-run-001.yaml
```

Only `agent.md` and `recipe.yaml` are required. Everything else is optional.

## agent.md

The system prompt. Tells the AI how to use the browser tools for this specific purpose. Written as instructions to the AI client (Claude Code, Cursor, etc).

Must include three sections:

### Strategy
What the agent does and how. References the 51 tools by name. Uses `{{variables}}` for user-specific values.

### Reflect
How the agent should analyze its own run after completion. What counts as success, what to track, what to write to `memory/`.

### Evolve
How the agent should update `learnings.md` after accumulating enough runs. What patterns to look for, what to change in its own approach.

Example:

```markdown
# Web Researcher

You research a topic using the browser and produce a structured report.

## Strategy

1. Use neuron_navigate to open search engines and target sites
2. Use neuron_extract_data to pull structured content from results pages
3. Use neuron_search_traffic to find API responses with richer data than the DOM
4. Use neuron_screenshot to capture key evidence
5. Compile findings into {{output_format}}
6. Save the report to {{output_path}}

Focus areas: {{research_topics}}
Depth preference: {{depth}} (surface = top 5 results, deep = follow links + cross-reference)

## Reflect

After each run, write a memory entry to memory/:
- query: what was searched
- sources_found: count and quality (1-5)
- dead_ends: queries or sites that wasted time
- output_quality: self-assessed 1-5
- duration_minutes: approximate
- notes: anything surprising

## Evolve

After 5+ runs, review memory/ and update learnings.md:
- Which search strategies find high-quality sources fastest?
- Which sites consistently have good/bad data?
- Which queries tend to dead-end?
- Update your Strategy section based on these patterns.
```

## recipe.yaml

Metadata and configuration.

```yaml
name: Web Researcher
version: 1.0.0
description: Researches topics via browser and produces structured reports
author: rasheed
tags: [research, scraping, reports]

# What the user fills in when importing
variables:
  research_topics:
    prompt: "What topics should this agent research?"
    type: text
    required: true
  output_format:
    prompt: "Output format"
    options: [markdown, json, csv]
    default: markdown
  output_path:
    prompt: "Where to save reports"
    type: path
    default: "./reports"
  depth:
    prompt: "Research depth"
    options: [surface, deep]
    default: deep

# Which of the 51 tools this recipe uses
tools:
  required:
    - neuron_navigate
    - neuron_extract_data
    - neuron_search_traffic
    - neuron_screenshot
    - neuron_list_tabs
  optional:
    - neuron_evaluate_js
    - neuron_click
    - neuron_scroll

# Data flow — what this recipe produces and consumes
pipes:
  outputs:
    report:
      format: markdown
      path: "{{output_path}}/{{date}}-{{topic_slug}}.md"
      description: "Research report with sources and findings"
  inputs: {}
    # Example of consuming from another recipe:
    # trends:
    #   from: web-researcher
    #   output: report
    #   description: "Industry trends to reference"

# Guardrails
limits:
  max_tabs: 5
  max_duration_minutes: 30
  banned_domains: []
  require_human_approval: false
```

## Variables

Variables use `{{name}}` syntax in agent.md and workflow files. When importing a recipe, the CLI prompts for each variable. Values are saved to a local `.env.recipe` file (gitignored).

A user profile (`~/.neuron/profile.yaml`) can pre-fill common variables:

```yaml
name: "Rasheed Alabi"
email: "..."
location: "Lagos, Nigeria"
timezone: "Africa/Lagos"
tone: "professional but human"
```

Any recipe variable whose key matches a profile key is auto-filled.

## Memory

Each run produces a memory entry in `memory/`. These are YAML files, local-only (gitignored), never shared. They capture outcomes, not transcripts.

```yaml
# memory/2026-09-05-run-001.yaml
date: 2026-09-05T14:30:00Z
recipe: web-researcher
variables:
  research_topics: "AI browser automation tools"
  depth: deep
outcome:
  success: true
  sources_found: 12
  quality: 4
  dead_ends: ["scholar.google.com timeout", "reddit search returned irrelevant"]
  duration_minutes: 18
  output: "./reports/2026-09-05-ai-browser-tools.md"
notes: >
  DuckDuckGo gave better results than Google for this topic.
  GitHub topic search was the best source.
```

## Learnings

`learnings.md` is the distilled intelligence from all runs. The agent updates it based on the Evolve instructions in agent.md. It's checked into the recipe — when you share a recipe, your learnings travel with it (opt-in).

```markdown
# Learnings

## Search Strategy
- DuckDangGo outperforms Google for developer tools (7/10 runs)
- GitHub topic search + sorting by stars finds quality projects fast
- Reddit search is noisy — use site:reddit.com on a search engine instead

## Dead Ends
- scholar.google.com rate-limits aggressively, not worth the overhead
- Medium articles are paywalled, extract via search_traffic response bodies instead

## Quality Patterns
- Reports with 8+ sources score 4+ quality
- Following 2 levels of links (deep mode) adds ~10min but doubles source quality

Last updated: 2026-09-12 (after 8 runs)
```

## Pipes

Recipes can consume output from other recipes. Declared in `recipe.yaml` under `pipes.inputs`:

```yaml
pipes:
  inputs:
    industry_trends:
      from: web-researcher
      output: report
      description: "Latest industry trends to reference in cover letters"
```

At runtime, the CLI resolves the pipe — finds the latest output file from the source recipe and makes it available as `{{input.industry_trends}}` in agent.md.

This creates a mesh:
- **Web Researcher** → produces reports
- **Job Applicant** → consumes reports to tailor applications
- **QA Engineer** → consumes the applicant's target company URL to test their product

No central orchestrator. Each recipe runs independently and reads files from the others.

## Custom Tools

A recipe can ship additional MCP tools in `tools/`. These are TypeScript files that export a tool definition:

```typescript
// tools/parse-pdf.ts
export const tool = {
  name: "recipe_parse_pdf",
  description: "Extract text from a PDF URL",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "PDF URL to parse" },
    },
    required: ["url"],
  },
  handler: async (args: { url: string }) => {
    // Implementation
  },
};
```

The bridge loads these at startup alongside the 51 built-in tools. They appear as regular MCP tools to the AI client.

Convention: custom tool names are prefixed with `recipe_` to avoid collisions.

## Workflows

Deterministic step sequences for parts that shouldn't be improvised. YAML files in `workflows/`:

```yaml
# workflows/fill-form.yaml
name: Fill Application Form
description: Standard job application form filling
steps:
  - action: find
    selectors: ["input[name='name']", "input[placeholder*='name']"]
    then:
      action: type
      value: "{{name}}"

  - action: find
    selectors: ["input[name='email']", "input[type='email']"]
    then:
      action: type
      value: "{{email}}"

  - action: find
    selectors: ["textarea[name='cover']", "textarea[placeholder*='cover']"]
    then:
      action: type
      value: "{{cover_letter}}"

  - action: screenshot
    label: "pre-submit"

  - action: wait_for_human
    prompt: "Review the form and confirm submission"
```

The agent invokes a workflow by calling `neuron_run_sequence` with the resolved steps. Workflows are the mechanical parts; the agent handles the judgment calls.

## Distribution

```bash
# Install from the built-in registry
npx neuron-inspector use web-researcher

# Install from GitHub
npx neuron-inspector use github:someuser/my-recipe

# Install from a local folder
npx neuron-inspector use ./my-recipe
```

Installing a recipe:
1. Copies the recipe to `.neuron/recipes/<name>/`
2. Prompts for variables (auto-fills from profile)
3. Saves variables to `.neuron/recipes/<name>/.env.recipe`
4. Generates a CLAUDE.md snippet or appends to existing

## Lifecycle

```
Import → Configure → Run → Capture → Reflect → Evolve
                      ↑                            |
                      └────────────────────────────┘
```

Every recipe follows this loop. The reflect and evolve phases are what make it alive.
