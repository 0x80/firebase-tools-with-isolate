# Firebase CLI with monorepo support

This is an experimental fork of the [Firebase Tools](https://github.com/firebase/firebase-tools) which integrates [isolate-package](https://github.com/0x80/isolate-package/) as part of the functions `deploy` command in order to [support monorepo setups](https://thijs-koerselman.medium.com/deploy-to-firebase-without-the-hacks-e685de39025e).

Alternatively, you can manually configure `isolate` as part of the `predeploy` step of your configuration, but having the process integrated and only running as part of the deploy command is essential if you want to have live code updates when running the Firebase emulators locally during development with a watch task.

I suspect it will take some time before the Firebase team would agree to make isolate an integral part of the toolchain and that is why I have published this fork to be available on NPM.

In the meantime I will try to keep this fairly in-sync with updates to the original firebase-tools repository. The published versions of the fork will be kept the same as the original `firebase-tools` package, so you can easily see how up-to-date it is.

## Installation

It is probably best to install this as a local dependency on whatever package you want to deploy to Firebase, as opposed to using a global install. This way the forked binary does not interfere with the original one on your system, and you can easily use the fork on one project will still using the original one on others.

```bash
npm install firebase-tools-with-isolate --save-dev
```

Personally I would advise you to [try PNPM](https://pnpm.io/feature-comparison) for monorepo setups. At the moment, `isolate-package` only supports generating isolated lockfiles for PNPM, but you can always choose to deploy to Firebase without a lockfile, similar to other workarounds people have been using.

```bash
pnpm add firebase-tools-with-isolate -D
```

Or, if you want to work with the latest pre-release version

```bash
pnpm add firebase-tools-with-isolate@next -D
```

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

If you like to see a complete example of a monorepo setup with Typescript and multiple Firebase service deployments check out [mono-ts](https://github.com/0x80/mono-ts)

## Documentation

For all other documentation see the [original firebase tools](https://github.com/firebase/firebase-tools)
