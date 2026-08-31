# 天枢 IDE 桌面端

[English](tianshu-ide-desktop.md) | 中文

天枢 IDE 桌面端是天枢 agent 生态的图形化 IDE 主壳，基于魔改 VS Code（Cursor 路线）构建。内置天枢面板扩展，接入 `rivet serve`（http://127.0.0.1:4455），同时保留 vscode 扩展生态与 oh-my-tianshu（Cordis）插件生态。

## 代码仓库

代码在私有仓库 yeshilei-QWQ/tianshu-ide-desktop。魔改配方（补丁、内置扩展、构建 workflow、说明）归档在主工程 `yeshilei-QWQ/tianshu-ide` 的 `vscode-mods/` 目录。

## 构建配方

`vscode-mods/` 包含从上游 VS Code 重建桌面壳所需的全部内容：

- `vscode-mods/patches/` —— 针对官方 microsoft/vscode（fork 基线 `abeda1b7`）的 10 个 `git format-patch` 补丁，按序用 `git am` 应用
- `vscode-mods/extensions-tianshu/` —— 内置天枢面板扩展（源码 + `dist` 产物）
- `vscode-mods/build.yml` —— 双端构建 GitHub Actions workflow（Windows x64 + macOS arm64/x64）
- `vscode-mods/README.md` —— 完整重建步骤与已知限制

10 个补丁覆盖的关键魔改：

1. 产品名「天枢 IDE」+ 扩展市场 + relaunch 修复 + 内置扩展
2. 双端构建 workflow
3. Windows VS 安装探测绕过 + mac npm ci 重试
4. zip 打包 + 上传路径 + YAML 语法修复
5. signtool 先校验
6. 从 buildRoot 打包 zip
7. signtool 错误 → resolve(false)
8. Copilot SDK 缺失 → 警告并跳过
9. 内置扩展 dist 用 `git add -f` 提交
10. `@vscode/vsce-sign` 缺失时放行扩展签名验证

## 已知限制

- 未做代码签名（Windows SmartScreen 可能提示）
- Copilot 功能未启用
- macOS 未经实体机验证
