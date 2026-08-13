# Agent Note: 审批 diff 预览（C2 项 1）— 内联 diff 建立盲批信任

Status: implemented

[English](2026-08-11-tui-approval-diff-preview.md) | 中文

## Problem

DSH TUI 的审批提示是裸的「⚠ 允许执行 X？[y/N]」，用户看不到改动内容就批准编辑——这是信任断点。grok-build 的审批 modal 同样不放 diff，因为它只在执行后渲染 diff；而 DSH 的单 agent 场景没有"执行后再看"的余地：那份 diff 出现时，批错的操作已经执行了。

## Decision

反 grok 之道，审批提示在 y/N 行上方渲染内联 diff。

1. **diff 生成**：`diff` npm 包的 `createTwoFilesPatch` 直接生成 unified diff，由既有 `formatDiff`（src/format/diff.ts，Tianshu 移植）渲染染色、gutter 与截断。
2. **数据通路**：`approval/request` 事件携带 `callId`（user-approval `ApprovalRequest.callId`，src/index.ts L167——运行时一直有，TUI 本地类型 `PendingApprovalRequest` 现已声明）→ transcript `view.tools.findLast(t => t.callId)` → `tool.arguments`（原始参数 JSON）→ `formatPermissionDiff`。
3. **参数形状**：`str_replace_editor` 的 `str_replace` 用 `old_str`/`new_str`（验证自 tool-str-replace-editor/src/index.ts L444-446）；`create` 用 `file_text`，产出前 4 行预览，因为新文件没有 old 侧；兼容 `edit_file`（old_string/new_string）与 `write_file`。view/insert、非编辑工具、参数解析失败均产出 null，因此不渲染。
4. **12 行硬限**：审批期间键锁（只 y/N/Esc/Ctrl+C），diff 必须无翻页全可见——`formatDiff({ maxLines: 12 })`。
5. **SOURCE-MAP 范围**：permission-diff.ts 是原创模块（文件头声明 grok 参考源与 formatDiff 复用），非 Tianshu 移植，因此不在 SOURCE-MAP 映射范围内，SOURCE-MAP 中没有它的条目。

## Verification facts

- `tests/permission-diff.spec.ts` 7 用例（str_replace diff 含 @@/-/+、同串 null、create 前 4 行预览、view/insert null、非编辑工具 null、JSON 解析失败 null、大 diff ≤15 行截断）RED→GREEN，7/7。
- `tests/app.spec.ts` 新增集成用例（attach 前注入 tool/call 事件 → transcript replay fold → handler 带 callId → 渲染含 -old/+new 与 y/N 提示），审批 describe 4/4，app.spec.ts 全量 69/69。
- 类型：scratch project 单查 4 文件 0 错误（tsc 报告的 renderBatcher TS2564 为并行会话未提交改动，HEAD 无此字段，非本任务引入）。
- 依赖：`pnpm --filter @deepseek-ai/dsh-tui add diff`（v9.0.0，`diff` 自带 libesm/index.d.ts 类型，无 @types/diff）。

## Files

- `packages/tui/tui/src/format/permission-diff.ts`（新，原创）：formatPermissionDiff
- `packages/tui/tui/src/ui/app.ts`：PendingApprovalRequest.callId + 渲染 diff 块 + import（formatPermissionDiff、CallId from dsh-llm）
- `packages/tui/tui/tests/permission-diff.spec.ts`（新）
- `packages/tui/tui/tests/app.spec.ts`：审批 diff 集成用例
- `packages/tui/tui/package.json`：+diff@^9.0.0
- `docs/dsh-tui-与grok的功能对比-c2.md`：项 1 标记 ✅

## Alternatives considered

**grok 的立场——审批 modal 不放 diff** — 否决。grok 在执行后渲染 diff，这在事后还能复核时够用；但 DSH 的单 agent 流程里，那份 diff 出现时批错的操作已经执行，所以 diff 必须放到 y/N 行上方。

**自己写 `diffLines` 染色** — 否决。C2 草案打算手写 `diffLines` 结果的染色；`createTwoFilesPatch` 加已经承担染色、gutter 与截断的既有 `formatDiff` 以水平复用覆盖了这件事，因此不存在第二套 diff 渲染。

**可翻页的 diff 取代硬限** — 否决。审批期间键锁，需要翻页的 diff 用户根本翻不到；12 行硬限让整段预览留在屏幕内。

## Consequences

- 批准编辑前先看到具体的 old/new 行，代价是 12 行窗口：超出窗口的改动被 formatDiff 的截断标记切断，复核者看到的是改动开头而非全部。
- 只有编辑形状的参数会产出预览（`str_replace_editor` 的 str_replace/create、`edit_file`、`write_file`）；view/insert、非编辑工具与解析失败的参数仍是裸提示。
- `callId` 在 user-approval 的请求上是可选字段，其在全部拦截路径（fs-policy 等）是否都携带未逐一验证；缺失时提示降级为无 diff，不破坏审批流程。
- TUI 包多出一个运行时依赖 `diff@^9.0.0`，这是不手写 LCS diff 的代价。
- 证据止于包内测试：装配后的 `dsh --profile tui` 中真实触发一次编辑审批的内联 diff 未验证。
