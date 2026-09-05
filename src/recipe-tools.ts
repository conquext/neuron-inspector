/**
 * Recipe MCP tools — same ToolDef shape as browser tools so they register
 * through the same mcp.tool() overload. Handled locally (no extension needed).
 */

import type { ToolDef } from "./tools.js";
import * as recipes from "./recipes.js";

export const RECIPE_TOOLS: ToolDef[] = [
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
];

/** Handle a recipe tool call locally (no extension needed). */
export async function handleRecipeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
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

    default:
      throw new Error(`Unknown recipe tool: ${name}`);
  }
}
