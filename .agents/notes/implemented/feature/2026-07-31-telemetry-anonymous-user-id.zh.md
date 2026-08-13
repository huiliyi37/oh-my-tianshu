# Agent Note: telemetry 匿名用户 id（$DSH_HOME/.userid）与 OTel Resource user.id

Status: implemented

[English](2026-07-31-telemetry-anonymous-user-id.md) | 中文

## Problem

session telemetry 已默认挂载（[默认挂载 Note](2026-07-31-web-telemetry-default-mount.md)），但 OTel Resource 只有 `service.name`/`service.version`，没有任何用户级标识——接收端无法按用户聚合、无法数活跃用户。此前唯一相关口径是一条未实现的「hostname/本机 IP 哈希派生 user.id」裁定；dsh-sdk 工具链另有自用的匿名 id（`$DSH_HOME/telemetry.json`），但那是 launcher 回流的私有事实，与 OTel 回流无关。需要给 OTel 回流一个语义干净的匿名用户身份。

## Decision

`session-telemetry-otel` 包内模块 `src/user-id.ts` 是 OTel 回流用户身份的属主：`getOrCreateAnonymousUserId()` 返回 `$DSH_HOME/.userid`（`resolveDshHome` 解析，`$DSH_HOME` > `~/.dsh`）中的裸 UUID 行，首用生成随机 UUID v4 并落盘；backend 构造时把它作为 Resource 的 `user.id`（OTel semconv 标准用户属性）随每批导出携带一次。该身份只属于 OTel 回流；dsh-sdk launcher telemetry 保留自己的匿名 id 存储（`telemetry.json`），两者不共享（初版曾做公用 util 包统一两条回流，用户复议后收回：在有第二个真实消费者之前不抽公共包，回流关联需求出现时再议）。

| 裁定 | 取值 | 理由 |
|---|---|---|
| id 来源 | 随机 UUID v4，绝不从 hostname/网络地址/git remote 派生 | 派生 id 可反查，「匿名」名不副实 |
| 存储形态 | `.userid` 裸 UUID 行 + 换行，无 JSON 包装 | 身份是独立事实，不挂在某条 telemetry 链路的文件命名/格式下 |
| 读写形态 | 同步 IO + 进程内按解析后文件路径 memo | `TelemetryOtel` 构造函数是同步的（async 迫使插件装载改形）；一进程一次盘 IO，运行中删文件不影响本进程 |
| 并发首启 | `wx` 独占写裁决，落败方重读胜者 id | 覆盖常见并发（重读撞进胜者建档-写入微秒窗仍可能各持一 id 一次运行，下次启动收敛到落盘值——telemetry 级后果，接受） |
| 丢失语义 | 文件被删 → 下次启动换新 id，接受丢失 | 匿名身份无恢复价值；可恢复性要求派生材料，与匿名冲突 |
| 写失败 | best-effort 返回内存 id | telemetry 永不因 home 只读被阻塞 |
| 上报位置 | Resource 属性，非逐条 attributes | 每批一次即够接收端按 Resource 维度聚合；逐条注入要动 seam 约定且涨 wire 体积 |
| semconv 依赖 | 不引 `@opentelemetry/semantic-conventions` 包 | 一个字符串常量不值一个依赖 |
| 落点 | `session-telemetry-otel` 包内模块，非公共 util 包 | 仓规「有第二个真实消费者才拆包」；sdk launcher 回流保留自有存储，无现实关联需求 |
| 单独开关 | 无 | 身份跟随 telemetry 整体开关（`DSH_TELEMETRY_DISABLED`）；关 telemetry 即整体不报 |

## Alternatives considered

| 被拒 | 一句话理由 |
|---|---|
| hostname/IP 哈希派生 id（此前口径） | 可反查即非匿名；随机 UUID 语义干净，用户裁决取代 |
| user.id 放每条 record 的 attributes（Claude Code 形态） | 要动 session-telemetry seam 约定或逐条注入，wire 体积涨；Resource 每批一次已满足聚合 |
| 公用 util 包统一两条回流（初版实现） | 唯一现实消费者是 OTel backend；sdk launcher 换用它只是为统一而统一——用户复议收回，回流关联需求出现时再抽包 |
| 复用 telemetry.json 不新建文件 | 文件名/JSON 格式把身份挂在 launcher 链路命名下；OTel 回流身份是独立事实 |
| AppCLIEntry 读好 id 经 config patch 注入 | 每个 surface 入口都要接线；config 里传运行时事实与部署配置混淆 |
| 挂进 `@deepseek-ai/dsh-paths` | paths 是纯路径计算零 IO；带持久化的身份能力会污染包边界 |

## Consequences

- 一个 `$DSH_HOME` 在 OTel 回流中是一个稳定用户；不同 home 在构造上就是不同用户，无跨 home 关联机制。
- OTel 回流与 launcher 回流各有各的 id（`.userid` 与 `telemetry.json`），无法互相关联——这是「不抽公共包」的直接代价，等真实关联需求出现再统一。
- 删除 `.userid` 即重置身份（下次启动生效）；home 不可写时每进程各自持有一个内存 id 直至恢复可写。
- [默认挂载 Note](2026-07-31-web-telemetry-default-mount.md) 的身份 follow-up 中「匿名用户 id」项由本决定关闭；hostname/surface 维度与脱敏规则、usage-metrics track 仍是待办。
