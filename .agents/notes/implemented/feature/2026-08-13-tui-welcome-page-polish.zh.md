# Agent Note: TUI 欢迎页打磨——品牌头 / 友好会话行 / 常驻环境行

Status: implemented

[English](2026-08-13-tui-welcome-page-polish.md) | 中文

## Problem

C4 B 布局 Wave 之后，启动欢迎页仍是纯文本堆叠：顶部栏之上没有品牌身份锚点；可恢复会话行显示裸 UUID（且 `cwd` 只在 live 会话才显示，持久化会话读作 `○ <uuid> · 1 小时前 · fork: <uuid>`）；环境检查行只在无可恢复会话时才渲染；菜单右对齐的 `keyHint` 占满终端最后一列，autowrap 终端把 `ctrl+q` 裁成 `ctrl+`。启动时的命令回显（如 `/model` 的「模型已切换」）紧贴菜单、无视觉分隔。

## Decision

全部改动落在纯函数层 + `app.ts` 组装层（宽度守恒、ascii 可降级、零 IO）：

- **品牌头**（`format/welcome.ts` 新增 `formatBrandHeader`）：单行渲染 `DSH`（粗体 `brandColor`）+ muted 副标题（缺省 `DeepSeek Harness`）；副标题按剩余预算截断。
- **友好会话行**（`restore-session.ts` 的 `formatRestorableSessions`）：改为年龄在前，裸 id 换成 `#` 前缀 8 位短 id；`cwd` 对 live/持久化行一律显示 basename；fork 来源为 `fork #` 短父 id。完整 id 语义不变——`restore-session` 只做格式化，完整 id 仍驱动 `/session switch`。
- **常驻环境行**（`format/welcome.ts` 新增 `formatEnvCheckLine`）：单行 muted `API Key ✓/✗ · Git ✓/✗ · <cols>×<rows> · <background>`，无论有无可恢复会话都渲染。措辞用「API Key」而非 footer 的「API ✗」，避免与 footer 合并段在 grep 级断言上碰撞。
- **菜单末列预留**（`formatWelcomeMenu`）：内容预算改为 `width - 1`，右对齐 `keyHint` 不再占用终端最后一列（规避 autowrap 空行/末字被裁）。
- **启动重组**（`app.ts` `renderRestorableSessions`）：品牌头 → 顶部栏 → 空行 → 会话列表（或首启引导）→ 空行 → 环境行 → 空行 → 菜单 → 收尾空行。环境行的 `background` 读 `getActiveThemeBackground()`（`attach` 已解析的主题明暗），不再重复 OSC 11 探测。

## Verification

- `tests/welcome.spec.ts` +7：品牌头（缺省/自定义/截断/width≤0）与环境行（全 OK / 缺 key 非 git / cols≤0）。
- `tests/restore-session.spec.ts`：既有用例改写为年龄在前 + 短 id 形式；+1 长 UUID → 8 位 `#` id。
- `tests/app.spec.ts`：会话恢复接线断言 `#` 短 id 且裸 id 不再出现；IME `caretCol` 接线用例在同套件内覆盖。
- TUI 全量 **1457 passed / 2 todo**（80 文件）；一个对时序敏感的流利度用例在全量负载下偶发 5s 超时、单独运行通过（与本改动无关）。`tsc -b packages/tui/tui` 0 错误；oxlint 0 错误；改动文件 `verify-export-jsdoc` 无报错。

## Files

- `packages/tui/tui/src/format/welcome.ts`：`formatBrandHeader` + `FormatBrandHeaderInput`、`formatEnvCheckLine`、`formatWelcomeMenu` 末列预留
- `packages/tui/tui/src/restore-session.ts`：年龄在前的友好行 + `#` 短 id + cwd basename
- `packages/tui/tui/src/ui/app.ts`：`renderRestorableSessions` 重组；环境行用 `getActiveThemeBackground()`
- 测试：`welcome.spec.ts`、`restore-session.spec.ts`、`app.spec.ts`

## Alternatives considered

**Hero 大框 / 品牌字符画欢迎页（概念 A hero、概念 B 品牌字符画）** — 本轮否决：C4 决策记录把两者都排在 Wave 3 之后作为可选装饰；stacked 布局已覆盖功能，品牌头在不需要 ≥90 列 hero 框的前提下提供身份锚点。

**保留裸完整会话 id** — 否决：完整 UUID 一眼不可读；8 位 `#` id 对齐 git 短 SHA 惯例，完整 id 仍是 `/session switch` 的权威标识（格式化只影响显示）。

**显示完整 `cwd` 路径** — 否决：顶部栏已承载完整路径；会话行只需 basename 即可区分。

## Consequences

- 欢迎页会话行把 id 截为 8 位；碰撞只影响显示（完整 id 仍驱动恢复/切换），与既有的「只展示一个」限高一致。
- 环境行现在首屏常驻，即便存在可恢复会话也能一眼看到 API key / git / 终端状态。
- 菜单行至多 `width - 1` 列；收尾空行把启动命令回显与欢迎页在视觉上分离。
