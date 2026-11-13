import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function routePathFromFile(appDirectory: string, filePath: string): string {
  const relativePath = path.relative(appDirectory, filePath).split(path.sep).join("/");
  const segments = relativePath.split("/");
  const leaf = segments.pop() ?? "";
  if (!/^(?:page|route)\.(?:ts|tsx|js|jsx)$/.test(leaf)) return "";

  const routeSegments = segments.filter((segment) =>
    !/^\(.*\)$/.test(segment) && !segment.startsWith("@"),
  );
  return routeSegments.length ? `/${routeSegments.join("/")}` : "/";
}

function matchesRoute(referencePath: string, routePath: string): boolean {
  const referenceSegments = referencePath.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);
  let referenceIndex = 0;
  let routeIndex = 0;

  while (routeIndex < routeSegments.length) {
    const routeSegment = routeSegments[routeIndex];
    if (/^\[\[\.\.\..+\]\]$/.test(routeSegment)) return true;
    if (/^\[\.\.\..+\]$/.test(routeSegment)) {
      return referenceIndex < referenceSegments.length;
    }
    if (referenceIndex >= referenceSegments.length) return false;
    if (!/^\[.+\]$/.test(routeSegment) && routeSegment !== referenceSegments[referenceIndex]) {
      return false;
    }
    referenceIndex += 1;
    routeIndex += 1;
  }

  return referenceIndex === referenceSegments.length;
}

function collectStaticReferences(source: string): string[] {
  const referencePattern = /(?:\bhref\s*(?:=|:)\s*\{?\s*|\brouter\.(?:push|replace)\(\s*|\bredirect\(\s*|\bfetch\(\s*)["'`]\/([^"'`$]*)/g;
  const references: string[] = [];
  for (const match of source.matchAll(referencePattern)) {
    const pathname = (`/${match[1]}`).split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
    references.push(pathname);
  }
  return references;
}

assert.equal(routePathFromFile(path.join(process.cwd(), "app"), path.join(process.cwd(), "app", "page.tsx")), "/");
assert.equal(matchesRoute("/students/abc", "/students/[studentId]"), true);
assert.equal(matchesRoute("/students/abc/extra", "/students/[studentId]"), false);
assert.equal(matchesRoute("/docs/a/b", "/docs/[...slug]"), true);
assert.equal(matchesRoute("/docs", "/docs/[[...slug]]"), true);

const appDirectory = path.join(process.cwd(), "app");
const routeFiles = walk(appDirectory).filter((filePath) => routePathFromFile(appDirectory, filePath));
const routePaths = routeFiles.map((filePath) => routePathFromFile(appDirectory, filePath));
const sourceDirectories = [appDirectory, path.join(process.cwd(), "components")];
const sourceFiles = sourceDirectories.flatMap(walk).filter((filePath) => /\.(?:ts|tsx|js|jsx)$/.test(filePath));
const missing = new Map<string, string[]>();

for (const sourceFile of sourceFiles) {
  const source = readFileSync(sourceFile, "utf8");
  for (const referencePath of collectStaticReferences(source)) {
    if (referencePath === "/_not-found") continue;
    const exists = routePaths.some((routePath) => matchesRoute(referencePath, routePath));
    if (!exists) {
      const files = missing.get(referencePath) ?? [];
      files.push(path.relative(process.cwd(), sourceFile));
      missing.set(referencePath, files);
    }
  }
}

assert.deepEqual(
  [...missing.entries()],
  [],
  `Static internal references must resolve to an App Router page or handler: ${JSON.stringify([...missing.entries()])}`,
);

console.log(`Internal route reference tests: 5 matcher assertions and ${routeFiles.length} route files passed.`);
