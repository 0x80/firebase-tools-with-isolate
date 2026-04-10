# Firebase CLI with monorepo support

This is a fork of [firebase-tools](https://github.com/firebase/firebase-tools) that integrates [isolate-package](https://github.com/0x80/isolate-package/) into the functions `deploy` command to [support monorepo setups](https://thijs-koerselman.medium.com/deploy-to-firebase-without-the-hacks-e685de39025e).

The integration is minimal — roughly 50 lines of code across 3 files — and does not affect any existing functionality. Isolation runs **automatically** whenever your functions source directory sits inside a detected monorepo (pnpm / npm / yarn / bun workspaces, or Rush). Standalone projects are left untouched and behave exactly like upstream.

## Installation

Add this dependency to the root of your monorepo:

```bash
pnpm add firebase-tools-with-isolate -D -w
```

Or the equivalent for NPM or Yarn. I encourage using `pnpm` — apart from being fast and efficient, it has better monorepo support, and the lockfile isolation code is solid and works in parallel for multiple packages, [unlike NPM](https://github.com/0x80/isolate-package/README.md#npm).

> **Important:** Remove/uninstall the original `firebase-tools` package if you have it installed, because otherwise that binary might get precedence over the forked one and `npx firebase deploy` will execute the wrong one.

## Usage

Installing the fork provides you with the same `firebase` command. On the command line, prefix it with `npx`:

```bash
npx firebase deploy
```

In package.json scripts, `npx` is not required — scripts already prefer locally installed binaries.

## Configuration

No configuration is required. When you run `firebase deploy`, the fork calls `detectMonorepo` from `isolate-package` on the functions source directory. If a workspace root is found (pnpm-workspace.yaml, a parent `package.json` with a `workspaces` field, or `rush.json`), isolation runs automatically. Otherwise the deploy proceeds exactly as in upstream firebase-tools.

```json
{
  "functions": {
    "source": ".",
    "runtime": "nodejs22",
    "predeploy": ["turbo build"]
  }
}
```

For a monorepo with multiple function packages, place `firebase.json` at the root:

```json
{
  "functions": [
    {
      "source": "services/api",
      "predeploy": ["pnpm build:api"],
      "runtime": "nodejs22",
      "codebase": "api"
    },
    {
      "source": "services/fns",
      "predeploy": ["pnpm build:fns"],
      "runtime": "nodejs22",
      "codebase": "fns"
    }
  ]
}
```

> **Note:** firebase-tools has a limitation that prevents running predeploy commands containing `=`. So `"turbo build --filter=@repo/api"` won't work. Use `"pnpm build:api"` instead, with `"build:api": "turbo build --filter=@repo/api"` in your root package.json.

For a complete working example of a modern monorepo setup, check out [mono-ts](https://github.com/0x80/mono-ts).

## How this fork stays in sync

Fork versions match upstream firebase-tools versions (e.g. `15.13.0` corresponds to upstream `v15.13.0`). The fork is kept in sync using automated tooling:

### Scripts (`scripts/sync/`)

- **`apply-isolate-changes.mjs`** — Applies the isolate integration on top of any clean upstream release. Patches 2 source files plus `package.json` and the README, using anchor-based string matching verified to be stable across upstream releases from v15.4.0 through v15.13.0.

- **`sync-upstream.sh`** — Orchestrates the full sync: fetches upstream, merges a release tag, re-applies the isolate changes, installs dependencies, and verifies the build compiles.

The sync can also be triggered manually:

```bash
# Sync to the latest upstream release
./scripts/sync/sync-upstream.sh

# Sync to a specific version
./scripts/sync/sync-upstream.sh --target v15.13.0

# Dry run (no push)
./scripts/sync/sync-upstream.sh --no-push --no-build
```

### GitHub Actions (`.github/workflows/`)

All workflows use Node 24 and npm OIDC trusted publishing (provenance).

- **[`sync-upstream.yml`](.github/workflows/sync-upstream.yml)** — Runs daily (09:00 UTC) and on manual dispatch. Checks for new upstream firebase-tools releases, merges to main, and triggers the publish workflow automatically. Can target a specific version.

- **[`update-isolate.yml`](.github/workflows/update-isolate.yml)** — Updates the `isolate-package` dependency to a given version, bumps the fork's pre-release number (e.g. `15.13.0` → `15.13.0-1`), and opens a PR targeting `main`. Follow up with the publish workflow to release to npm.

- **[`publish.yml`](.github/workflows/publish.yml)** — Publishes the fork to npm. Called automatically by the sync workflow, or can be triggered manually. Creates a git tag and GitHub release.

### Versioning

- The daily sync automatically publishes version `X.Y.Z` matching upstream `vX.Y.Z`
- Isolate-package updates use pre-release versions (`X.Y.Z-1`, `X.Y.Z-2`, ...) published under the `next` dist-tag

## Issues

Issues on this repository are disabled. If you encounter a problem related to the isolate process or monorepo deployment, please submit it at [isolate-package](https://github.com/0x80/isolate-package/issues). For issues unrelated to the isolate integration, refer to the upstream [firebase-tools](https://github.com/firebase/firebase-tools/issues).

## Documentation

For all other documentation see the [official firebase-tools](https://github.com/firebase/firebase-tools).
