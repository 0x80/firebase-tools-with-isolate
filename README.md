# Firebase CLI with monorepo support

This is a fork of the [firebase-tools](https://github.com/firebase/firebase-tools) which integrates [isolate-package](https://github.com/0x80/isolate-package/) as part of the functions `deploy` command in order to [support monorepo setups](https://thijs-koerselman.medium.com/deploy-to-firebase-without-the-hacks-e685de39025e).

Alternatively, you can manually configure `isolate` as part of the `predeploy` step of your configuration, but having the process integrated and only running as part of the deploy command is essential if you want to have live code updates when running the Firebase emulators locally during development with a watch task.

I suspect it will take some time before the Firebase team would agree to make isolate an integral part of the toolchain and that is why I have published this fork to be available on NPM.

The fork is pretty much identical, and the integration with isolate-package does
not affect any existing functionality, so I do not think there is a reason to worry
about things breaking. I will sync the fork with the upstream firebase-tools on
a regular basis. The fork versions will match the firebase-tools versions for
clarity.

## Installation

Add this dependency to the root of your monorepo, and co-locate all off your Firebase configurations there as well, as described in the docs.

I encourage you to use `pnpm` over `npm` or `yarn`. Apart from being fast and
efficient, PNPM has better support for monorepos, and the the lockfile isolation
code is solid and works in parallel for multiple packages, [unlike NPM](https://github.com/0x80/isolate-package/README.md#npm)

```bash
pnpm add firebase-tools-with-isolate -D -w
```

Or run the equivalent for NPM or Yarn.

> !! Do not forget to remove/uninstall the original `firebase-tools` package from your repository if you have it installed as a local dependency on your project, because otherwise that binary might get precedence over the forked one, and `npx firebase deploy` will execute the wrong one.

## Commands

Installing the fork locally provides you with the same `firebase` command but in order to execute a command on the command line you prefix it with `npx` like `npx firebase deploy`.

If you are using the commands as part of a package.json script, `npx` is not required, because scripts already prefer locally installed binaries when available.

## Configure

You have to opt-in to the functions isolate process by setting `functions.isolate: true` in your `firebase.json`. For example:

```json
{
  "functions": {
    "source": ".",
    "runtime": "nodejs20",
    "predeploy": ["turbo build"],
    "isolate": true
  }
}
```

If you have a monorepo, your firebase.json file should be located in the root listing all of the packages, emulator settings and other firebase related files. It would look something like this:

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
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "ui": {
      "enabled": true
    },
    "auth": {
      "port": 9099
    },
    "functions": {
      "port": 5001
    },
    "firestore": {
      "port": 8080
    },
    "pubsub": {
      "port": 8085
    }
  }
}
```

At the time of writing, firebase-tools has an seemingly odd limitation that prevents it from running predeploy commands with "=" in them. So `"turbo build --filter=@repo/api"` doesn't work. A workaround is to use `"pnpm build:api"` instead, and put `"build:api": "turbo build --filter=@repo/api"` in your root package.json.

If you would like to see a complete working example of a modern monorepo setup check out [mono-ts](https://github.com/0x80/mono-ts)

## Documentation

For all other documentation see the [original firebase tools](https://github.com/firebase/firebase-tools)
