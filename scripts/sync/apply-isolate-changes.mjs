#!/usr/bin/env node

/**
 * Apply isolate-package integration changes to a clean upstream firebase-tools
 * checkout. This script makes the minimal set of changes needed to add
 * isolate-package support with automatic monorepo detection.
 *
 * It's designed to be idempotent — running it twice produces the same result.
 *
 * Usage:
 *   node scripts/sync/apply-isolate-changes.mjs [options]
 *
 * Options:
 *   --version, -v                 Upstream version (read from package.json if omitted)
 *   --isolate-version, -i         isolate-package semver range (default: current value in package.json)
 *   --detect-monorepo-version, -d detect-monorepo semver range (default: current value in package.json)
 */

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const { values: args } = parseArgs({
  options: {
    version: { type: "string", short: "v" },
    "isolate-version": { type: "string", short: "i" },
    "detect-monorepo-version": { type: "string", short: "d" },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function writeFile(relativePath, content) {
  writeFileSync(join(ROOT, relativePath), content, "utf8");
}

/**
 * Assert that `content` contains `anchor`. If not, print a clear error
 * pointing at the file and the expected text so the developer knows which
 * anchor to update.
 */
function assertAnchor(content, anchor, fileName) {
  if (!content.includes(anchor)) {
    console.error(`\n❌ Anchor not found in ${fileName}`);
    console.error(
      `   Expected: ${JSON.stringify(anchor.length > 120 ? anchor.slice(0, 120) + "…" : anchor)}`,
    );
    console.error(`\n   Upstream likely changed this code section.`);
    console.error(`   Update the anchor in scripts/sync/apply-isolate-changes.mjs\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. package.json
// ---------------------------------------------------------------------------

function patchPackageJson() {
  const pkg = JSON.parse(readFile("package.json"));

  // Strip any existing fork suffix (e.g. "15.3.1-0" → "15.3.1") so that
  // running the script twice doesn't produce "15.3.1-0-0".
  const upstreamVersion = (args.version || pkg.version).replace(/-0$/, "");

  pkg.name = "firebase-tools-with-isolate";
  pkg.description = "Command-Line Interface for Firebase with monorepo support";
  pkg.version = `${upstreamVersion}-0`;
  pkg.repository = {
    type: "git",
    url: "git+https://github.com/0x80/firebase-tools-with-isolate.git",
  };

  // Add keywords after "firebase" if not already present
  if (!pkg.keywords?.includes("monorepo")) {
    const idx = (pkg.keywords || []).indexOf("firebase");
    if (idx !== -1) {
      pkg.keywords.splice(idx + 1, 0, "monorepo", "isolate");
    }
  }

  // Fall back to the values already in package.json when the version flags
  // weren't passed. This only helps direct manual invocations: the sync
  // pipeline calls this script *after* merging upstream, at which point
  // package.json no longer has the isolate-package or detect-monorepo keys.
  // sync-upstream.sh captures the values before the merge and always passes
  // them explicitly.
  const isolateVersion =
    args["isolate-version"] ?? pkg.dependencies?.["isolate-package"];
  if (!isolateVersion) {
    console.error(
      "\n❌ --isolate-version not provided and package.json has no dependencies['isolate-package']\n",
    );
    process.exit(1);
  }
  const detectMonorepoVersion =
    args["detect-monorepo-version"] ?? pkg.dependencies?.["detect-monorepo"];
  if (!detectMonorepoVersion) {
    console.error(
      "\n❌ --detect-monorepo-version not provided and package.json has no dependencies['detect-monorepo']\n",
    );
    process.exit(1);
  }
  pkg.dependencies ??= {};
  pkg.dependencies["isolate-package"] = isolateVersion;
  pkg.dependencies["detect-monorepo"] = detectMonorepoVersion;

  // Remove publishConfig — upstream uses Google's internal Wombat Dressing Room
  // registry which we can't and shouldn't use
  delete pkg.publishConfig;

  writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✅ package.json → firebase-tools-with-isolate@${pkg.version}`);
}

// ---------------------------------------------------------------------------
// 2. src/deploy/functions/prepareFunctionsUpload.ts — add isMonorepoSource()
//    and runIsolate()
// ---------------------------------------------------------------------------

function patchPrepareFunctionsUpload() {
  const filePath = "src/deploy/functions/prepareFunctionsUpload.ts";
  let content = readFile(filePath);

  if (content.includes("isMonorepoSource")) {
    console.log(`⏭️  ${filePath} — already patched`);
    return;
  }

  // --- Add detect-monorepo + isolate-package imports ---
  const importAnchor = 'import { FirebaseError } from "../../error";';
  assertAnchor(content, importAnchor, filePath);

  content = content.replace(
    importAnchor,
    [
      'import { detectMonorepo } from "detect-monorepo";',
      'import type { IsolateExports } from "isolate-package";',
      'import { dynamicImport } from "../../dynamicImport";',
      'import { FirebaseError } from "../../error";',
    ].join("\n"),
  );

  // --- Add isMonorepoSource + runIsolate before convertToSortedKeyValueArray ---
  const functionAnchor = "export function convertToSortedKeyValueArray";
  assertAnchor(content, functionAnchor, filePath);

  const injectedFunctions = `\
/**
 * Check whether the given absolute source directory sits inside a monorepo
 * workspace (pnpm, npm/yarn/bun workspaces, or Rush). Used as a cheap gate
 * before invoking isolate-package.
 *
 * Uses detect-monorepo's default upward walk depth. Set
 * FIREBASE_TOOLS_ISOLATE_MONOREPO_MAX_DEPTH to a positive integer (or
 * Infinity) to raise the cap when the functions source is nested deeper than
 * the default.
 */
export function isMonorepoSource(absoluteSourceDir: string): boolean {
  const override = process.env.FIREBASE_TOOLS_ISOLATE_MONOREPO_MAX_DEPTH;
  const options = override ? { maxDepth: Number(override) } : undefined;
  return detectMonorepo(absoluteSourceDir, options) !== null;
}

/**
 * Isolate the source directory and return the path to the isolated directory.
 */
export async function runIsolate(sourceDirName: string): Promise<string> {
  try {
    utils.logLabeledBullet("isolate", "Isolating the source");
    /**
     * Use a dynamic import because isolate-package depends on ESM. A normal
     * "await import()" gets transpiled to require() so we use the dynamicImport
     * function which was created to get around that exact problem. Unfortunately,
     * when using it we lose all type information so IsolateExports was created to
     * be able to cast the result.
     */
    const { isolate } = (await dynamicImport("isolate-package")) as IsolateExports;

    /**
     * Only set the targetPackagePath if the sourceDirName is not the current
     * working directory. By default the isolate function will use the current
     * working directory and assume the monorepo root is elsewhere, but the
     * sourceDirName is given a path if we deploy from the monorepo root.
     */
    const isolateDir = await isolate(
      sourceDirName !== "."
        ? {
            targetPackagePath: path.join("./", sourceDirName),
          }
        : undefined,
    );

    utils.logLabeledBullet("isolate", \`Finished isolation at \${clc.bold(isolateDir)}\`);
    return isolateDir;
  } catch (err: any) {
    utils.logLabeledBullet("isolate", \`Isolation failed: \${err.message}\`, "error");
    throw err;
  }
}

`;

  content = content.replace(functionAnchor, injectedFunctions + functionAnchor);

  writeFile(filePath, content);
  console.log(`✅ ${filePath} → added isMonorepoSource() and runIsolate()`);
}

// ---------------------------------------------------------------------------
// 3. src/deploy/functions/prepare.ts — import and call detection + runIsolate
// ---------------------------------------------------------------------------

function patchPrepare() {
  const filePath = "src/deploy/functions/prepare.ts";
  let content = readFile(filePath);

  if (content.includes("isMonorepoSource")) {
    console.log(`⏭️  ${filePath} — already patched`);
    return;
  }

  // Strip any leftover isolate references from a bad merge (either the old
  // flag-based block, a bare isMonorepoSource block, or an existing
  // deprecation warning) so we can re-apply cleanly from upstream's version.
  content = content
    .replace(/, runIsolate/g, "")
    .replace(/, isMonorepoSource/g, "")
    .replace(/, logLabeledWarning/g, "")
    .replace(/\n\n? {4}if \(localCfg\.isolate === true\) \{\n.*runIsolate.*\n {4}\}\n/g, "\n")
    .replace(
      /\n\n? {4}if \(\(localCfg as \{ isolate\?: boolean \}\)\.isolate === true\) \{[\s\S]*?\n {4}\}\n/g,
      "\n",
    )
    .replace(
      /\n\n? {4}if \(isMonorepoSource\([^)]+\)\) \{\n.*runIsolate.*\n {4}\}\n/g,
      "\n",
    )
    .replace(/\blet sourceDir = options\.config\.path/g, "const sourceDir = options.config.path");

  // --- Add logLabeledWarning to utils import ---
  const utilsImportAnchor = 'import { logLabeledBullet } from "../../utils";';
  assertAnchor(content, utilsImportAnchor, filePath);
  content = content.replace(
    utilsImportAnchor,
    'import { logLabeledBullet, logLabeledWarning } from "../../utils";',
  );

  // --- Add isMonorepoSource + runIsolate to the import ---
  const importAnchor =
    'import { getFunctionsConfig, prepareFunctionsUpload } from "./prepareFunctionsUpload";';
  assertAnchor(content, importAnchor, filePath);

  content = content.replace(
    importAnchor,
    [
      "import {",
      "  getFunctionsConfig,",
      "  isMonorepoSource,",
      "  prepareFunctionsUpload,",
      "  runIsolate,",
      '} from "./prepareFunctionsUpload";',
    ].join("\n"),
  );

  // --- Change `const sourceDir` to `let sourceDir` in the Phase 3 block ---
  //
  // We use a specific two-line context to target the right `sourceDir` declaration
  // (there's another one in loadCodebases that should not be touched).
  const constAnchor =
    "    const sourceDir = options.config.path(sourceDirName);\n    const source: args.Source = {};";
  assertAnchor(content, constAnchor, filePath);

  content = content.replace(
    constAnchor,
    "    let sourceDir = options.config.path(sourceDirName);\n    const source: args.Source = {};",
  );

  // --- Insert isolate block after the "preparing directory" log ---
  //
  // We look for the end of the log block (closing `}`) followed by the next
  // `if (backend.someEndpoint(…))` that checks the platform. The regex is
  // tolerant of the exact platform condition changing over time.
  const isolateBlockRegex =
    /(      \);\n    \}\n\n)(    if \(backend\.someEndpoint\(wantBackend, \(e\) => e\.platform ===)/;

  if (!isolateBlockRegex.test(content)) {
    console.error(`\n❌ Could not find isolate insertion point in ${filePath}`);
    console.error(`   The log-block-end → platform-check pattern was not matched.`);
    console.error(`   Update the regex in apply-isolate-changes.mjs\n`);
    process.exit(1);
  }

  content = content.replace(
    isolateBlockRegex,
    [
      "$1",
      "    if ((localCfg as { isolate?: boolean }).isolate === true) {\n",
      "      logLabeledWarning(\n",
      '        "functions",\n',
      "        \"The 'isolate' flag in firebase.json is deprecated and no longer needed — monorepo detection is now automatic. Please remove 'isolate' from your functions config.\",\n",
      "      );\n",
      "    }\n",
      "\n",
      "    if (isMonorepoSource(sourceDir)) {\n",
      "      sourceDir = await runIsolate(sourceDirName);\n",
      "    }\n",
      "\n",
      "$2",
    ].join(""),
  );

  writeFile(filePath, content);
  console.log(`✅ ${filePath} → added isMonorepoSource/runIsolate import and call`);
}

// ---------------------------------------------------------------------------
// 4. README.md — replace with fork documentation
// ---------------------------------------------------------------------------

function patchReadme() {
  const source = join(__dirname, "fork-readme.md");
  copyFileSync(source, join(ROOT, "README.md"));
  console.log("✅ README.md → replaced with fork documentation");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\n🔧 Applying isolate-package integration changes…\n");

try {
  patchPackageJson();
  patchPrepareFunctionsUpload();
  patchPrepare();
  patchReadme();
} catch (err) {
  console.error(`\n❌ Failed: ${err.message}\n`);
  process.exit(1);
}

console.log("\n✨ All isolate changes applied successfully!\n");
console.log("Next steps:");
console.log("  1. npm install       — regenerate npm-shrinkwrap.json");
console.log("  2. npm run build     — verify the build compiles");
console.log("");
