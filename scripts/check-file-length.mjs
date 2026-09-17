import console from "node:console";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";

const MAX_LINES = 350;
const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".pnpm-store",
  "coverage",
  "dist",
  "node_modules",
]);

async function codeFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await codeFiles(root, path)));
      }
    } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function physicalLineCount(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(source) ? lines - 1 : lines;
}

const root = resolve(process.cwd());
const violations = [];
for (const path of (await codeFiles(root)).sort()) {
  const lineCount = physicalLineCount(await readFile(path, "utf8"));
  if (lineCount > MAX_LINES) {
    violations.push({ path: relative(root, path), lineCount });
  }
}

if (violations.length > 0) {
  console.error(`Code files must not exceed ${MAX_LINES} physical lines:`);
  for (const violation of violations) {
    console.error(`- ${violation.path}: ${violation.lineCount} lines`);
  }
  process.exitCode = 1;
} else {
  console.log(`File-length check passed: every code file is <= ${MAX_LINES} lines.`);
}
