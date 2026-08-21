# Agent Note: 上游 v0.1.1-rc.2 统一图片管线——移植计划

Status: proposed

[English](2026-08-22-upstream-rc2-image-pipeline.md) | 中文

## 问题

上游 `dsh-v0.1.1-rc.2`（rc.1 之后 31 个非 merge 提交）的主体是一个架构特性——[统一图片请求管线](https://github.com/deepseek-ai/deepseek-harness)（设计 note `2026-08-20-unified-image-request-pipeline`）：提供方无关的规范化附件、按路由的确定性请求版本、DeepSeek Files API 生命周期、带降采样坐标的 `read_image`。本仓库的图片面是自研且互不相交的：vision-bridge（独立视觉模型为纯文本主控描述图片）、vision-ask（`ask_image` 重询）、llm-deepseek 的 `supportsVision` 布尔目录字段（而非上游的 `inputModalities`）、TUI 带图直发走内联 base64 + 最旧先弃。本地 `attachment` 是 rc8 的干净移植，没有规范化概念——`store.ts` 直接对源字节取摘要，请求版本 seam 完全不存在。用户要求拉取该增量并评估。

上游设计解决、而本地今天同样存在的具体痛点：一个字节上限同时服务存储、内联展开与模型像素三种诉求；重复的 base64 让后续每个请求膨胀；提供方的一次拒绝会因同一持久图片留在每个未来请求里而复现；存储对象变质后没有任何恢复手段。

## 方案

按依赖序移植，每组落地全绿再进下一组。B 组携带唯一真正的决策；其余皆为适配。

### A 组——attachment 规范化（上游六个提交的终态）

引入 `attachment-local` 的 canonical/normalization/encoding 三件套（约 630 行新代码）：8-bit sRGB/sRGBA 转换、EXIF 定向、元数据剥离、长边 2048px、`normalizedImageMaxBytes`（默认 4MiB）内的 PNG/WebP/JPEG 候选阶梯、字节级直通的干净判定与去重、降采样记录 `originalDimensions`、批量准入先备好全部成员再发布任何成员。`saveImage` 返回 canonical ref 与源事实并列。预发布立场允许拒绝旧磁盘对象格式——不做迁移，写入 README Known Limitations。

### B 组——请求版本 seam（先定词汇决策）

`AttachmentStore.readImageRequest(ref, policy)`：路由自有像素/字节预算、`variantId` 缓存、等值 singleflight、FIFO 变换限流；`llm` 增加 `prepareCall` 代际绑定，`content.ts` 增加投影助手（`projectImagesForTextModel`、精确长度卸载记账）。**动工前必须先决策**：本地目录词汇从 `supportsVision` 迁向上游 `inputModalities`，还是保留布尔并在 seam 处派生模态。该决策触碰用户进行中的 OpenRouter/pi-ai vision 工作（路由元数据来源），因此排在它落定之后，或与其合并进行。

### C 组——DeepSeek Files 生命周期

`llm-deepseek` 四个新文件（约 840 行：files-api 客户端、file store、按 endpoint+key+variantId 索引且不存密钥的 upload index、file-id 助手）加 adapter 集成：stale-id 定向失效 + 一次重传重试、配额错误列删 `dsh-` 前缀文件、文件解析失败的有界内联回退、files/stream 超时解耦（`d618bfebb4`）。adapter 合并必须把本地 `spark` 推理截断特性按语义合入——`serialize.ts` 的截断只作用 wire 副本、会话日志保留全文，该分歧是有意的，本组移植不得将其抹平。

### D 组——read_image（移除 region 后的终态）

上游的 `read_image`（把工作区图片文件提交为附件、模型看到像素；报告降采样后尺寸与坐标倍率）与 vision-ask 的 `ask_image`（追问已在会话中的图片）互补——文件→会话 vs 追问已有。先写清两个工具描述的分工再引入；取已移除 region 读取的终态（`724783b024`、`cbc830aded`——region 工具本地从未存在，无需移除）。

### 明确不移植

- `reasoning-passback-every-turn`——rc.8 已含，本地已覆盖（`serialize.ts:157-167`）。
- attachment 读取隔离——上游仅 proposed note、零代码；A+B 组落地后本地 readImage 失败同样 fail-loud，届时在本地 notes 登记为跟踪缺口。
- blank-permission 刷新的 revert——已在 [rc.1 跟进计划](2026-08-21-upstream-rc1-followup-ports.md) 项 2 的撤销中处理。

## 否决的替代方案

**保留自研的纯内联管线。** 否决：本地今天就在付上游列举的代价（内联膨胀、一顶三的上限、拒绝复现），且规范化附件设计是提供方无关的——它同样强化现有 vision-bridge 路径，被描述的图片与直发的图片共享同一持久存储。

**整体迁往 `inputModalities`。** 这是 B 组桌面上的一个选项，不预先决定：本地 `supportsVision` 门已贯通目录 → 解析 → 请求拒绝，TUI 已在消费它；除非 seam 派生方案被证明有损，整体改名是无谓翻动。

**绕过 B 组直接移植 Files。** 否决：上传的字节正是确定性请求版本——没有请求版本 seam 的 Files 会重新引入不可复用、不可记账的上传。

## 验收标准

- A 组：准入/规范化/直通各套件绿（含 16-bit PNG 转换、字节压力下保 alpha、低色候选阶梯）；已存图片的持久 ref 寻址规范化字节；README 双语更新磁盘格式说明。
- B 组：词汇决策先于代码动、记录在本 note；`readImageRequest` 派生确定（同附件 + 同策略 ⇒ 同字节），singleflight 共享等值变换且无共享取消泄漏，纯文本路由收到确定性占位，卸载记账用派生长度。
- C 组：上传/复用/临期刷新/stale 失效/配额删除路径由包测试钉住；文件解析失败时有界内联回退生效；`spark` 截断行为不变（其套件绿）。
- D 组：`read_image` 报告降采样尺寸与坐标倍率；`ask_image` 与 `read_image` 的描述写明互不相交的职责；无 region 残留面。
- 每组：`tsc -b` host+client 干净、oxlint 零新增、模型可见图片路径有 keyless 快照覆盖、README/配对重录、implemented note 归档。

## 风险

- **磁盘格式变化**（A 组）：既有 `~/.dsh-tianshu` 附件对象使用规范化前的摘要；预发布立场允许拒绝，但失败必须显式具名，绝不静默重传——若真咬人，隔离跟踪（上文）是后续。
- **B 组与并行工作相撞**：目录词汇决策与 pi-ai base64 界适配（`48a58b9090`）和用户未提交的 pi-ai vision 改动交叠。排序规则：该工作先落定，B 组在其上重基。
- **峰值 RSS**：两个并发变换相对当前串行内联路径抬高内存；`imageCompressionConcurrency` 的 1–8 配置按"无硬编码可调参"规则保持为校验过的 Config 字段。
- **Files 配额行为是提供方真实行为**：配额删除与 stale 恢复只有真实 API 能完整演练——keyless 套件钉住逻辑，但首次带密钥运行应在监视下进行，而非盲信。
