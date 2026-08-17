# Agent Note: TUI bundle 挂载天枢侧能力 roster

Status: implemented

[English](2026-08-17-tui-bundle-tianshu-capability-roster.md) | 中文

## Problem

产品范围是纯终端 harness、集成天枢侧能力；web 客户端不在范围内。但发货 TUI profile（dsh-base + dsh-tui bundle patch）只挂载了 `tui-runner`、`spark-anchors`、`vision-bridge`。TUI 已发货的命令面会探测可选服务——`/rewind` 在 `fsSnapshot.histories` 缺席时 fail loud，`/remember` 与 `/memory` 在 `memory` 服务缺席时降级，`/preset` 在 `agentPresets` 缺席时降级（其激活在 [/preset note](2026-08-16-session-list-titles-and-preset-command.md) 中明确推迟到「宿主装配 `dsh-agent-presets` 时」）——而差异化的天枢移植（`dsh-evidence-gate`、`dsh-agent-router`、`dsh-memory`/`dsh-tool-memory` 对、`dsh-tool-session-query`、`dsh-fs-snapshot`、`dsh-agent-presets`）不出现在任何发货组合里：产品里是死命令面，能力永远到不了用户手上。

## Decision

dsh-tui bundle patch（`packages/tui/tui/cordis.patch.yml`）现在在 dsh-base 之上多插入七行：`fs-snapshot`、`memory`、`tool-memory`、`tool-session-query`、`evidence-gate`、`agent-router`、`agent-presets`（`default: standard`，与 web-app bundle 一致）。`package.json` 把每个包声明为 workspace 依赖（patch 中 bare 插件的 resolver manifest 要求），并把 `dsh-agent-presets` 从 devDependencies 移入 dependencies。

每行都以库默认值挂载，逐一读过各插件的配置契约后选定：fs-snapshot 备份落 `$TMPDIR/dsh-fs-snapshot`；memory 存储落 `<cwd>/.dsh/memory/`；tool-memory 的摘要注入默认关（仅静态能力指引；`digest: true` 是调试开关，每次 save 后会重写请求前缀），memory 服务缺席时工具执行 fail loud；tool-session-query 复用 dsh-base 的 `session-query-sqlite` 已提供的 `sessionQuery` 服务；evidence-gate 默认温和（编辑拦截仅命中模型自建的 high bugfix 义务，TDD 门为 `suggest` 模式——只建议不拦截）；agent-router 派发跟随子代理默认路由。shipped 只读预置根由 `composeProfile` 按行 id `agent-presets` 注入、与 profile 无关，tui profile 无需改动应用即获得。

## Alternatives considered

**改挂到 dsh-base。** 否决：base 是 headless 与 web profile 共享的上游对齐主干；范围决策把天枢风味集中在 TUI 产品 bundle，base 保持中立地基。

**连 `dsh-vision-ask` 一起接。** 否决：其视觉模型是无安全默认值的必填配置——给付费视觉端点设默认是部署决策，且配置错误必须 fail loud。它保持 `examples/tui/cordis.yml` 里注释掉的 opt-in 行。

**等 per-user 隔离落地再接 memory。** 否决：工作区级存储是 `dsh-memory` 的文档化现行契约，且 TUI 已发货 `/remember`/`/memory` 命令面在等它。

## Consequences

发货 TUI profile 获得模型可见面——`memory_save`/`memory_search` 工具与静态记忆指引 prompt 段、五件会话查询工具、evidence/TDD 门禁消息——全部走既有的已日志化工具与请求词汇；无新事件类型。`/rewind` 文件回退、`/remember`、`/memory`、`/preset` 在发货产品中点亮而非降级。TUI README 在 Assembly 段记录了 bundle roster，同一改动修正了两条过时的 Known Limitations 条目（图片追问已作为 opt-in `dsh-vision-ask` 移植；turn-summary/summary-state 已由 App 主体驱动，见 docs/projection-layer.md），翻译配对已重录。
