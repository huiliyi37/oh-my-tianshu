# Agent Note: 上游 alpha.1 回流第一浪——提示词顺序表与 JSONL provenance 区间

Status: implemented

[English](2026-08-28-upstream-alpha-backflow-wave1.md) | 中文

Scope: `packages/core/system-prompt`、`packages/core/session`、`packages/session/session-persistence-jsonl`，及全部一手提示词 section 注册点

## 问题

上游 `deepseek-ai/deepseek-harness` 发布了 `dsh-v0.1.2-alpha.1`——距本仓上次抓取点 `dsh-v0.1.1-rc.2` 共 1,079 个提交。第一波小步回流选定三个共同包热点：system-prompt 稀疏顺序表、持久化存储体量缩减（#3048）、subagent 模型路由弧。本 Note 记录已落地项，以及第三项为何没有落地。

## 决策

**稀疏一手 section 顺序表（上游 `43ac97b554`）。** `FIRST_PARTY_SECTION_ORDER` 把全部仓库自有 section 落位集中到一张相邻值差 ≥10 的稀疏表：新增一手 section 不再重排邻序。组装排序对同 order 按名字 code-unit 序决胜——此前 JS 稳定排序把同值顺序交给注册序，跨组合不确定；`tool:git`/`tool:read`、`tool:bash`/`tool:pwsh`、`tool:tasks`/`tool:pty` 三对同值站点的渲染顺序因此依赖组合方式。现表给三对显式独立落位，其余唯一值的相对顺序不变。28 个一手注册点全部改引表值；`PERSONA_ORDER` 别名 `DEPLOYMENT_PERSONA`；output-style 导出常量转发表值。外部插件仍可用任意有限 order。spec 钉住表不变量（有限整数、唯一、相邻差 ≥10），设计约束由机械校验而非评审守护。

**JSONL provenance 区间编码（上游 `df76bc695b` 仅 JSONL 侧）。** `core/session` 新增 `seq-ranges.ts`：严格递增的 `sourceEventSeqs` 把 ≥3 的连续段折叠为闭区间 `[start, end]`，其余原样。JSONL 写路径序列化前折叠，扫描器读回时展开并校验良构（区间严格递增、展开长度不超事件自身 seq）。旧日志的裸数组读取不变——读写双向向后兼容，下游无感。上游 501 会话语料实测存储 −14.1%，无可测延迟回归。

**#3048 的 SQLite 侧刻意未移植。** Schema 19（zstd 词典、64KiB 页、带标 delta/run 编码）叠在 schema 15–18 压缩线上；本仓 `session-persistence-sqlite` 停在 schema 14 且无压缩层。采纳 SQLite 半边意味着跨五个 schema 版本的物理格式迁移，且词典需按本仓事件形态重训——这是独立决策项，不是回流步骤。

**刻意延后：subagent 模型路由弧。** `user-authorized subagent model routes`（上游 `aefc083be7` 及同弧提交）深达两层 note 叠加：它以 model-selected subagent routes 底层为前提（delegation 调用的路由参数、adapter 预检、`list_subagent_models` 发现工具、fork 缓存限制），再加 Host 设置段、组装期策略事件（子会话继承 + 恢复重放）、执行器级授权强制、生成的 persistence-catalog 基建，以及经本仓并未运行的 remotes 提供的 Web 设置卡片。本仓只有配置态 `agentOptions.provider/model` 路由，无发现工具、无路由选择面。只移植授权半边会留下半座能力接缝（Service Definition / Provider / Consumer 角色被劈成两半）；它需要先移植底层的专属浪，并先决策本仓由哪个设置/UI 面承载 allowlist。

**同样延后：fail-closed 会话事件词汇**（上游 `42dc2a46c2`）。本仓 `core/session` 既没有生成的 `known-event-types.ts`，也没有 `ignorable` 信封标记，更没有喂养它们的 persistence-catalog 生成器；该守卫随生成器与其 doc-sync 门一起到位。

## 已考虑的替代方案

### 为什么重排顺序表而不是原值照搬？

保留 `100–116` 间距 1 保住字节布局，却复刻了这张表要解决的问题：下一个工具 section 就得重排。唯一的行为差异是三对重复值——它们此前的顺序本就依赖注册序，没有稳定行为可保。

### 为什么不先移植压缩栈再整搬 #3048？

压缩栈是五个 schema 版本的物理格式演化，每版对盘上库 fail-loud（`user_version` 不符即拒开）。移植它是带数据兼容后果的格式迁移，外加词典重训问题——是一个项目，不是一步。

### 为什么不只移植模型路由弧的执行器强制？

没有设置段、策略事件与发现工具的强制只会拒绝、不能授权或列举：Consumer 角色孤立存在而无 Provider。本仓「边界显式」的规则同样适用于移植。

## 后果

买到：section 落位可评审、插入廉价的顺序表；跨组合确定性的 section 顺序；14% 的 JSONL 存储缩减与完整读兼容。欠账：模型路由浪（先移植底层）、sqlite 压缩决策、fail-closed 词汇决策——三者的依赖清单均已写明，无需再被重新发现。
