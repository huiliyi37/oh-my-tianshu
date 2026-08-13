# Package and install a plugin

English | [中文](publish.zh.md)

The previous tutorials loaded a local plugin through a `--patch` overlay. This tutorial packages it as an installable **bundle**, installs it into a **profile** with `dsh plugin add`, and explains the layer order that determines the composed configuration. Complete [plugin configuration](./config.md) first.

## Two concepts, two manifests

Installation is built on two concepts. Both are described by a `package.json`, but they carry different kinds of manifest under the `dsh` key, and they answer different questions:

- A **bundle** is an npm package that ships a configuration layer. Its manifest declares `dsh.bundle`, answering "what does this package contribute?": a patch file that inserts or overrides plugin rows.
- A **profile** is a directory under `$DSH_HOME/profiles/<name>` describing one runnable composition. Its manifest declares `dsh.profile`, answering "which bundles compose this setup, in what order?".

A bundle is what you author and distribute; a profile is what a user boots with `dsh --profile <name>`. Nothing is both.

### The bundle manifest

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

The patch file has the same shape as the `--patch` overlays you have been writing — a YAML array of patch entries — except plugin rows reference the package by name instead of a relative source path, so Node resolution finds the installed code:

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

A package without the `dsh.bundle` declaration still installs, but only as a plain dependency: `dsh plugin` prints a warning and activates no layer. That is the correct shape for a library that plugin packages import rather than a plugin users enable.

### The profile manifest

A profile directory holds two files:

- `package.json` — the profile's out-of-tree plugin dependencies (managed by pnpm) plus the `dsh.profile` manifest with its ordered `bundles` list.
- `cordis.patch.yml` — the user's own patch layer, applied after every bundle layer.

You never write a profile manifest by hand: `dsh plugin` creates and maintains it. The next section shows the result.

## Install into a profile

`dsh plugin --profile <name> <args...>` forwards to pnpm in the profile directory, so every pnpm verb works. Install your package from its checkout:

```sh
cd hello-plugin
dsh plugin --profile demo add .
```

The first use initializes the profile (with `@deepseek-ai/dsh-base` as its first bundle), pnpm links the checkout, and `dsh` appends the bundle to `dsh.profile.bundles` because the package declares `dsh.bundle`:

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

Verify the layer without booting, then boot:

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin` removes both the dependency and the layer.

## The loading order

The effective configuration composes over an empty root by applying, in order:

1. Each bundle patch named in the profile's `dsh.profile.bundles` list, in list order — `@deepseek-ai/dsh-base` first, then each installed bundle in the order it was added.
2. The profile's own `cordis.patch.yml`.
3. The home-level `$DSH_HOME/cordis.patch.yml` — machine-local preferences shared by every profile.
4. Each `--patch <path>` overlay, in argv order.
5. Launcher flag patches (for example `dsh web --port`).

Later layers win per row, and a patch replaces a row's entire `config` value rather than deep-merging keys. Two consequences for bundle authors:

- Your patch can override rows from earlier layers by `id` — the same way [the `dsh-web-app` bundle](../../../../packages/bundle/web-app/cordis.patch.yml) overrides `dsh-base` rows — but must restate every key the row needs, not just the changed one.
- Users can override your rows in their profile's `cordis.patch.yml` without touching your package, so prefer configuration defaults users are likely to keep and let the schema carry the rest.

In-box bundle names always resolve from the dsh installation itself; pnpm manages only out-of-tree packages, so your bundle can rely on `@deepseek-ai/dsh-base` being present and current.

## Installing from GitHub: the build-script catch

Publishing to a registry is not required — users can install straight from a git host:

```sh
dsh plugin --profile demo add github:you/hello-plugin
```

But a git install fetches **sources, not built artifacts**: nothing runs your `build` script, so a TypeScript package arrives without its `lib/` output and fails to load. Two things must happen, one on each side:

- **The author** ships a `prepare` script — pnpm runs it after a git install — that builds the published entry points from source, self-contained: it must not assume dev-only context such as a sibling monorepo checkout. [turtle-ui](https://github.com/deepseek-harness/turtle-ui) is a working example: its `prepare` runs a dedicated tsdown config that transpiles `src/` without project references or type checking.
- **The user** allowlists the build. pnpm ≥10 refuses to run a git dependency's `prepare` script until it is explicitly allowed, so the first `add` fails; `dsh` points at the fix — copy the exact package key pnpm printed into the profile's `pnpm-workspace.yaml`:

  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```

  and re-run the `add`.

Treat that allowance as what it is: **permission to execute the package's code on your machine at install time**, outside any sandbox the agent runs under. Only allow packages whose source you trust, and pin a commit (`github:you/hello-plugin#<sha>`) so a later push cannot silently change what runs.

If you would rather not ask users for the allowance, distribute built artifacts instead — neither form needs any build permission:

- **Publish to npm** with `lib/` built at `pnpm publish` time; `dsh plugin add your-package` then installs prebuilt code.
- **Ship a tarball** from `pnpm pack`; users run `dsh plugin add ./hello-plugin-0.1.0.tgz`.

## Next steps

- [Plugins and lifecycle](../framework/) — the full plugin lifecycle
- [CLI behavior reference](../../../../apps/cli/reference/README.md) — exact layer precedence, flags, and profile mechanics
