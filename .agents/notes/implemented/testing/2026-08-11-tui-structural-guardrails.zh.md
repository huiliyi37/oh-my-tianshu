# Agent Note: TUI 结构护栏 — recording ctx、真实组合与棘轮门禁

Status: implemented

[English](2026-08-11-tui-structural-guardrails.md) | 中文

## Problem

TUI 移植线在包测试全绿的情况下落了 74 个提交，一整族缺陷仍随之出厂：投影订阅跨 `newSession()` 泄漏、`userInteraction` provider 重挂载后重注册抛 `DUPLICATE_PROVIDER`、`completedWorkflowRuns` 无界增长。测试拦不住这些，问题在形状而非数量：`app.spec.ts` 的 mock ctx 的 `on()` 只记监听器、把 disposer 扔掉，释放平衡根本无从断言；没有任何测试经 Loader 在真实 Cordis context 上引导插件，生命周期接线从未按组合态演练过；宽度/字形 spec 读宿主 locale，结果换台机器就变。与此同时，三个包公民度门禁（`verify-package-invariants`、README 的 Model Experience/Limitations）与 `verify-config-catalog` 一直红着，`SOURCE-MAP.md` 还按文件声明着无从核验的 `identical` 状态——上游快照并不在仓内。

## Decision

护栏按「每类缺陷在哪一层可见就在哪一层拦」落位，不动 `app.ts` 结构（归 C4 拆分线所有）：

- **Recording ctx** — `app.spec.ts` 的 `makeCtx` 记录每次 `ctx.on()` 订阅及其 disposer，`afterEach` 在测试驱动 app 走完整 dispose 时断言订阅/释放平衡。落地当场暴露一个真实产品缺陷：`TuiApp.newSession()` 挂载新会话前不调 `detachProjections()`，每次切换孤儿化 11 个监听器；修复与 `switchSession` 的对称卸载看齐。
- **真实组合测试** — `tests/loader-composition.spec.ts` 经 Loader 进程内引导 test-only `cordis.yml`（真实 Cordis context、真实插件树、`llm-replay` stub 掉 LLM，唯一的假件是 fake TTY 流），断言行为而非内省：raw-mode 对称恢复、live 渲染响应 `workflow/start`、只 dispose TUI fiber 后再发 `data`/`workflow/start`/`subagent/start` 事件零写入。
- **环境基线** — `tests/env-baseline.ts` 在每个 env 敏感 spec 前后固定 `LANG`/`LC_*`/`RIVET_*` 并重置宽度/终端能力缓存，取代逐 spec 手工 save/restore。
- **源码行数棘轮** — `scripts/verify-source-budgets.ts` + `source-budgets.manifest.json` 给点名巨石文件按当前行数设 ceiling（接入 `run-gates`）；增长必须改清单文件、review 可见，拆分落地后手动收紧。
- **溯源可核验化** — `SOURCE-MAP.md` 把 `src` 全部文件重分类进封闭枚举（`ported`/`modified`/`new`），不再主张字节同一性；`tests/source-map.spec.ts` 护覆盖与枚举合法性；`NOTICE` 把 Apache §4(b) 修改清单委托给映射表；`projection-layer.md` 改述 fold 模型的真实接线现状（尚无接线），替换掉「八模块已设计」的叙事。
- **工作流历史上限** — `completedWorkflowRuns` 超过 `TuiRunnerConfig.workflowHistoryLimit`（校验正整数，缺省 50，`apply()` 处 fails loud）即 drop-oldest 淘汰，赶在 C4 Wave 1 前落地，字段随拆分迁移。
- **公民度** — tui/fs-snapshot/agent-router/evidence-gate 补齐标准 README 段落与 invariant 伴生件；config catalog 重新生成并收录其条目。
- **线格式漂移发现即修** — 为 Cordis catalog 补 TUI 本地事件重声明的文档时，暴露 `workflow/phase` 被按 `(info, { title })` 声明并处理，而属主 `dsh-workflow` 实际派发 `(info, title: string)`：真实 workflow 下 phase 标题永远渲染不出来，只因测试按错误形状发事件才保持全绿——mock 遮蔽论点的第二次实证。声明、处理器与测试发射现已与属主对齐，重声明块带上完整事件 JSDoc，catalog 门禁每次重新生成都会将其与属主对照。

## Alternatives considered

**逐个修 disposer 缺陷然后收工。** 否决：缺陷本身已在先前提交修掉；让它们出厂的是测试形状。不改 mock 对 disposer 的失明、不加组合态生命周期测试线，下一次移植会原样再进口同一种失明。

**全真 TTY e2e（node-pty 子进程）而非进程内 Loader 引导。** 否决：更慢、平台敏感且不必要——已观测缺陷族的每一项（监听器泄漏、provider 重注册、dispose 后渲染）在真实 Cordis context + fake 流下都可复现；终端字节协议本身已有 engine 单测覆盖。

**用 lint 规则行数上限（`max-lines`）替代清单棘轮。** 否决：本仓用 oxlint，没有按文件点名 ceiling 的棘轮语义；JSON 清单让每次提升 ceiling 都是可评审的 diff，且各文件 ceiling 可不同、不用扭曲规则。

**SOURCE-MAP 做字节同一性核验。** 以不诚实为由否决：上游快照不在仓内，`identical` 声明在构造上就无从核验。封闭枚举加覆盖 spec 只护可核验之物（每个文件有映射、状态合法、无幽灵条目），不多护一分。

## Consequences

买到的：disposer 族现在在两个独立层面大声失败（单测 `afterEach` 平衡 + 组合态 dispose 静默）、巨石增长 review 可见、溯源与投影文档如实描述现状、无界 Map 这类问题有了带配置的上限。代价：今后 `app.spec.ts` 里每个走完整 dispose 的测试都继承平衡断言（泄漏的测试即使自身断言通过也会失败）；组合测试线给 tui 套件加了几秒；source-budget ceiling 需要在 C4 拆分落地后手动收紧（有意为之——自动收紧会在在途工作上翻红）；config catalog 现在含 tui/guard 条目，重生成时双语对侧必须同步。

## Related

C4 拆分方案（`docs/dsh-tui-拆分方案-c4.md`）拥有 `app.ts` 分解、interaction/taskDone/taskSurface 的 dispose 补全与挂起审批跨会话结算；本笔记刻意不认领其中任何一项。组合测试线是 `vitest.config.ts` 中 `TODO(tui)` 覆盖率豁免清单的既定消化路径。
