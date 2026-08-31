# Tianshu IDE Desktop

English | [中文](tianshu-ide-desktop.zh.md)

Tianshu IDE Desktop is the desktop shell for the Tianshu agent ecosystem, built by modifying VS Code (the "Cursor route"). It ships the Tianshu panel as a built-in extension, connects to `rivet serve` (http://127.0.0.1:4455), and keeps both the vscode extension ecosystem and the oh-my-tianshu (Cordis) plugin ecosystem.

## Repository

Code lives in the private repository yeshilei-QWQ/tianshu-ide-desktop. The modification recipe (patches, built-in extension, workflow, README) is archived in the main project `yeshilei-QWQ/tianshu-ide` under `vscode-mods/`.

## Build recipe

`vscode-mods/` contains everything needed to rebuild the desktop shell from upstream VS Code:

- `vscode-mods/patches/` — 10 `git format-patch` patches against upstream microsoft/vscode (fork baseline `abeda1b7`), apply in order with `git am`
- `vscode-mods/extensions-tianshu/` — built-in Tianshu panel extension (source + `dist` output)
- `vscode-mods/build.yml` — dual-platform GitHub Actions workflow (Windows x64 + macOS arm64/x64)
- `vscode-mods/README.md` — full rebuild steps and known limitations

Key modifications covered by the 10 patches:

1. Product name "天枢 IDE" + extensionsGallery + relaunch fix + built-in extension
2. Dual-platform build workflow
3. Windows VS-install detection bypass + mac npm ci retry
4. Zip packaging + upload path + YAML syntax fix
5. signtool verify-first
6. Zip packaging from buildRoot
7. signtool error → resolve(false)
8. Copilot SDK missing → warn and skip
9. Built-in extension dist committed with `git add -f`
10. Extension signature verification bypass when `@vscode/vsce-sign` is absent

## Known limitations

- No code signing (Windows SmartScreen may warn)
- Copilot not enabled
- macOS not validated on physical hardware
