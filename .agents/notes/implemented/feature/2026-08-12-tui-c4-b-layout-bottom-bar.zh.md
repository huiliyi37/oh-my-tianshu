# Agent Note: TUI C4 概念稿 B 布局 Wave——输入框底边线 / 欢迎页会话限高 / footer 合并

Status: implemented

[English](2026-08-12-tui-c4-b-layout-bottom-bar.md) | 中文

## Problem

TUI 底部与欢迎页与概念稿形态差距：① 欢迎页可恢复会话列表全量输出（`formatRestorableSessions` 无上限），会话一多即占满首屏；② 输入行是裸文本，下方无任何横线/框线，与 claude code 布局的输入框质感不符。用户选型：**概念 B「深潜」（claude code 布局），四周不带框线，先做 B 的样式**；欢迎页一般不进旧会话，「展示一个就行了」。

## Decision

按 B 布局实施三个纯函数层改动（零 IO、宽度守恒、ascii 可降级）：

- **输入框底边圆角线**（新 `format/input-divider.ts`）：`formatInputDivider` 输出 `└` + `─`×填充（ascii 降级 `+`/`-`），色随模式——normal `secondary` / plan（active/pending）`warning` / auto（alwaysApprove）`error`，与 footer 徽标同源词汇。在 `renderLive` 输入行下方渲染（B「只画底边圆角框」：输入区上下留白、四周无包围框线）。
- **欢迎页会话列表限高**（`restore-session.ts`）：`formatRestorableSessions` 加 `maxRows` 选项（缺省/≤0 不限制，兼容旧调用）；超限只展示前 maxRows 行，追加折叠提示「… 还有 N 个会话」。`app.ts` 启动欢迎传 `maxRows: 1`。
- **footer 一行合并**（`format/prompt-footer.ts`）：`formatPromptFooter` 加可选 `rightSegments`（token/模型/API 状态等）。宽终端（≥ `FOOTER_RIGHT_MERGE_MIN_WIDTH` = 80 列，B 的窄屏纵排阈值）右对齐合并进同一行，放不下从后往前丢右段；窄终端不合并，metrics 独立行保持（B「窄终端纵排两行」）。`app.ts` 把 `glanceBarSegments(...)` 输出 + `API ✓/✗` 段（构造时读一次 `DEEPSEEK_API_KEY`）作为右段喂入；合并时 metrics 行不再单独渲染。

## Verification

- 新 `tests/input-divider.spec.ts` 8 用例：形态/ascii/色随模式三档/width≤0 空数组/宽度守恒。
- `tests/restore-session.spec.ts` +3：maxRows=1 折叠提示、maxRows 超总数不折叠、maxRows≤0 不限制。
- `tests/prompt-footer.spec.ts` +5：宽屏右对齐合并、右段从后丢、窄屏不合并、空右段与缺省一致、极窄 mode 段退化。
- `tests/app.spec.ts` +2 接线：宽屏（100 列）输出含 `└─+` 与 `API ✗`（合并路径）；窄屏（70 列）含底边线、无 API 段（独立行路径）。
- TUI 全量 **1354 passed / 2 todo**（76 文件）；`tsc --noEmit` 0 错误；oxlint 0 错误；`verify-export-jsdoc` 通过；三个改动文件覆盖率 100%（prompt-footer 不可达分支按仓库惯例 `v8 ignore` 注明）。

## Files

- `src/format/input-divider.ts`（新；后由 `packages/tui/tui/src/format/input-frame.ts` 取代）：`formatInputDivider` + `FormatInputDividerInput`
- `packages/tui/tui/src/format/prompt-footer.ts`：`FOOTER_RIGHT_MERGE_MIN_WIDTH` + `rightSegments` 合并（`mergeRightSegments` 私有助手）
- `packages/tui/tui/src/restore-session.ts`：`RestorableOptions.maxRows` + 折叠提示行
- `packages/tui/tui/src/ui/app.ts`：欢迎页传 `maxRows: 1`；renderLive 渲染底边线、footer 右段接线（`glanceBarSegments` + `apiKeyReady` 字段）、窄屏 metrics 独立行
- `packages/tui/tui/SOURCE-MAP.md`：登记 `src/format/input-divider.ts`（new）
- `docs/dsh-tui-视觉概念稿-c4.md`：决策记录第 8 节
- 测试：`input-divider.spec.ts`（新）、`restore-session.spec.ts`、`prompt-footer.spec.ts`、`app.spec.ts`

## Alternatives considered

**输入行上方整行横线分隔（概念稿 C 主界面形态）**——否决：用户明确「四周不带框线」，选 B 的只画底边圆角线；上方的消息区/输入区分隔留待真实终端验收后按需补充。

**欢迎页会话列表默认展示 5 个 + 数字键选择（概念稿 C 会话选择器）**——否决（本轮）：用户「一般不进旧会话，展示一个就行了」；数字键路由与恢复交互留待后续 Wave。

**metrics 行无条件并入 footer**——否决：B 规定窄终端（<80 列）纵排两行，保留独立 metrics 行作为窄屏降级。

## Consequences

- 宽终端（≥80 列）下 metrics 不再常驻独立行，token/缓存/模型段进 footer 右侧、随宽度从后丢段——模型层信息（缓存命中率）在极窄时不可见，属 B 布局的既定信息降级。
- `formatRestorableSessions` 新增可选参数，缺省行为不变（存量调用无感）。
- 多行输入（Wave 3）、ghost text 建议、品牌字符画欢迎页、会话数字键选择仍留待下一批（与 C4 决策记录一致）。
