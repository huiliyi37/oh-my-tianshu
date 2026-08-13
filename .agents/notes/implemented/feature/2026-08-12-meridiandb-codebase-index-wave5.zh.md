# Agent Note: MeridianDB 代码库索引移植（Wave 5：dsh-meridian + dsh-tool-meridian）

Status: implemented

[English](2026-08-12-meridiandb-codebase-index-wave5.md) | 中文

## Problem

dsh 没有任何结构级代码库感知：agent 靠 grep/glob 盲找符号与调用关系，读过的文件不积累结构知识。天枢（opencode-tui）的 MeridianDB 用 SQLite（files/symbols/edges/module_summaries + 行为表）存储 tree-sitter 解析出的符号图，供 repo_graph（graph/impact/flow）消费——"编辑前评估爆炸半径、编辑后确认应跑测试"。移植约束：dsh 是纯 ESM 插件架构，better-sqlite3 native 依赖与"零 native 编译链"惯例冲突；天枢生态表（physarum/immune/mistake/p3/sensorimotor/cli_entries）无 dsh 消费者。

## Decision

### S1 包拆分（两包，照 Wave 2 semantic-index 惯例）
- `packages/search/meridian/`（`@deepseek-ai/dsh-meridian`）：核心库，零 cordis 运行时依赖（仅 peer）。db（node:sqlite）/parser（web-tree-sitter）/framework（正则提取）/indexer/graph/impact/behavior/backfill。
- `packages/search/tool-meridian/`（`@deepseek-ai/dsh-tool-meridian`）：repo_graph 工具（graph/impact/flow）+ `<codebase-index>` 摘要注入（动态区 order 120）。

### S2 SQLite 适配（better-sqlite3 → node:sqlite DatabaseSync）
- `db.pragma()`/`db.transaction()` 是 better-sqlite3 独有——pragma 读改走 `prepare('PRAGMA user_version').get()`/`exec('PRAGMA ...')`；事务本地包装 `withTransaction`（BEGIN/COMMIT/ROLLBACK + 异常回滚）。
- `SCHEMA_VERSION = 1`（user_version 校验：0+无对象 → 初始化；0+有对象/非当前 → 拒绝——dsh session 先例同款）。
- 删除天枢 `native-resolver.js` 降级 null-db——engines ^22.19||>=24 保证 node:sqlite 可用，fails loud。

### S3 schema 裁剪（12 表 → 6 表）
保留 files/symbols/edges/module_summaries/access_log/co_edits（后两者是 MeridianBehavior 的 co-edit/access heat 依赖）。裁剪 physarum×2/immune_memory/mistake_entries/p3_state/sensorimotor_log/cli_entries——天枢 agent 生态耦合，dsh 无消费者；`<codebase-index>` 因此只输出统计+Modules 表（无 CLI 部分）。

### S4 行为信号接线（dsh-pheromone）
MeridianBehavior 的 StigmergyStore 参数直接接 `@deepseek-ai/dsh-pheromone`（query() 形状一致 `{path, currentStrength}[]`，零适配层）。**pheromone 接线后置**：StigmergyStore 是纯库（tool-file-info 自实例化），tool-meridian 第一批不实例化（co-edit/access heat 仍工作，pheromone boost 为 0）。

### S5 注入纪律（动态区，非冻结区）
`<codebase-index>` 摘要（≤2000 字符）经 `ctx.systemPrompt.context({ order: 120 })` 注入——与 tool-semantic-search 的 semantic:index 同机制；内容 diff 未变不注入，前缀缓存字节稳定（Wave 4 纪律）。总方案原文"冻结区"被调研反证修正（天枢实际走 volatile 动态区）。

### S6 backfill 门控参数化
天枢 env 门控（RIVET_MERIDIAN_BACKFILL*）→ Config 字段（backfillOnDemand/backfillMaxFiles/backfillOnStart）——"部署变化即 Config"纪律；核心库 backfill 只接受 options.allowed/maxFiles。

### S7 lint 适配（移植代码 × dsh 纪律）
天枢代码 13 处非空断言（no-non-null-assertion）+ 重复分支（sonarjs no-all-duplicated-branches）需改写：正则捕获组 `m[1]!` → `m[1] ?? ''`；`matches[0]!` → guard 局部变量；Python import_from 的 if/else 相同分支 → 单语句。行为等价改写。

## Files

- `packages/search/meridian/`：package.json/tsconfig.json + src/{types,db,parser,framework,indexer,graph,impact,behavior,backfill,invariant,index}.ts + tests/{db,parser,framework,graph,indexer,backfill}.spec.ts（44 用例）
- `packages/search/tool-meridian/`：package.json/tsconfig.json + src/{index,summary,invariant}.ts + tests/tool.spec.ts（6 用例）
- `tsconfig.base.json`：search 组 4 条显式 paths（通配不含 search/）
- `tsconfig.host.json`：meridian + tool-meridian references 登记

## Verification

- 包测试：meridian 44/44 + tool-meridian 6/6（db.spec 建表/needsParse/GLOB 转义、parser 三语言、indexer 增量/复活/边界、graph/impact 排序与反 BFS、backfill 枚举/门控/幂等）
- typecheck：`tsc -b packages/search/meridian packages/search/tool-meridian` exit 0；lint（oxlint staged 48 规则）0 错误
- 冒烟（真实仓库）：test-huiliyi37 自身 backfill 200 文件 17.4s，索引 454 文件/15638 符号；repo_graph graph 查询返回相关文件排名，impact 识别 direct 12/transitive 229/应跑测试（含 meridian 自身 spec）
- 提交：2c954b0（骨架+DB）/ d744dfd（parser+framework）/ f03d623（indexer 家族）/ c5f4253（tool 包）

## Alternatives considered

**better-sqlite3 原生适配（天枢同款）**——拒绝：dsh 惯例零 native 编译链；node:sqlite DatabaseSync 同步 API 形状兼容（prepare/get/run/all），适配成本仅 pragma/transaction 包装。

**repo_map 工具移植**——拒绝（调研反证）：天枢 repo_map 是纯 readdir/stat 文件树（`src/tools/repo-map.ts`），与 MeridianDB 无依赖，不在本 Wave 范围。

**read_file 懒建钩子**——后置：动 tool-fs/read.ts 是跨包改动；on-demand backfill（首次 repo_graph 触发）覆盖首查体验。若冒烟显示体验不可接受，第二批加钩子。

**tree-sitter 语言扩展**——ts/py/go 首批；`tree-sitter-wasms@0.1.13` 实际分发 36 个 wasm（含 rust 等，天枢注释"仅 3 个"过时），扩展门"可得再增"已满足，后续在 parser.ts LANG_WASM/EXT_TO_LANG 注册即可。

## Consequences

- 增量语义：文件内容未变则跨文件边不重算（needsParse false 跳过）——同名符号新增后旧边保持 inferred 直到文件重解析（天枢同行为）。
- 空索引时 graph 模式返回 seed 文件 1.0 分（stats 0）而非错误——天枢同行为，agent 可见"索引：0 个文件"信号。
- pheromone boost 未接线（见 S4）；stale 标记（git head sha 对比）后置；module_summaries 表暂无生产者（codebase-index 的 Modules 部分待后续 backfill 增强或显式回填）。
