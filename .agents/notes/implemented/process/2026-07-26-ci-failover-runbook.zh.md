# Agent Note: CI 故障切换手册 — 托管池 → 自有池

Status: implemented

[English](2026-07-26-ci-failover-runbook.md) | 中文

## 问题

[CI](../../../../.github/workflows/ci.yml) 中三个必需的 Linux 工作作业（`node 24 / static`、`node 24 / coverage`、`node 24 / snapshots and artifacts`）运行在托管的企业级 32 核池上；聚合它们的必需判定作业（`all checks passed`）运行在标准 `ubuntu-latest` 上。当企业池发生故障——作业无限排队或企业标签消失——所有开启的拉取请求都无法合并，而"合并一个修复"这一常规恢复手段本身正被那些无法运行的必需检查死锁。**适用范围：本切换恢复的是企业级 Linux 池故障。**判定作业的其余必需依赖（`node-compat`、`python-sdk`、`windows`）按设计留在标准托管运行器上（可移植边界）；若更大范围的 GitHub 托管容量故障连标准池一并击倒，这些依赖仍会阻塞 `all checks passed`，且只有 Windows 这条腿完全没有自有替代——2026-07-27 的故障中标准池率先恢复，本设计押注的正是这一顺序。因此故障需要一个任何具备仓库写权限的响应者都能在不合并任何代码的情况下触发的开关。

## 决策

三个必需的 Linux 工作作业——以及 `all checks passed` 判定作业（若不随切换，即使全部工作作业通过，它仍会滞留在故障池的队列中）——各自通过仓库变量 `DSH_CI_FAILOVER` 解析运行器池。变量不存在（正常）时它们运行在托管企业池上；由任何具备写权限的协作者设为 `selfhosted` 时，四者全部切换到公司自有的自托管 `vm-backup` 池，覆盖率与快照的并发降到共享虚拟机上限，并跳过托管路径的 pnpm 缓存恢复。这个开关是写者可管理的仓库状态而非一次合并，因此在所有检查都是红色时仍然有效。自有池的就绪状态由 `serial / linux (self-hosted standby)` 通道持续验证——每次 master 推送都在其上运行完整的未分片聚合流程。

### 自有池是什么

`vm-backup`：一台 64 核虚拟机，6 个常驻 systemd 管理的运行器实例。其镜像必须预装 Playwright Chromium 的 Linux 系统软件包；CI 会下载锁文件选定的浏览器，但绝不在这台持久化共享主机上运行 `apt`。切换前先看 `serial / linux (self-hosted standby)` 最近一次运行：其聚合流程包含浏览器回放，因此绿色热备同时验证常规容量和这项浏览器先决条件。

### 切换步骤（任何具备写权限的协作者，约 1 分钟，无需合并）

1. 仓库 **Settings → Secrets and variables → Actions → Variables → New repository variable**：名称 `DSH_CI_FAILOVER`，值 `selfhosted`。
2. 重新触发必需作业，使其重新解析运行器池。已经为托管标签**排队**的作业不会重定向，也无法原地 re-run，因此对于本手册所述的无限排队故障，应取消卡住的运行并 re-run all jobs，或推送一个新提交；“Re-run failed jobs”只有在作业真正失败（而非仍在排队）时才有用。
3. 切换到此完成。故障切换状态下工作流还会自动：把 `DSH_COVERAGE_MAX_WORKERS` 降为 8、`DSH_SNAPSHOT_MAX_CONCURRENCY` 降为 12（按 6 个常驻实例定容：最坏情况下，6 × 8 = 48 个覆盖率工作进程运行在 64 核虚拟机上）（共享虚拟机的争抢上限），并跳过托管路径的 pnpm 缓存恢复（虚拟机的持久 store 直接提供热安装）。

#**Dependabot 例外。**四个选择器都刻意排除了 `dependabot[bot]`：故障切换期间，Dependabot 拉取请求继续在托管池排队，而不是把依赖项提供的代码放到持久化虚拟机上执行。故障期间 Dependabot PR 持续排队是预期行为而非切换失败；托管池恢复后它会自行完成。

**谁能扳动这个变量。**GitHub 的 API 允许任何具有写权限的协作者管理仓库变量，因此该开关实际是写者级而非严格的管理员级。在本仓库的信任模型下这并不构成升权：runner group 接纳本私有、禁 fork 仓库的全部工作流（这是让 PR 引用的故障切换得以成立的刻意取舍），因此任何写者本就可以通过推送分支工作流触达这台虚拟机。抵御不可信代码的边界是仓库成员资格；变量只是为成员路由工作。

## 切换期间的容量

6 个常驻实例可承接正常 PR 流量（该池平时唯一的稳态负载是每次 master 推送一个串行热备作业，故障切换时几乎全池可用）。若仍出现排队，用组织级注册 token（组织 Settings → Actions → Runners → New runner）追加注册实例。复制现有 runner 目录时**必须排除身份文件**——`rsync -a --exclude '.runner*' --exclude '.credentials*' --exclude '_diag' --exclude '_work' <src>/ <dst>/`（通配同时排除 `.runner_migrated`/`.credentials_migrated`——GitHub 会在迁移过的运行器上写入这些文件，它们同样会触发 already-configured 拒绝）——再跑 `config.sh`（原样拷贝 `.runner`/`.credentials` 会使其以 "already configured" 拒绝），然后**启动监听器**：`sudo ./svc.sh install ubuntu && sudo ./svc.sh start`。仅注册不会上线；只有启动了服务的 runner 才会增加容量。每个约一分钟。


### 切回

删除 `DSH_CI_FAILOVER` 变量（或改为 `selfhosted` 以外的任何值），新的运行即解析回托管企业池。若故障期间追加注册过实例，将其移除。

### 信任边界

该变量是写者可管理的仓库状态；`pull_request` 事件本身既不能设置它，也不能让不同的值生效，选择器表达式存在于工作流定义中。需要注意：故障切换期间，`pull_request` 运行执行的是 PR merge 引用自带的工作流定义——抵御不可信代码的边界是仓库成员资格（私有、禁 fork、选择器排除 Dependabot），而非该变量。关于 runner group 策略的说明：把 runner group 绑定到 master 引用的工作流与本故障切换机制**不兼容**——四个故障切换作业是从 PR merge 引用求值的 `pull_request` 运行，master 绑定的组会让它们持续排队（2026-07-27 实际故障中亲历；当时将组放宽为本仓库全部工作流才疏通了切换）。更严格的运行器侧策略以牺牲 PR 故障切换为代价；当前采用的形态是仓库范围、全工作流的组访问。

## 曾考虑的替代方案

**通过合并一次工作流改动来切换池。** 否决，因为触发切换的故障状态恰恰是任何 PR 都无法合并的状态：必需检查正是失败的那些。仓库变量是写者可管理的状态，重跑即生效，无需合并。

**让自托管池长期处于必需路径中。** 否决，因为这是拿托管池的可用性去换自有虚拟机的可用性，只是搬移了单点故障而非增加回退。该变量让托管池保持主路径，自托管池作为一个经过验证、一步即可启用的热备。

## 后果

从托管池故障中恢复只需一个变量（任何写者可设）加一次重跑，关键路径上没有合并。代价是要维护第二套运行器拓扑：热备通道在每次 master 推送时都运行它，避免故障切换目标变得陈旧；而 `ci.yml` 中的并发与缓存恢复分支带有一条 `selfhosted` 支路，必须与托管支路保持同步。
