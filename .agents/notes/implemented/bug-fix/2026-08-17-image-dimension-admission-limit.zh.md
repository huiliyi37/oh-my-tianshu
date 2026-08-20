# Agent Note: 图片单边尺寸准入上限

Status: implemented

[English](2026-08-17-image-dimension-admission-limit.md) | 中文

## Problem

附件 seam 此前只按字节数与解码总像素接纳图片，准入链路中不存在任何单边上限。已部署的模型路由在请求携带多张图片且其中任何一张单边超过 2000px 时会以 HTTP 400 拒绝整个请求。已接纳的图片会随该会话之后的每次请求发送，因此一次超限提交就毒化了持久历史：下一次模型请求失败，之后的每次重试同样失败，会话被永久杀死。本 fork 尚未有任何生产者经 `ctx.attachments` 接线——TUI 以内联 data-url 块发送图片——因此该缺口在生产者接入之前先在 seam 侧闭合。

## Decision

`ImageAttachmentLimits` 增加 `maxImageDimension`，在准入完整解码（`detectImage`）中以 `IMAGE_DIMENSION_TOO_LARGE` 强制执行，因此所有经附件服务提交的来源都会在任何内容进入持久历史之前拒绝超限图片。`LocalAttachmentStore` 将其暴露为 `maxImageDimension` 配置项，默认值 `DEFAULT_MAX_IMAGE_DIMENSION = 2000`，即已部署路由强制执行的最严格单边上限；路由更宽松的部署可在 cordis.yml 中调高。准入失败以按 `code` 路由的 `AttachmentError` 送达提交方调用者；各生产者如何呈现该错误仍由生产者自持。

同一移植将 `DEFAULT_MAX_IMAGE_BYTES` 对齐到提供方安全的载荷默认值，5MB → 3.5MB，使单张已接纳图片落在已部署路由所接受的单请求载荷预算之内。

本次移植语义对应上游 deepseek-harness 提交 `0e39055121`、`d559ba9b2b`，以及 `5849c57c0c` 的 attachment-local 半部分。上游的生产者侧改动在本地没有对应物，刻意不移植：`read_image` 工具的模型向错误映射与快照场景（本地 tool-fs 无 read-image）、Web 输入框文案、llm-pi-ai 的图片载荷处理。

## Alternatives considered

- **准入时缩图而非拒绝。** 重采样会让存储字节偏离调用方提供的内容，引入重采样质量策略，还会对调用方隐藏上限。拒绝让准入保持为纯粹的门禁；调用方可以在知情的前提下自行缩图。只有当拒绝在实践中频繁出现时才值得重新考虑。
- **在 provider 适配器按路由强制执行。** 为时已晚：组装请求时图片已是持久历史，每条路由、每次重试都会再次失败。准入是把必然被上游拒绝的图片挡在外面的最后一道关口。
- **修复已被毒化的会话**（在之后的请求中丢弃或替换超限图片块）。不在本次范围内；准入阻止新的毒化，而重写历史需要针对「模型可见 ⟺ 已记录」不变量单独设计。

## Related

- [上游子系统移植对齐](../feature/2026-08-16-upstream-subsystem-port-parity.md)，引入附件 seam 与本地后端的那次移植，本次单边上限补全了它。

## Consequences

- 超限图片无法再经附件服务进入持久历史；提交方调用者得到稳定、可自行纠正的 `IMAGE_DIMENSION_TOO_LARGE` 错误码。
- 单边超过 2000px 的图片即使在其路由本可接受（小请求）的组合中也会被拒绝；这类部署必须显式调高 `maxImageDimension`。
- 编码后超过 3.5MB 的单张图片即使路由本可接受也会在准入被拒；这类部署必须显式调高 `maxImageBytes`。
- 已经携带超限图片的会话仍然是坏的；本次改动不修复既有历史。

## Testing

`packages/attachment/attachment-local/tests/image.spec.ts` 验证单边超限被拒、恰好等于上限被接受；`tests/store.spec.ts` 验证 `saveImageFile` 准入拒绝超限单边；`tests/index.spec.ts` 钉住全部解析默认值，包括单边 2000px 与编码 3.5MB。
