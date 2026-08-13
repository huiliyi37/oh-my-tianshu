# @deepseek-ai/dsh-evidence-gate

[English](README.md) | 中文

证据门——bugfix 任务的 RED→GREEN 纪律（天枢 evidence-gate 最小内核移植，增量精简）。

## 机制

- **证据门（L1 编辑门）**：high bugfix 义务尚无 RED 复现时，对目标源文件的首次编辑被拦（返回最短动作 + **精准探针建议**：具体测试文件路径与期望结果）；写测试/scratch 探针豁免；同一义务只拦一次（once latch，重发放行）。
- **RED 三规则**：测试 failed + 目标关联 → 记 `red:` 证据；passed 需先有 RED 才 satisfied（pass-without-red 不是证据）；验证受阻（blocked）≠ 已证。
- **TDD 门**：连续编辑 ≥3 次无验证 → suggest（默认）或 block（`{ tddMode: 'enforce' }`）。
- **L2 final gate**：任务收尾——首次未决 high → `continue_once` + 探针建议；`markContinued` 后 → `honest_blocked` + 未决清单披露。
- **验证归账**：自动从 `session/event` 的 tool/call→tool/result 配对检测测试命令与结果（零测试框架耦合，命令文本启发式）。
- **原生编辑工具适配**：`str_replace_editor`（dsh 原生，`@deepseek-ai/dsh-tool-str-replace-editor`）——写操作 `create/str_replace/insert` 拦截，`view` 读操作放行；兼容天枢风格工具（edit_file/write_file/hash_edit/apply_patch）。

## 装配

```ts
declare const ctx: any
export {}
// cordis.yml 或宿主装配（需 tools 服务与编辑工具；fs 由 base 提供）
plugins: ['@deepseek-ai/dsh-evidence-gate']

// 任务边界（宿主在任务开始处调用）
ctx.evidence.createObligation({
  family: 'bugfix',
  risk: 'high',
  claim: '修复 X 崩溃',
  targets: ['src/foo.ts'],
})
// 新任务开始时作废未决义务
ctx.evidence.supersedeAll()
// final 判定：continue_once（带探针建议）→ 续轮开始时 markContinued
const final = ctx.evidence.evaluateFinal()
if (final.verdict === 'continue_once' && final.nextAction) {
  // 注入续轮动作后：
  ctx.evidence.markContinued(final.nextAction.obligationId)
}
```

真实装配示例：`examples/headless-agent`（fixtures/cli.cordis.yml + driver 任务边界接线 + evidence-gate.e2e.ts 端到端）。

## 服务面

`ctx.evidence`（EvidenceService）：

| 方法 | 语义 |
|---|---|
| `createObligation(input)` | 创建义务（upsert 幂等） |
| `supersedeAll()` | 任务边界：作废未决义务 |
| `unresolvedHigh()` | 未决高风险义务（展示/升级） |
| `evaluateFinal()` | final 判定（continue_once 带探针 / honest_blocked 带披露） |
| `markContinued(id)` | 登记 final 续轮（once latch） |

## 配置

```ts
declare const ctx: any
declare const apply: (ctx: any, config: Record<string, unknown>) => void
export {}
apply(ctx, {
  enabled: true,        // 编辑门开关（默认 true）
  tddMode: 'suggest',   // 'suggest'（默认）| 'enforce'
  tddThreshold: 3,      // TDD 门编辑阈值
})
```

## 模块

- `obligation.ts` — 纯状态机（RED 三规则、upsert、supersede、目标关联）
- `tracker.ts` — 有状态封装（L1 编辑门、once latch、编辑/验证计数、探针建议、final once latch）
- `verification.ts` — 验证检测（命令文本启发式）
- `tdd-gate.ts` — TDD 门纯函数
- `probe-candidates.ts` — 探针候选生成（RED-first、预算/冷却）
- `probe-suggest.ts` — 精准探针建议（已验证命令降级、测试路径生成）
- `index.ts` — Cordis 插件接线（guard 双路径注册 + session/event 归账 + 服务面）
- `invariant.ts` — 运行时不变量 companion（空 install，义务为内存态）

## 验证

```sh
pnpm vitest run packages/guard/evidence-gate/tests/                     # 包级 77 测试
npx vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/evidence-gate.e2e.ts  # 真实装配 4 测试
```

## Model Experience

### Edit-gate rejection (conditional)

#### What the model sees

While every gate passes the guard adds nothing. When an edit tool call is blocked, the call does not execute and the model receives the rejection reason as that call's tool result: the RED-gate message is data-dependent (`tracker.buildRedGateMessage` names the blocked file, the open high-risk bugfix obligation, and a concrete probe suggestion), while enforce-mode TDD blocking returns the stable literal below.

##### TDD enforce-mode rejection

```markdown
Edit blocked by TDD gate: 连续编辑无验证（≥threshold 次）——先写一个失败的测试（RED）再改源码：run_tests 或测试命令应先失败（=RED），再实现通过（=GREEN）。
```

#### Token effect

Zero tokens while the gate passes. Each rejection adds one bounded tool-result message (reason text only); the once-latch releases the same obligation after a single block, so repeated rejections for one obligation do not accumulate.

#### KV Cache effect

Append-only; a rejection arrives as an ordinary tool result after the reusable request prefix and does not invalidate existing entries.

## Known Limitations and Deferred Work

- **验证检测是命令文本启发式** — `detectVerification` 靠命令/输出文本模式识别测试运行；自定义测试入口（未匹配模式的脚本名）不会归账为证据，义务停留在 open。
- **编辑工具白名单是封闭集** — 仅 `str_replace_editor`/`edit_file`/`write_file`/`hash_edit`/`apply_patch` 被拦；经 bash 直接写文件绕过编辑门（与快照层 dsh-fs-snapshot 的同款盲区）。
- **义务是内存态** — 进程重启后义务与证据清零；持久化归账（session 事件重放重建）为延期工作。
- **final gate 依赖宿主接线** — `evaluateFinal`/`markContinued` 需宿主在任务边界调用；未接线时 L2 判定不生效（L1 编辑门仍工作）。
