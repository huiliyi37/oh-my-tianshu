# `@huiliyi37/dsh-web-app`

English | [中文](README.zh.md)

The dsh browser-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage, the Markdown `memory` service, and `dsh-command-memory` so the slash menu can `/remember` and `/memory`) and the browser plugin roster, and mounts this package's `web-runtime` glue plugin (config `{mode, openBrowser, printUrl, surfaceContext, lanAddresses}`). That plugin resolves the built frontend dist through `@huiliyi37/dsh-frontend`'s exports, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner over it, and registers the web-surface prompt section and the bash-visible `DSH_WEB_URL`/`DSH_WEB_MODE` runtime variables when `surfaceContext` is true. After its Loader tree settles, it prints the `tianshu web:` URL line when `printUrl` is true and opens the canonical host URL in the default browser when `openBrowser` is true and the inherited `SSH_CONNECTION` and `SSH_TTY` are blank or absent. An SSH launch keeps the URL line but suppresses browser handoff because the SSH client or editor owns the local forwarded address. Immediately before a handoff, the runtime prints `tianshu web: opening the default browser; pass --no-open to disable`. A short-lived Node helper runs the maintained platform opener (`open`) with the canonical scrubbed child environment. On Windows it stays alive until the short-lived PowerShell launcher exits, because `open` reports spawn before that launcher has handed the URL to the shell; elsewhere the helper stops after the opener accepts spawn. A helper failure writes a diagnostic with its reason and the manual URL to stderr without stopping the server, and no path waits for the browser to exit. The `oh-my-tianshu web` launcher alias patches `mode`/`lanAddresses` and the rest of the flag family over these rows; `--no-open` forces `openBrowser` off for that invocation. [`dsh-headless`](../headless/README.md) is a sibling surface over the same base and does not mount this bundle. The TUI owns `/remember` and `/memory` in its private registry and does not mount `dsh-command-memory`.

## Model Experience

### Web-surface prompt section and bash runtime variables

#### What the model sees

When `surfaceContext` is true, the `app:web-surface` global section (order −98) orients the model to the GUI: the canonical local URL, the "this page" referent, the HMR/rebuild update contract for the active mode, and the instruction not to start replacement servers. `DSH_WEB_URL` and `DSH_WEB_MODE` additionally appear in the managed bash environment with their descriptions, resolved per invocation from the live server. When it is false, neither the section nor the variables are registered.

#### Token effect

One prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (port and mode are boot facts), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **`lanAddresses` is a boot-time snapshot** — interface changes after boot are not re-advertised; the printed LAN URL always matches the configured trust fence.
- **Only handoff startup is observable** — observation ends when the platform opener accepts spawn, except that Windows waits for its short-lived PowerShell launcher to exit; a later browser exit is not reported, and the printed URL remains the manual fallback.
- **SSH forwarding owns the browser URL** — the printed canonical URL names the remote host's loopback endpoint; automatic handoff is suppressed, and the SSH client or editor must expose and open its local forwarded address.
- **Browser command overrides are launch-only** — a discovered `.env` may not set `BROWSER`; only an inherited value may reach an opener path that honors the variable, so a checkout cannot choose an executable for automatic handoff.
