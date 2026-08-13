# `@deepseek-ai/dsh-telemetry`

[English](README.md) | 中文

用于 dsh-sdk 工具链的启动器侧 telemetry 原语。这是启动器在执行每个命令时导入的普通库；它**不是** Cordis 插件，因为 `build` 与首次初始化的 `create` 从不启动 Cordis。将 reporter 接入启动器命令分发，并把 telemetry consent 功能加入 `dsh-helper` 目录，属于各自所属包的职责，而不是此包的职责。

| 导出 | 职责 |
|---|---|
| `SecretRedactor` | 保守的安全后备：在已解析值（`redactValue`）与原始文本（`redactText`）中，将形似密钥的值（疑似密钥的键名、已知 token 格式、PEM 块、URL 凭据、高熵不透明 token）替换为占位符。绝不删除字段或行。 |
| `ConsentResolver` | 解析项目 `cordis.yml`（绝不启动），读取 telemetry 配置项的启用／禁用状态作为 consent；`DO_NOT_TRACK`／CI 环境会强制完全停止上报。 |
| `buildTelemetryPayload` | 组装 `{command, durationMs, success, cordisYmlContent, packageJsonContent}`，对完整的 `cordis.yml` 与 `package.json` 文本运行 redactor。绝不读取 `.env`；发送 `package.json` 的前提是同时存在 `cordis.yml`，因此在非 SDK 目录运行的命令不会上传该目录中无关的 manifest（元数据清单）。 |
| `getOrCreateAnonymousId` | 将随机 UUID 持久化到 [`@deepseek-ai/dsh-paths`](../../util/paths/README.md) 解析出的 harness home（`$DSH_HOME` > `~/.dsh`）；其范围限定为该 home，而不是整台机器，且绝不从 git 派生。 |
| `TelemetryReporter` | 即发即弃发送：`report()` 绝不阻塞或抛出；无论经过哪条路径，发送操作最终都会结束；`flush()` 可以在上限内排空进行中的发送。 |

Consent 由 `cordis.yml` 中的 telemetry 配置项承载，因此禁用 telemetry 就是禁用该配置项。telemetry 默认上报，只有已经存在的 telemetry 配置项被显式设为 `disabled` 时才关闭：缺少 `cordis.yml`（首次 `create`）、配置项已启用，或 `cordis.yml` 中没有 telemetry 配置项时都会上报。`DO_NOT_TRACK`／CI 始终拒绝。无配置与缺少配置项的默认值可以通过 `ConsentResolver` 配置。

收集端点是固定常量（`DSH_TELEMETRY_ENDPOINT`）；发布前必须将作为安全兜底的 `.invalid` 占位值替换为真实端点。

## 模型体验

无。reporter 从启动器发送开发周期 telemetry，绝不会进入模型请求。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **占位端点**：`DSH_TELEMETRY_ENDPOINT` 指向 `.invalid`，直到设置真实端点。
- **脱敏依赖启发式规则**：这只是保守后备，不是保证；密钥应存放于 `.env`，而该文件绝不会被读取或上报。
