# `@deepseek-ai/dsh-web-app`

English | [中文](README.zh.md)

The dsh browser-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage) and the browser plugin roster, and mounts this package's `web-runtime` glue plugin (config `{mode, printUrl, surfaceContext, lanAddresses}`). That plugin resolves the built frontend dist through `@deepseek-ai/dsh-frontend`'s exports, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner over it, registers the web-surface prompt section and the bash-visible `DSH_WEB_URL`/`DSH_WEB_MODE` runtime variables when `surfaceContext` is true, and prints the `dsh web:` URL line when `printUrl` is true. The `dsh web` launcher alias patches `mode`/`lanAddresses` and the flag family over these rows. [`dsh-headless`](../headless/README.md) is a sibling surface over the same base and does not mount this bundle.

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
