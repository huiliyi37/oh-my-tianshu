# host/ — web-GUI host half

English | [中文](README.zh.md)

The host side of the dsh web GUI: the API gateway every client shape shares, and the plain HTTP server it rides on. The browser side lives in [`client/`](../client/README.md); the composed application is [`apps/cli`](../../apps/cli/README.md) booting the [`dsh-base` bundle](../bundle/base/cordis.patch.yml) serving [`apps/web`](../../apps/web/). All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`apiproxy/`](apiproxy/README.md) | Shared host API gateway and wire contract | `ctx.apiProxy` |
| [`webserver/`](webserver/README.md) | HTTP route carrier | `ctx.httpServer` |
| [`frontend-static/`](frontend-static/README.md) | SPA dist server on the webserver fallback seat | consumes `ctx.httpServer` |
| [`directory-picker/`](directory-picker/README.md) | Workspace-directory picking seam | `ctx.directoryPicker` |
| [`directory-picker-native/`](directory-picker-native/README.md) | Native directory-picker backend and browser interaction | registers `ctx.directoryPicker` |
| [`directory-picker-browse/`](directory-picker-browse/README.md) | In-app directory-browser backend and interaction | registers `ctx.directoryPicker` |
| [`directory-picker-auto/`](directory-picker-auto/README.md) | Host-adaptive picker composition | mounts a backend |

`apiproxy` remains transport-independent; [`client/connection`](../client/connection/README.md) supplies the browser/HTTP carrier. Picker implementations replace one another behind the shared seam.

The subsystem references: [http-server.md](../../docs/subsystems/http-server.md) and [workspace.md](../../docs/subsystems/workspace.md) (the picker seam).
