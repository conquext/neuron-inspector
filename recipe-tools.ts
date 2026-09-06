/**
 * Recipe MCP tools — same ToolDef shape as browser tools so they register
 * through the same mcp.tool() overload. Handled locally (no extension needed).
 */

import type { ToolDef } from "./tools.js";
import * as recipes from "./recipes.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import YAML from "yaml";

/** Track the active recipe so neuron_recipe_complete knows what to log. */
let activeRecipe: { slug: string; startedAt: string; variables: Record<string, unknown> } | null = null;

export const RECIPE_TOOLS: ToolDef[] = [
  {
    name: "neuron_recipe_run",
    description: "Start a recipe run. Loads the recipe's agent.md with variables interpolated, its learnings, resolved variables (auto-filled from profile), and active rules (global + platform + task-specific). Rules are injected as non-negotiable constraints that override recipe strategy. Call neuron_recipe_complete when done.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug (e.g. 'web-researcher', 'qa-engineer')" },
        variables: { type: "object", description: "Variable overrides — keys matching recipe.yaml variable names. Merged on top of profile defaults." },
        rules: {
          type: "array",
          items: { type: "string" },
          description: "Task-specific rules for this run (e.g. 'never follow anyone', 'skip users with less than 100 followers'). These are added on top of global rules from ~/.neuron/rules.yaml.",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_recipe_complete",
    description: "End a recipe run started with neuron_recipe_run. Logs the outcome to the recipe's memory automatically. Provide the outcome data matching the recipe's Reflect section. If the recipe has 5+ memory entries, also return the learnings so the evolve phase can update strategy.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "object", description: "Run outcome — structure varies per recipe, see the Reflect section in agent.md" },
        updated_learnings: { type: "string", description: "If you ran the evolve phase, provide the updated learnings.md content here to persist it" },
      },
      required: ["outcome"],
    },
  },
  {
    name: "neuron_recipe_list",
    description: "List all available recipes (bundled + user-installed). Shows name, description, whether it has accumulated learnings, and run count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_recipe_get",
    description: "Get a recipe's full contents — agent instructions (agent.md), configuration (recipe.yaml), accumulated learnings, and variable definitions. Use this to understand what a recipe does before running it.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug (e.g. 'web-researcher', 'qa-engineer')" },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_recipe_create",
    description: "Create a new recipe from scratch. Provide the slug, name, description, agent instructions (agent.md content with Strategy/Reflect/Evolve sections), and configuration (recipe.yaml content with variables/tools/pipes/limits). Saved to ~/.neuron/recipes/<slug>/.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "URL-safe identifier (e.g. 'grant-scraper')" },
        name: { type: "string", description: "Display name" },
        description: { type: "string", description: "One-line description" },
        agent_md: { type: "string", description: "Full agent.md content — strategy, reflect, evolve sections" },
        recipe_yaml: { type: "string", description: "Full recipe.yaml content — variables, tools, pipes, limits" },
      },
      required: ["slug", "name", "description", "agent_md", "recipe_yaml"],
    },
  },
  {
    name: "neuron_recipe_update",
    description: "Update a recipe's agent instructions, learnings, or configuration. If updating a bundled recipe, it's forked to ~/.neuron/recipes/ first. Use this after the evolve phase to persist improved strategy.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug" },
        agent_md: { type: "string", description: "Updated agent.md content" },
        learnings: { type: "string", description: "Updated learnings.md content" },
        recipe_yaml: { type: "string", description: "Updated recipe.yaml content" },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_recipe_log",
    description: "Log a run outcome to a recipe's memory. Each entry captures what happened — success/failure, sources found, dead ends, quality score. The recipe's evolve phase reads these to improve its strategy.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug" },
        entry: { type: "object", description: "Run outcome data — structure varies per recipe, see the Reflect section in agent.md" },
      },
      required: ["slug", "entry"],
    },
  },
  {
    name: "neuron_recipe_memory",
    description: "Read a recipe's run history — the outcomes captured by neuron_recipe_log. Returns the most recent entries. Use during the evolve phase to analyze what's working and what's not.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug" },
        limit: { type: "number", description: "Max entries to return (default: 20)" },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_recipe_import",
    description: "Import a recipe from GitHub or a local path. GitHub: 'github:user/repo' imports all recipes from the repo's recipes/ subdir. Local: absolute path to a folder with recipe.yaml. Saved to ~/.neuron/recipes/. Memory is stripped on import (local-only).",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "GitHub repo (github:user/repo) or absolute local path to recipe folder" },
      },
      required: ["source"],
    },
  },
  {
    name: "neuron_recipe_export",
    description: "Export a recipe's shareable contents — agent.md, recipe.yaml, and optionally learnings. The recipient imports this with neuron_recipe_import. Memory (run history) is never exported.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug" },
        include_learnings: { type: "boolean", description: "Include accumulated learnings (default: true)" },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_recipe_delete",
    description: "Delete a user-installed recipe and all its memory/learnings. Bundled recipes cannot be deleted.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug to delete" },
      },
      required: ["slug"],
    },
  },
  {
    name: "neuron_profile_get",
    description: "Read the user's profile (~/.neuron/profile.yaml). Profiles auto-fill recipe variables — name, email, location, tone, timezone, etc.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_profile_save",
    description: "Save or update the user's profile (~/.neuron/profile.yaml). Common fields: name, email, location, timezone, tone, linkedin, github. Recipe variables with matching keys are auto-filled from this profile.",
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "object", description: "Profile key-value pairs (e.g. {name: 'Jane', email: 'jane@co.com', timezone: 'US/Eastern'})" },
      },
      required: ["data"],
    },
  },
  {
    name: "neuron_rules_get",
    description:
      "Read the active rules (~/.neuron/rules.yaml). Rules are hard constraints that override recipe strategies. " +
      "Three levels: 'never' (absolute — never follow anyone, never auto-send without approval), " +
      "'global' (apply to every recipe run), 'platform' (per-platform — e.g. linkedin-specific rules). " +
      "Task-specific rules are passed per-run via neuron_recipe_run.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "neuron_rules_set",
    description:
      "Set or update rules (~/.neuron/rules.yaml). Rules are non-negotiable constraints that override recipe strategies. " +
      "Provide any combination of: 'never' (absolute prohibitions), 'global' (apply to all runs), " +
      "'platform' (per-platform rules keyed by platform name). Merges with existing rules — " +
      "platform rules are merged per-platform, global and never are replaced entirely if provided.",
    inputSchema: {
      type: "object",
      properties: {
        never: {
          type: "array",
          items: { type: "string" },
          description: "Absolute prohibitions — things the agent must NEVER do (e.g. 'never follow anyone from the brand account', 'never send without human approval')",
        },
        global: {
          type: "array",
          items: { type: "string" },
          description: "Global rules for all recipes (e.g. 'always personalize messages', 'maximum 10 actions per session')",
        },
        platform: {
          type: "object",
          description: "Per-platform rules. Keys are platform names (instagram, x, linkedin, facebook, tiktok). Values are arrays of rule strings.",
        },
      },
    },
  },
  {
    name: "neuron_quickstart",
    description:
      "First-run onboarding. Checks extension connection status, shows available recipes, " +
      "checks if a user profile exists, and suggests the best first action. Call this when " +
      "you first connect to neuron-inspector and aren't sure where to start.",
    inputSchema: { type: "object", properties: {} },
  },
];

/** Handle a recipe tool call locally (no extension needed). */
export async function handleRecipeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "neuron_recipe_run": {
      const slug = args.slug as string;
      const recipe = recipes.getRecipe(slug);
      if (!recipe) throw new Error(`Recipe "${slug}" not found.`);

      // Merge user-provided variables on top of profile-resolved defaults
      const userVars = (args.variables as Record<string, unknown>) ?? {};
      const resolved = { ...recipe.resolved_variables, ...userVars };

      // Interpolate variables into agent.md
      let instructions = recipe.agent_md;
      for (const [key, value] of Object.entries(resolved)) {
        instructions = instructions.replaceAll(`{{${key}}}`, String(value ?? ""));
      }

      // Load and inject rules — these override recipe strategy
      const globalRules = recipes.getRules();
      const taskRules = (args.rules as string[]) ?? [];
      const platform = (resolved.platform as string) ?? undefined;
      const rulesBlock = recipes.formatRulesBlock(globalRules, taskRules, platform);
      if (rulesBlock) {
        instructions = rulesBlock + "\n" + instructions;
      }

      // Track active run
      activeRecipe = { slug, startedAt: new Date().toISOString(), variables: resolved };

      // Check for and consume pending scheduled runs
      const pendingPath = path.join(os.homedir(), ".neuron", "pending-runs.yaml");
      let pendingRuns: Array<{ slug: string; variables?: Record<string, unknown>; rules?: string[]; scheduled_at?: string }> = [];
      try {
        const pendingText = fs.readFileSync(pendingPath, "utf8");
        const parsed = YAML.parse(pendingText);
        if (Array.isArray(parsed)) pendingRuns = parsed;
      } catch { /* no pending runs file */ }

      // Remove this slug from pending if it was a scheduled run
      if (pendingRuns.length > 0) {
        const remaining = pendingRuns.filter(p => p.slug !== slug);
        if (remaining.length !== pendingRuns.length) {
          if (remaining.length === 0) {
            try { fs.unlinkSync(pendingPath); } catch { /* ok */ }
          } else {
            fs.writeFileSync(pendingPath, YAML.stringify(remaining));
          }
        }
      }

      // Get memory stats for evolve hint
      const memory = recipes.getMemory(slug, 1);
      const shouldEvolve = memory.total >= 5;

      // Count active rules for visibility
      const ruleCount =
        globalRules.never.length + globalRules.global.length + taskRules.length +
        (platform && globalRules.platform[platform] ? globalRules.platform[platform].length : 0);

      // Build warnings for issues that should be addressed
      const warnings: string[] = [];

      const unfilled = Object.entries(recipe.variables)
        .filter(([key]) => !(key in resolved) || resolved[key] === undefined || resolved[key] === "")
        .map(([key, def]) => ({ key, ...(def as Record<string, unknown>) }));

      // Warn on required unfilled variables
      const requiredUnfilled = unfilled.filter((v) => (v as Record<string, unknown>).required === true || (v as Record<string, unknown>).required === "true");
      if (requiredUnfilled.length > 0) {
        warnings.push(`Required variables not set: ${requiredUnfilled.map((v) => v.key).join(", ")}. The recipe may not work correctly.`);
      }

      // Check pipe dependencies — do the source recipes have output files?
      const parsedYaml = YAML.parse(recipe.recipe_yaml) as Record<string, unknown>;
      const pipes = (parsedYaml.pipes as Record<string, unknown>) ?? {};
      const pipeInputs = (pipes.inputs as Record<string, Record<string, unknown>>) ?? {};
      const missingPipes: string[] = [];
      for (const [pipeName, pipeDef] of Object.entries(pipeInputs)) {
        const fromRecipe = pipeDef?.from as string;
        const optional = pipeDef?.optional === true;
        if (fromRecipe && !optional) {
          const sourceRecipe = recipes.getRecipe(fromRecipe);
          if (!sourceRecipe) {
            missingPipes.push(`${pipeName}: source recipe "${fromRecipe}" not found`);
          } else if (sourceRecipe.meta.memory_count === 0) {
            missingPipes.push(`${pipeName}: source recipe "${fromRecipe}" has never been run — no output to pipe from`);
          }
        }
      }
      if (missingPipes.length > 0) {
        warnings.push(`Pipe dependencies not met: ${missingPipes.join("; ")}. Run the source recipes first.`);
      }

      // Remaining {{variables}} in instructions after interpolation = missed variables
      const unresolvedVars = [...instructions.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      const uniqueUnresolved = [...new Set(unresolvedVars)].filter(
        (v) => !["now", "date", "today", "topic_slug", "company_slug", "goal_slug"].includes(v),
      );
      if (uniqueUnresolved.length > 0) {
        warnings.push(`Unresolved template variables in instructions: ${uniqueUnresolved.join(", ")}`);
      }

      return {
        recipe: recipe.meta.name,
        slug,
        instructions,
        learnings: recipe.learnings,
        resolved_variables: resolved,
        unfilled_variables: unfilled,
        warnings: warnings.length > 0 ? warnings : null,
        active_rules: ruleCount,
        rules_summary: ruleCount > 0
          ? {
              never: globalRules.never,
              global: globalRules.global,
              platform: platform && globalRules.platform[platform] ? globalRules.platform[platform] : [],
              task: taskRules,
            }
          : null,
        memory_count: memory.total,
        evolve_hint: shouldEvolve
          ? `This recipe has ${memory.total} past runs. After completing this run, read memory with neuron_recipe_memory, analyze patterns, and update learnings with neuron_recipe_complete (include updated_learnings).`
          : null,
        pending_scheduled: pendingRuns.filter(p => p.slug !== slug).length > 0
          ? pendingRuns.filter(p => p.slug !== slug).map(p => p.slug)
          : null,
      };
    }

    case "neuron_recipe_complete": {
      if (!activeRecipe) throw new Error("No active recipe run. Call neuron_recipe_run first.");

      const { slug, startedAt, variables } = activeRecipe;
      const outcome = (args.outcome as Record<string, unknown>) ?? {};

      // Auto-log memory
      const entry = {
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        variables_used: variables,
        ...outcome,
      };
      const memResult = recipes.logMemory(slug, entry);

      // Persist updated learnings if provided (evolve phase)
      const updatedLearnings = args.updated_learnings as string | undefined;
      if (updatedLearnings) {
        recipes.updateRecipe(slug, { learnings: updatedLearnings });
      }

      // Get updated memory count
      const memory = recipes.getMemory(slug, 1);

      activeRecipe = null;

      return {
        logged_to: memResult.path,
        total_runs: memory.total,
        learnings_updated: !!updatedLearnings,
        next_evolve_at: memory.total < 5 ? `${5 - memory.total} more runs until first evolve` : "Ready to evolve — review memory and update learnings on next run",
      };
    }

    case "neuron_recipe_list":
      return recipes.listRecipes();

    case "neuron_recipe_get": {
      const result = recipes.getRecipe(args.slug as string);
      if (!result) throw new Error(`Recipe "${args.slug}" not found.`);
      return result;
    }

    case "neuron_recipe_create":
      return recipes.createRecipe(
        args.slug as string,
        args.name as string,
        args.description as string,
        args.agent_md as string,
        args.recipe_yaml as string,
      );

    case "neuron_recipe_update":
      return recipes.updateRecipe(args.slug as string, {
        agent_md: args.agent_md as string | undefined,
        learnings: args.learnings as string | undefined,
        recipe_yaml: args.recipe_yaml as string | undefined,
      });

    case "neuron_recipe_log":
      return recipes.logMemory(args.slug as string, args.entry as Record<string, unknown>);

    case "neuron_recipe_memory":
      return recipes.getMemory(args.slug as string, (args.limit as number) || 20);

    case "neuron_recipe_import":
      return recipes.importRecipe(args.source as string);

    case "neuron_recipe_export":
      return recipes.exportRecipe(args.slug as string, (args.include_learnings as boolean) ?? true);

    case "neuron_recipe_delete":
      recipes.deleteRecipe(args.slug as string);
      return { deleted: args.slug };

    case "neuron_profile_get": {
      const profile = recipes.getProfile();
      if (!profile) return { message: "No profile found. Create one with neuron_profile_save." };
      return profile;
    }

    case "neuron_profile_save":
      return recipes.saveProfile(args.data as Record<string, string>);

    case "neuron_rules_get":
      return recipes.getRules();

    case "neuron_rules_set":
      return recipes.saveRules({
        never: args.never as string[] | undefined,
        global: args.global as string[] | undefined,
        platform: args.platform as Record<string, string[]> | undefined,
      });

    case "neuron_quickstart": {
      const recipeList = recipes.listRecipes();
      const profile = recipes.getProfile();
      const rules = recipes.getRules();

      // Check for pending scheduled runs
      const pendingPath = path.join(os.homedir(), ".neuron", "pending-runs.yaml");
      let pendingRuns: unknown[] = [];
      try {
        const text = fs.readFileSync(pendingPath, "utf8");
        const parsed = YAML.parse(text);
        if (Array.isArray(parsed)) pendingRuns = parsed;
      } catch { /* no pending runs */ }

      return {
        status: "ready",
        profile: profile ? { exists: true, name: (profile as Record<string, unknown>).name } : { exists: false, hint: "Set up your profile with neuron_profile_save — it auto-fills recipe variables (name, email, location, timezone)" },
        recipes: {
          total: recipeList.length,
          available: recipeList.map(r => ({ name: r.name, slug: r.slug, description: r.description, has_learnings: r.has_learnings, runs: r.memory_count })),
        },
        rules: {
          total: rules.never.length + rules.global.length + Object.values(rules.platform).flat().length,
          hint: rules.never.length === 0 ? "No rules set yet. Use neuron_rules_set to add constraints (e.g. 'never follow anyone from the brand account')" : null,
        },
        pending_scheduled_runs: pendingRuns.length > 0 ? pendingRuns : null,
        suggested_first_actions: [
          !profile ? "1. Set up your profile: neuron_profile_save({ data: { name: '...', email: '...', timezone: '...' } })" : null,
          "2. List recipes: neuron_recipe_list",
          "3. Run your first recipe: neuron_recipe_run({ slug: 'web-researcher', variables: { research_topics: '...' } })",
          "Tip: The planner recipe researches platform constraints before outreach — run it first for any social campaign",
        ].filter(Boolean),
      };
    }

    default:
      throw new Error(`Unknown recipe tool: ${name}`);
  }
}
