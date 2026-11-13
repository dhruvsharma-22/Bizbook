import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const tsxCli = resolve(root, "node_modules/tsx/dist/cli.mjs");

function collectTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(path);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

function run(label: string, file: string): void {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(process.execPath, [tsxCli, file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(`${label} could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const testFiles = collectTests(join(root, "lib"));
if (testFiles.length === 0) {
  process.stderr.write("No lib/**/*.test.ts files were found.\n");
  process.exit(1);
}

for (const file of testFiles) run(relative(root, file), file);
run("lib/bizbook-brain/test-cases.ts", join(root, "lib/bizbook-brain/test-cases.ts"));
process.stdout.write(`\nAll ${testFiles.length} local test files and the BizBook Brain suite passed.\n`);
