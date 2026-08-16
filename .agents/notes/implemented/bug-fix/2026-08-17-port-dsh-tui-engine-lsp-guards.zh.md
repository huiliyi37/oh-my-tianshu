# Agent Note: 移植 dsh-tui 引擎、LSP Windows、windowsHide 守护与 flaky 测试修复

Status: implemented

[English](2026-08-17-port-dsh-tui-engine-lsp-guards.md) | 中文

## Problem

兄弟仓库 `dsh-tui`（`/Users/banxia/app/deepseek-tui/dsh-tui`，官方 dsh 的 TUI 插件）在本仓库上一轮移植（`a112c85e`）之后落了五个修复向提交。因两边共享的 TUI 源码近乎一致，其用户可见缺陷在这里全部成立：多行 ↑↓ 导航的列号按 code-unit 计算，跨行移动时光标落在代理对/ZWJ emoji 簇中间（光标错乱、插入拆碎 emoji）；resize 链让 `sips` 按 out 路径扩展名猜输出格式；Windows 上 npx/npm 装的 `.cmd` langserver 直接 spawn 抛 EINVAL，且 server 在 initialize 应答前死掉会让 `ensure()` 永久挂起（rpc.request 无超时）；十余处短命子进程调用缺 `windowsHide: true`，Windows 上闪 conhost 窗口；两例负载敏感 flaky（流利度 stale 用假定时器同步推进 200s 跑约 1700 次全量渲染、两例 onPaste 固定睡 40/60ms）在全量并发下失败。

## Decision

按语义把修复子集移植进 `packages/tui/tui`（源提交 `ba45980`、`e33052c` 的 LSP 部分、`9eef2f5` 的 windowsHide 子集、`86cea46`），跳过仅属兄弟仓库基建的部分（其 CI 矩阵、lib bundle 新鲜度门禁、dev 入口脚本、RSS 预算、行数棘轮、自更新缓存——本仓库有自己的门禁体系且无自更新）与 `c74c0a8` 偏好持久化（feature 非修复，本轮只移植修复）。

引擎（`ba45980`）：`getLineCol`/`posFromLineCol` 经既有 `graphemeBoundaries` 把列号改为 grapheme 计（+4 回归测试）；`OverlayRenderer` 增可选 `caret` 钩子——caret 写移出空 diff 短路、DECSCUSR 稳态竖条抑制输入类 overlay 期间的原生闪烁、退出恢复用户默认光标形状（+4 测试）；`ClipboardReader` 增可选 `readText`，文本回退路径测试密封不再真调 pbpaste（+3 测试）；`resizeCandidates` 显式 `-s format png`，与 `toPngCandidates` 链对齐（集成断言）。

LSP（`e33052c`）：`defaultLspSpawn` 在 win32 经 `ComSpec`（`cmd.exe /d /c`）以 argv 数组派发，`shell` 保持 false（DEP0190），并加 `windowsHide`；`manager.initialize` 让 initialize 请求与进程早夭 promise（`error`/`close` reject）竞速——server 早死时 initialize 落入 catch 置 `ready=false`，不再永久挂起 `ensure()`；新增 `tests/lsp-multi-manager.spec.ts`（7 测）。

windowsHide 清扫（`9eef2f5` 子集）：`packages/tui/tui/src` 全部 `child_process` 调用点带上 `windowsHide: true`（app.ts git×3、剪贴板×5、image-tool、external-editor×2、server-registry where/which；restart/statusline/file-completer 原本已有）。新增 `tests/architecture-guards.spec.ts` 把不变量落成红绿测试并含自检块（植入违规必须被抓到）：src 禁 `process.stdout.write`（单写层经注入 WriteStream；stderr 诊断放行）、全部子进程调用带 `windowsHide`（扫描器正则含 `execSync`，比兄弟仓库更全）、`format/`/`render/` 禁 IO import。兄弟仓库的行数棘轮未移植——其基线是那边 C4 拆分的历史，不是本仓库的。

flaky 测试（`86cea46`）：流利度 stale 改 `setSystemTime(+200s)` 时间跳跃 + `advanceTimersByTimeAsync` 推进 1s（stale 判定只看渲染时刻的 `Date.now() - lastEventAt`，与 ticker 轮数无关）；两例 onPaste 附图测试的固定睡眠换 `vi.waitFor` 条件轮询。

## Alternatives considered

**Cherry-pick 兄弟提交。** 否决——两仓无共同 merge base，diff 在改名/重构后的树上整体冲突，且多数提交混合可移植修复与兄弟仓库专属基建。

**同轮移植 `c74c0a8`（偏好持久化）。** 暂缓——那是 feature（prefs 文件层、主题/面板持久化、输入历史文件、三件提取）而非修复；移植它需要配合本仓库的 bundle 配置接线，值得独立一轮。

**只清扫调用点、不移植守护测试。** 否决——仓库惯例要求把可机械检查的不变量接进会执行的门禁；没有守护，下一个 spawn 调用点会静默回退。

## Consequences

多行编辑不再拆碎 emoji；输入类 overlay 可呈现格子边界精确的硬件光标且不继承终端原生闪烁（当前尚无 overlay 使用 caret 钩子——能力随引擎契约先行落地）；剪贴板文本测试不再依赖宿主剪贴板内容；PNG resize 不再依赖输出路径扩展名；Windows 用户获得可用的 LSP 启动且不再闪 conhost 窗口；TUI 测试套件在全量并发下稳定。`SOURCE-MAP.md` 更新七行来源条目。受影响套件全过（input-line/overlay/clipboard/image-attach 52、LSP 43、guards 6、app.spec 流利度/onPaste 组），改动文件 oxlint 零告警。
