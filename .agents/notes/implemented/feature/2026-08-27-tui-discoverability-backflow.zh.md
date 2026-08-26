# Agent Note: TUI 可发现性回流与原子提交编舞

Status: implemented

[English](2026-08-27-tui-discoverability-backflow.md) | 中文

范围：`packages/tui/tui`（`command-palette.ts`、`commands/registry.ts`、`format/prompt-footer.ts`、`prefs.ts`、`ui/app.ts` 提交路径）

## Problem

五个已上线的 TUI 面落后于兄弟插件 `dsh-tianshu-tui`（同一渲染核心在官方宿主上的分支）。未知命令刷 40+ 命令全表；Ctrl+P 面板平铺无结构；footer 永远只有一条固定提示；输入区信息密度没有用户可控开关；mid-stream 提交同步清掉 live 区却把重绘交给 16ms 写批处理尾沿——每段落/思考块落底后输入轨真实缺席一帧。

## Decision

本批自兄弟仓库提交回流（面板分组 `bdd5ced`、智能建议 `030c672`、密度+编舞 `ed3fdc1`、轮播 `5584aae`、编舞守卫 `c0653f4`），每项独立成提交，含三处刻意分歧。

**原子提交编舞。** `TuiApp.atomicScrollbackWrite` 用 `CSI ?2026h/l` 包住「清 live 区 → 写 scrollback → 同步重绘」。`commitToScrollback`、overlay 退出补写、两条图片 raw-write 路径与推理段提交全部走它；流式与推理提交不再调 `renderBatcher.schedule()`。abort 先丢弃流式残文再提交「⏹ 已取消」——提交现在同步重绘，peek/pending 里的残尾会被画进那一帧。回归守卫对全部 stdout 字节做 CSI 2026 嵌套深度扫描：落底文本与思考块头行必须处于深度 ≥ 1，窗收口前输入轨必须已重绘，终点深度必须归零。

**本地偏好。** 新增 `src/prefs.ts`，把 `footerInfo` 持久化到 `~/.dsh-tui/prefs.json`——刻意与官方宿主插件共用同一文件（同 `~/.dsh-tui/themes` 目录共享约定）。写盘为合并式：只覆盖本包建模的 key，未知 key 原样保留，两边工具不再互相抹掉设置。`VITEST` 默认密封读写，显式注入路径（`TuiAppOptions.prefsPath`）才启用。

**信息密度映射到本仓 C4-B 布局，不是兄弟仓的两行 footer。** 兄弟仓把 metrics 放在第二行 footer；本仓早已把它们上移进输入框顶栏。因此 `/info` 循环 `full`（顶栏身份 + metrics 段 + footer 提示行）/ `compact`（保留 model/effort 身份、禅徽标、API/git 标记，隐 metrics 段）/ `off`（顶栏与 footer 全关——动态区让出两行）。兄弟仓的两行分层 footer 原语未随回流。

**可发现性表是封闭契约。** `PALETTE_COMMAND_GROUPS` 必须覆盖 `BUILTIN_COMMAND_NAMES` 全部条目（守卫测试）；面板按稳定组序（会话/配置/认证/面板/技能/其他）渲染，表外命令归「其他」。`/info` 注册在 `/density` 前——slash 菜单环绕契约测试锚定 `/density` 为末项。`FOOTER_TIPS` 按 3/2/1 权重每 10s 轮播空闲提示；上下文态（审批挂起、agent 忙碌、换行模式）保持固定操作提示。新增内置命令意味着同时补分组行和（为可发现性）tip 行。

未知命令现在以最多三条建议回应（编辑距离 ≤ 2 且 ≤ 输入长一半，公共前缀 ≥ 2 兜底）或引导 `/help`，替代全量命令清单。

刻意不回流：环境驱动的欢迎 Tips（本仓已有自动 key 对话框承担未配置密钥引导）、README i18n 哈希守卫与 `.ts`→`.js` 导入修正（兄弟构建特有）、以及兄弟仓未提交的 onboarding WIP。

## Alternatives considered

### 为什么不原样移植两行分层 footer？

那会针对一个本仓已经改掉的布局重新布线 metrics 的位置；`/info` 的价值是密度开关，不是兄弟仓的页面结构。

### 为什么不像兄弟仓那样整文件覆写偏好？

两个二进制在同一台机器共享一个文件。本侧整文件写入会在用户于任一侧切 `/info` 时静默丢掉官方宿主插件建模的 key（`theme`、`preset`、`notifyOs` 等）。

### 为什么不让密度档位仅会话内生效？

兄弟功能是持久化的；每次启动复位的开关不符合「回流」语义，共享文件的风险已由上述合并写规则回答。

### 为什么不并入既有 chrome-closed-loops 笔记？

该笔记拥有决策诚实性（[p] 落盘、allowed-always、活动带、空闲 ticker）。可发现性、持久化耐久性与提交编舞是维护者可能分别回访的独立契约。

## Consequences

买到：可发现性闭环（分组面板、轮播提示、建议式纠错）、耐久的密度偏好、带机械回归守卫的闪烁根修。

成本：两张强制表随每个内置命令增长；`~/.dsh-tui/prefs.json` 成为跨工具契约，key 集变更必须同时考虑两个消费方；abort 次序成为承重墙（提交即立即重绘），不回访 `handleAbort` 就重新引入延迟重绘会把残迹画进同步窗。

## Verification

聚焦套件：`command-palette.spec.ts`（分组覆盖守卫、分组渲染）、`commands.spec.ts`（`suggestCommands` 阈值）、`app.spec.ts`（建议回显、菜单环绕锚点、`/info` 三档循环含 off 行抑制与落盘）、`prefs.spec.ts`（合并写保留他人 key、VITEST 密封）、`prompt-footer.spec.ts`（加权轮播、上下文提示、宽度守恒）与 `commit-choreography.spec.ts`（三例 CSI 2026 深度扫描）。
