# Firebase CLI with monorepo support

This is a fork of [firebase-tools](https://github.com/firebase/firebase-tools) that integrates [isolate-package](https://github.com/0x80/isolate-package/) into the functions `deploy` command to [support monorepo setups](https://thijs-koerselman.medium.com/deploy-to-firebase-without-the-hacks-e685de39025e).

The integration is minimal — roughly 50 lines of code across 4 files — and does not affect any existing functionality. The `isolate` step is entirely opt-in via a flag in your `firebase.json`.

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

Opt in to isolate-package by setting `isolate: true` in your `firebase.json`:

```json
{
  "functions": {
    "source": ".",
    "runtime": "nodejs22",
    "predeploy": ["turbo build"],
    "isolate": true
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
      "codebase": "api",
      "isolate": true
    },
    {
      "source": "services/fns",
      "predeploy": ["pnpm build:fns"],
      "runtime": "nodejs22",
      "codebase": "fns",
      "isolate": true
    }
  ]
}
```

> **Note:** firebase-tools has a limitation that prevents running predeploy commands containing `=`. So `"turbo build --filter=@repo/api"` won't work. Use `"pnpm build:api"` instead, with `"build:api": "turbo build --filter=@repo/api"` in your root package.json.

For a complete working example of a modern monorepo setup, check out [mono-ts](https://github.com/0x80/mono-ts).

## How this fork stays in sync

Fork versions match upstream firebase-tools versions (e.g. `15.13.0-0` corresponds to upstream `v15.13.0`). The fork is kept in sync using automated tooling in `scripts/sync/`:

- **`apply-isolate-changes.mjs`** — A script that applies the isolate integration on top of any clean upstream release. It patches exactly 4 source files and `package.json`, using anchor-based string matching that has been verified to be stable across upstream releases from v15.4.0 through v15.13.0.

- **`sync-upstream.sh`** — Orchestrates the full sync: fetches upstream, merges a release tag, re-applies the isolate changes, installs dependencies, and verifies the build compiles.

- **GitHub Actions** — A [sync workflow](.github/workflows/sync-upstream.yml) runs weekly and opens a PR when a new upstream release is detected. A separate [publish workflow](.github/workflows/publish.yml) handles npm releases with OIDC provenance.

The sync can also be triggered manually:

```bash
# Sync to the latest upstream release
./scripts/sync/sync-upstream.sh

# Sync to a specific version
./scripts/sync/sync-upstream.sh --target v15.13.0

# Dry run (no push)
./scripts/sync/sync-upstream.sh --no-push --no-build
```

## Documentation

For all other documentation see the [official firebase-tools](https://github.com/firebase/firebase-tools).
