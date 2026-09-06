/**
 * Recipe manager — list, read, create, import, export, and log memory
 * for self-improving agent recipes. All file operations are local.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import YAML from "yaml";

// ── Paths ───────────────────────────────────────────────────

/** Bundled recipes shipped with the package */
function bundledRecipesDir(): string {
  const srcDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(srcDir, "..", "recipes");
}

/** User's local recipe store */
function userRecipesDir(): string {
  const dir = path.join(os.homedir(), ".neuron", "recipes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** User profile path */
function profilePath(): string {
  return path.join(os.homedir(), ".neuron", "profile.yaml");
}

/** Global rules path */
function rulesPath(): string {
  return path.join(os.homedir(), ".neuron", "rules.yaml");
}

// ── Helpers ─────────────────────────────────────────────────

function readText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseYaml(text: string): Record<string, unknown> {
  try {
    const parsed = YAML.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

interface RecipeSummary {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  location: "bundled" | "user";
  path: string;
  has_learnings: boolean;
  has_memory: boolean;
  memory_count: number;
}

function parseRecipe(dir: string, location: "bundled" | "user"): RecipeSummary | null {
  const yamlPath = path.join(dir, "recipe.yaml");
  const yamlText = readText(yamlPath);
  if (!yamlText) return null;

  const meta = parseYaml(yamlText);

  const tags = Array.isArray(meta.tags)
    ? (meta.tags as unknown[]).map(String)
    : [];

  const memoryDir = path.join(dir, "memory");
  const memoryFiles = fs.existsSync(memoryDir)
    ? fs.readdirSync(memoryDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    : [];

  const learningsPath = path.join(dir, "learnings.md");

  return {
    name: String(meta.name || path.basename(dir)),
    slug: path.basename(dir),
    version: String(meta.version || "0.0.0"),
    description: String(meta.description || ""),
    author: String(meta.author || "unknown"),
    tags,
    location,
    path: dir,
    has_learnings: fs.existsSync(learningsPath) && (readText(learningsPath) ?? "").length > 100,
    has_memory: memoryFiles.length > 0,
    memory_count: memoryFiles.length,
  };
}

// ── Resolve recipe directory ────────────────────────────────

function resolveRecipeDir(slug: string): string | null {
  const userDir = path.join(userRecipesDir(), slug);
  if (fs.existsSync(userDir)) return userDir;
  const bundledDir = path.join(bundledRecipesDir(), slug);
  if (fs.existsSync(bundledDir)) return bundledDir;
  return null;
}

/** Fork a bundled recipe to user dir for writing, return the user dir path. */
function ensureWritable(slug: string): string {
  const userDir = path.join(userRecipesDir(), slug);
  if (fs.existsSync(userDir)) return userDir;

  const bundledDir = path.join(bundledRecipesDir(), slug);
  if (fs.existsSync(bundledDir)) {
    fs.cpSync(bundledDir, userDir, { recursive: true });
    return userDir;
  }

  throw new Error(`Recipe "${slug}" not found.`);
}

// ── Public API ──────────────────────────────────────────────

export function listRecipes(): RecipeSummary[] {
  const recipes: RecipeSummary[] = [];

  const bundled = bundledRecipesDir();
  if (fs.existsSync(bundled)) {
    for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const r = parseRecipe(path.join(bundled, entry.name), "bundled");
      if (r) recipes.push(r);
    }
  }

  const user = userRecipesDir();
  for (const entry of fs.readdirSync(user, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const r = parseRecipe(path.join(user, entry.name), "user");
    if (r) recipes.push(r);
  }

  return recipes;
}

export function getRecipe(slug: string): {
  meta: RecipeSummary;
  agent_md: string;
  recipe_yaml: string;
  learnings: string | null;
  variables: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  resolved_variables: Record<string, unknown>;
} | null {
  const dir = resolveRecipeDir(slug);
  if (!dir) return null;

  const location = dir.startsWith(userRecipesDir()) ? "user" : "bundled";
  const meta = parseRecipe(dir, location as "bundled" | "user");
  if (!meta) return null;

  const agentMd = readText(path.join(dir, "agent.md")) ?? "";
  const recipeYaml = readText(path.join(dir, "recipe.yaml")) ?? "";
  const learnings = readText(path.join(dir, "learnings.md"));

  const parsed = parseYaml(recipeYaml);
  const variables = (parsed.variables as Record<string, unknown>) ?? {};

  // Merge profile into variables to pre-fill matching keys
  const profile = getProfile();
  const resolved: Record<string, unknown> = {};
  for (const [varName, varDef] of Object.entries(variables)) {
    const def = varDef as Record<string, unknown> | null;
    if (profile && varName in profile) {
      resolved[varName] = profile[varName];
    } else if (def && "default" in def) {
      resolved[varName] = def.default;
    }
  }

  return {
    meta,
    agent_md: agentMd,
    recipe_yaml: recipeYaml,
    learnings,
    variables,
    profile,
    resolved_variables: resolved,
  };
}

export function createRecipe(
  slug: string,
  name: string,
  description: string,
  agentMd: string,
  recipeYaml: string,
): { path: string } {
  const dir = path.join(userRecipesDir(), slug);
  if (fs.existsSync(dir)) {
    throw new Error(`Recipe "${slug}" already exists at ${dir}. Use a different slug or delete the existing one.`);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent.md"), agentMd);
  fs.writeFileSync(path.join(dir, "recipe.yaml"), recipeYaml);
  fs.writeFileSync(path.join(dir, "learnings.md"), `# Learnings\n\nNo runs yet.\n`);

  return { path: dir };
}

export function updateRecipe(
  slug: string,
  updates: { agent_md?: string; learnings?: string; recipe_yaml?: string },
): { path: string } {
  const dir = ensureWritable(slug);

  if (updates.agent_md) fs.writeFileSync(path.join(dir, "agent.md"), updates.agent_md);
  if (updates.learnings) fs.writeFileSync(path.join(dir, "learnings.md"), updates.learnings);
  if (updates.recipe_yaml) fs.writeFileSync(path.join(dir, "recipe.yaml"), updates.recipe_yaml);

  return { path: dir };
}

export function pruneMemory(slug: string, keepCount = 50): { pruned: number; remaining: number } {
  const dir = resolveRecipeDir(slug);
  if (!dir) throw new Error(`Recipe "${slug}" not found.`);

  const memDir = path.join(dir, "memory");
  if (!fs.existsSync(memDir)) return { pruned: 0, remaining: 0 };

  const files = fs.readdirSync(memDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort(); // Sorted by filename (which includes timestamp)

  const totalFiles = files.length;
  if (totalFiles <= keepCount) {
    return { pruned: 0, remaining: totalFiles };
  }

  // Delete the oldest files
  const toDelete = files.slice(0, totalFiles - keepCount);
  for (const f of toDelete) {
    fs.unlinkSync(path.join(memDir, f));
  }

  return { pruned: toDelete.length, remaining: keepCount };
}

export function logMemory(slug: string, entry: Record<string, unknown>): { path: string } {
  const dir = ensureWritable(slug);

  const memDir = path.join(dir, "memory");
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const count = fs.readdirSync(memDir).length + 1;
  const filename = `${ts}-run-${String(count).padStart(3, "0")}.yaml`;
  const filepath = path.join(memDir, filename);

  const data = { date: now.toISOString(), ...entry };
  fs.writeFileSync(filepath, YAML.stringify(data));

  // Auto-prune if we exceed 100 files
  const allFiles = fs.readdirSync(memDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (allFiles.length > 100) {
    pruneMemory(slug, 50);
  }

  return { path: filepath };
}

export function getMemory(slug: string, limit = 20): { entries: Record<string, unknown>[]; total: number } {
  const dir = resolveRecipeDir(slug);
  if (!dir) throw new Error(`Recipe "${slug}" not found.`);

  const memDir = path.join(dir, "memory");
  if (!fs.existsSync(memDir)) return { entries: [], total: 0 };

  const files = fs.readdirSync(memDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .reverse();

  const entries: Record<string, unknown>[] = [];
  for (const f of files.slice(0, limit)) {
    const text = readText(path.join(memDir, f));
    if (text) {
      entries.push({ _file: f, ...parseYaml(text) });
    }
  }

  return { entries, total: files.length };
}

export function importRecipe(source: string): { slug: string; path: string } {
  let srcDir: string;

  if (source.startsWith("github:")) {
    const parts = source.slice(7).split("/");
    const repo = `${parts[0]}/${parts[1]}`;
    const subpath = parts.slice(2).join("/");
    const tmpDir = path.join(os.tmpdir(), `neuron-recipe-${Date.now()}`);
    try {
      execSync(`git clone --depth 1 https://github.com/${repo}.git "${tmpDir}"`, { stdio: "pipe" });
    } catch {
      throw new Error(`Failed to clone https://github.com/${repo}`);
    }
    srcDir = subpath ? path.join(tmpDir, subpath) : tmpDir;

    if (!fs.existsSync(path.join(srcDir, "recipe.yaml"))) {
      const recipesSubdir = path.join(srcDir, "recipes");
      if (fs.existsSync(recipesSubdir)) {
        const imported: string[] = [];
        for (const entry of fs.readdirSync(recipesSubdir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (!fs.existsSync(path.join(recipesSubdir, entry.name, "recipe.yaml"))) continue;
          const destDir = path.join(userRecipesDir(), entry.name);
          if (fs.existsSync(destDir)) continue;
          fs.cpSync(path.join(recipesSubdir, entry.name), destDir, { recursive: true });
          // Strip memory from imports
          const mem = path.join(destDir, "memory");
          if (fs.existsSync(mem)) fs.rmSync(mem, { recursive: true, force: true });
          imported.push(entry.name);
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (imported.length === 0) throw new Error("No new recipes found in repository");
        return { slug: imported.join(", "), path: userRecipesDir() };
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw new Error("No recipe.yaml found in repository root or recipes/ subdirectory");
    }
  } else {
    srcDir = path.resolve(source);
  }

  if (!fs.existsSync(path.join(srcDir, "recipe.yaml"))) {
    throw new Error(`No recipe.yaml found at ${srcDir}`);
  }

  const yamlText = readText(path.join(srcDir, "recipe.yaml"));
  const meta = yamlText ? parseYaml(yamlText) : {};
  const slug = String(meta.name || path.basename(srcDir))
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const destDir = path.join(userRecipesDir(), slug);
  if (fs.existsSync(destDir)) {
    throw new Error(`Recipe "${slug}" already exists. Delete it first or use a different name.`);
  }

  fs.cpSync(srcDir, destDir, { recursive: true });
  const importedMemory = path.join(destDir, "memory");
  if (fs.existsSync(importedMemory)) {
    fs.rmSync(importedMemory, { recursive: true, force: true });
  }

  return { slug, path: destDir };
}

export function exportRecipe(slug: string, includeLearnings = true): {
  agent_md: string;
  recipe_yaml: string;
  learnings: string | null;
} {
  const recipe = getRecipe(slug);
  if (!recipe) throw new Error(`Recipe "${slug}" not found.`);

  return {
    agent_md: recipe.agent_md,
    recipe_yaml: recipe.recipe_yaml,
    learnings: includeLearnings ? recipe.learnings : null,
  };
}

export function deleteRecipe(slug: string): void {
  const dir = path.join(userRecipesDir(), slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`Recipe "${slug}" not found in user recipes. Bundled recipes can't be deleted.`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

export function getProfile(): Record<string, unknown> | null {
  const text = readText(profilePath());
  if (!text) return null;
  return parseYaml(text);
}

export function saveProfile(data: Record<string, string>): { path: string } {
  const dir = path.dirname(profilePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Merge with existing profile
  const existing = getProfile() ?? {};
  const merged = { ...existing, ...data };
  fs.writeFileSync(profilePath(), YAML.stringify(merged));
  return { path: profilePath() };
}

// ── Rules ───────────────────────────────────────────────────

export interface Rules {
  global: string[];
  platform: Record<string, string[]>;
  never: string[];
}

export function getRules(): Rules {
  const text = readText(rulesPath());
  if (!text) return { global: [], platform: {}, never: [] };
  const parsed = parseYaml(text);

  return {
    global: Array.isArray(parsed.global) ? (parsed.global as string[]) : [],
    platform: (parsed.platform as Record<string, string[]>) ?? {},
    never: Array.isArray(parsed.never) ? (parsed.never as string[]) : [],
  };
}

export function saveRules(rules: Partial<Rules>): { path: string } {
  const dir = path.dirname(rulesPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existing = getRules();
  const merged: Rules = {
    global: rules.global ?? existing.global,
    platform: rules.platform ? { ...existing.platform, ...rules.platform } : existing.platform,
    never: rules.never ?? existing.never,
  };

  fs.writeFileSync(rulesPath(), YAML.stringify(merged));
  return { path: rulesPath() };
}

/**
 * System defaults — always injected into every recipe run.
 * These encode "how a human behaves" so the agent doesn't need to be told each time.
 */
const SYSTEM_DEFAULTS = [
  "Format messages the way a human texts — short paragraphs with blank lines between them, not walls of text.",
  "Use \\n\\n between paragraphs in all messages (DMs, emails, comments). The typing tool renders line breaks correctly.",
  "Match the length and energy of the conversation. If they wrote 2 sentences, reply with 2-3 sentences, not 5 paragraphs.",
  "Never use em dashes (—), semicolons in casual messages, or the phrase 'I hope this message finds you well.'",
  "No AI-sounding language: avoid 'I would be happy to', 'certainly', 'absolutely', 'I wanted to reach out', 'leverage', 'synergy.'",
  "After typing into any field, verify the text appears correctly before proceeding. If the placeholder is still visible or text overlaps, clear and retype.",
  "Always focus the tab before clicking, typing, or submitting. Background tabs render interactive elements at zero dimensions.",
  "Scroll to the bottom of message threads before reading — newest messages are at the bottom on all messaging platforms.",
  "After sending any message, wait 2 seconds and verify it appeared in the thread. If it didn't, the send failed.",
  "When a selector fails, try visible text matching before reporting failure. Text labels are more stable than CSS classes.",
];

/** Format rules as a constraints block to inject into agent instructions. */
export function formatRulesBlock(
  globalRules: Rules,
  taskRules?: string[],
  platform?: string,
): string {
  const lines: string[] = [];

  // System defaults — always present
  lines.push("## System Defaults (always active)");
  for (const r of SYSTEM_DEFAULTS) lines.push(`- ${r}`);
  lines.push("");

  if (globalRules.never.length > 0) {
    lines.push("## HARD CONSTRAINTS (never violate)");
    for (const r of globalRules.never) lines.push(`- ${r}`);
    lines.push("");
  }

  if (globalRules.global.length > 0) {
    lines.push("## Global Rules");
    for (const r of globalRules.global) lines.push(`- ${r}`);
    lines.push("");
  }

  if (platform && globalRules.platform[platform]?.length) {
    lines.push(`## Platform Rules (${platform})`);
    for (const r of globalRules.platform[platform]) lines.push(`- ${r}`);
    lines.push("");
  }

  if (taskRules && taskRules.length > 0) {
    lines.push("## Task-Specific Rules");
    for (const r of taskRules) lines.push(`- ${r}`);
    lines.push("");
  }

  // System defaults are always present, so this always returns a non-empty block
  return "---\n\n" + lines.join("\n") + "\n---\n\nThe rules above override ANY conflicting instruction in the recipe strategy. If a rule says never do X, do not do X even if the strategy says to.\n";
}
