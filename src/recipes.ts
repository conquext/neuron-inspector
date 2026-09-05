/**
 * Recipe manager — list, read, create, import, export, and log memory
 * for self-improving agent recipes. All file operations are local.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// ── Paths ───────────────────────────────────────────────────

/** Bundled recipes shipped with the package */
function bundledRecipesDir(): string {
  // recipes/ sits next to src/ in the package root
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

// ── Helpers ─────────────────────────────────────────────────

function readText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readYamlish(text: string): Record<string, unknown> {
  // Minimal YAML-like parser for recipe.yaml — handles flat and simple nested keys.
  // Not a full YAML parser; good enough for structured recipe metadata.
  const result: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (match) {
      const val = match[2].trim();
      if (val === "true") result[match[1]] = true;
      else if (val === "false") result[match[1]] = false;
      else if (/^\d+$/.test(val)) result[match[1]] = parseInt(val, 10);
      else result[match[1]] = val.replace(/^["']|["']$/g, "");
    }
  }
  return result;
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

  const meta = readYamlish(yamlText);

  // Parse tags from YAML list format
  const tagsMatch = yamlText.match(/^tags:\s*\[([^\]]*)\]/m);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
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

// ── Public API (called by MCP tool handlers) ────────────────

export function listRecipes(): RecipeSummary[] {
  const recipes: RecipeSummary[] = [];

  // Bundled
  const bundled = bundledRecipesDir();
  if (fs.existsSync(bundled)) {
    for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const r = parseRecipe(path.join(bundled, entry.name), "bundled");
      if (r) recipes.push(r);
    }
  }

  // User
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
} | null {
  // Check user dir first (overrides bundled)
  const userDir = path.join(userRecipesDir(), slug);
  const bundledDir = path.join(bundledRecipesDir(), slug);
  const dir = fs.existsSync(userDir) ? userDir : fs.existsSync(bundledDir) ? bundledDir : null;
  if (!dir) return null;

  const location = dir === userDir ? "user" : "bundled";
  const meta = parseRecipe(dir, location as "bundled" | "user");
  if (!meta) return null;

  const agentMd = readText(path.join(dir, "agent.md")) ?? "";
  const recipeYaml = readText(path.join(dir, "recipe.yaml")) ?? "";
  const learnings = readText(path.join(dir, "learnings.md"));

  // Parse variables from recipe.yaml (simplified)
  const variables: Record<string, unknown> = {};
  const varSection = recipeYaml.match(/^variables:\n((?:[\s].*\n)*)/m);
  if (varSection) {
    const varLines = varSection[1].split("\n");
    let currentVar = "";
    for (const line of varLines) {
      const nameMatch = line.match(/^\s{2}(\w[\w_-]*):/);
      if (nameMatch) {
        currentVar = nameMatch[1];
        variables[currentVar] = {};
      } else if (currentVar) {
        const propMatch = line.match(/^\s{4}(\w+):\s*(.+)/);
        if (propMatch) {
          (variables[currentVar] as Record<string, string>)[propMatch[1]] = propMatch[2].trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  }

  return { meta, agent_md: agentMd, recipe_yaml: recipeYaml, learnings, variables };
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
  const userDir = path.join(userRecipesDir(), slug);
  const bundledDir = path.join(bundledRecipesDir(), slug);

  let dir: string;
  if (fs.existsSync(userDir)) {
    dir = userDir;
  } else if (fs.existsSync(bundledDir)) {
    // Fork bundled recipe to user dir before editing
    fs.cpSync(bundledDir, userDir, { recursive: true });
    dir = userDir;
  } else {
    throw new Error(`Recipe "${slug}" not found.`);
  }

  if (updates.agent_md) fs.writeFileSync(path.join(dir, "agent.md"), updates.agent_md);
  if (updates.learnings) fs.writeFileSync(path.join(dir, "learnings.md"), updates.learnings);
  if (updates.recipe_yaml) fs.writeFileSync(path.join(dir, "recipe.yaml"), updates.recipe_yaml);

  return { path: dir };
}

export function logMemory(slug: string, entry: Record<string, unknown>): { path: string } {
  const userDir = path.join(userRecipesDir(), slug);
  const bundledDir = path.join(bundledRecipesDir(), slug);

  // Memory always goes to user dir
  let dir: string;
  if (fs.existsSync(userDir)) {
    dir = userDir;
  } else if (fs.existsSync(bundledDir)) {
    // Fork to user dir
    fs.cpSync(bundledDir, userDir, { recursive: true });
    dir = userDir;
  } else {
    throw new Error(`Recipe "${slug}" not found.`);
  }

  const memDir = path.join(dir, "memory");
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const count = fs.readdirSync(memDir).length + 1;
  const filename = `${ts}-run-${String(count).padStart(3, "0")}.yaml`;
  const filepath = path.join(memDir, filename);

  // Simple YAML-like serialization
  const lines: string[] = [`date: ${now.toISOString()}`];
  for (const [key, value] of Object.entries(entry)) {
    if (key === "date") continue;
    if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${k2}: ${JSON.stringify(v2)}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  fs.writeFileSync(filepath, lines.join("\n") + "\n");

  return { path: filepath };
}

export function getMemory(slug: string, limit = 20): { entries: Record<string, unknown>[]; total: number } {
  const userDir = path.join(userRecipesDir(), slug);
  const bundledDir = path.join(bundledRecipesDir(), slug);
  const dir = fs.existsSync(userDir) ? userDir : fs.existsSync(bundledDir) ? bundledDir : null;
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
      entries.push({ _file: f, ...readYamlish(text) });
    }
  }

  return { entries, total: files.length };
}

export function importRecipe(source: string): { slug: string; path: string } {
  let srcDir: string;

  if (source.startsWith("github:")) {
    // github:user/repo or github:user/repo/path
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

    // If the cloned repo IS a recipe (has recipe.yaml at root), use it directly
    if (!fs.existsSync(path.join(srcDir, "recipe.yaml"))) {
      // Check if it's a repo with recipes/ subdir
      const recipesSubdir = path.join(srcDir, "recipes");
      if (fs.existsSync(recipesSubdir)) {
        // Import all recipes from the repo
        const imported: string[] = [];
        for (const entry of fs.readdirSync(recipesSubdir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (!fs.existsSync(path.join(recipesSubdir, entry.name, "recipe.yaml"))) continue;
          const destDir = path.join(userRecipesDir(), entry.name);
          if (fs.existsSync(destDir)) continue; // skip existing
          fs.cpSync(path.join(recipesSubdir, entry.name), destDir, { recursive: true });
          imported.push(entry.name);
        }
        // Clean up
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (imported.length === 0) throw new Error("No recipes found in repository");
        return { slug: imported.join(", "), path: userRecipesDir() };
      }
      throw new Error("No recipe.yaml found in repository root or recipes/ subdirectory");
    }
  } else {
    // Local path
    srcDir = path.resolve(source);
  }

  if (!fs.existsSync(path.join(srcDir, "recipe.yaml"))) {
    throw new Error(`No recipe.yaml found at ${srcDir}`);
  }

  const yamlText = readText(path.join(srcDir, "recipe.yaml"));
  const meta = yamlText ? readYamlish(yamlText) : {};
  const slug = String(meta.name || path.basename(srcDir)).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const destDir = path.join(userRecipesDir(), slug);
  if (fs.existsSync(destDir)) {
    throw new Error(`Recipe "${slug}" already exists. Delete it first or use a different name.`);
  }

  fs.cpSync(srcDir, destDir, { recursive: true });
  // Remove memory from imported recipe (local-only)
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
  return readYamlish(text);
}

export function saveProfile(data: Record<string, string>): { path: string } {
  const dir = path.dirname(profilePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lines = Object.entries(data).map(([k, v]) => `${k}: "${v}"`);
  fs.writeFileSync(profilePath(), lines.join("\n") + "\n");
  return { path: profilePath() };
}
