# Agent Note: TUI 半块字符图片预览

Status: implemented

[English](2026-08-22-tui-image-preview-halfblock.md) | 中文

## 问题

图片附件在还来得及处理之前一直是不可见的：编辑期间唯一的反馈是 `📎 N images` 计数行；提交后图片只经 kitty/iTerm2 图形协议渲染——其余终端（Apple Terminal、VS Code 的 xterm.js、tmux/screen）的用户从头到尾看不到任何像素级内容。竞品（opencode-tui）同样没有 composer 缩略图，所以这是两边共同的真空白，不是一次移植。

## 决策

用真彩半块 ANSI 文本渲染预览：每个 `▀` 字符的上半像素走前景色、下半像素走背景色，`cols × rows` 的字符网格就在任何能打印文本的终端里显示 `cols × 2·rows` 的像素图。两个消费面共用同一渲染器（`engine/image-preview.ts`）：

- **composer 缩略图**——编辑期间，最后一张附件在 live 区 `📎` 行上方渲染（≤30 列 × 10 行），`onImagesChange` 触发每次附图/移除的重算，代际号丢弃迟到的异步结果。
- **气泡回退**——`imageProtocol()` 为 `'none'` 时，提交把同样的半块渲染写进用户气泡下方的 scrollback（≤ 终端宽 × 16 行），编舞与图形协议路径完全一致（清 live → writeRaw → 立即重绘）。

像素解码走 `sharp`（懒加载；TUI 包新增该依赖，与附件管线在 bundle 里已携带的版本一致）。任何失败——原生模块缺失、载荷损坏、解码错误——返回 `null`，消费面降级回纯文本行为；预览是装饰性能力，永不阻塞发送。关键设计细节：nearest 邻采样让截图硬边缘保持锐利而不是把文字糊成中间色；同色游程合并成单个 SGR 对（纯色截图从逐像素转义坍缩为个位数序列）；网格按宽高比适配、行上限反推宽度，极端竖图显示窄条全高而不是 cover 裁切带；`▀` 是 East Asian Width Ambiguous，`ambiguousWide` 模式下列预算折半，渲染宽度与 live 引擎的 `displayWidth` 行数计量在两种模式下都成立；透明像素合成到主题 `userMsgBg`（truecolor 轨，缺省中性暗色常量）。

## 备选方案

- **有协议时 composer 走 kitty/iTerm2 协议。** 否决：live 区每帧按纯文本擦除重写，而协议图形独立于文本重绘持久存在——在那里放预览需要每帧的 image-id 记账与显式删除。半块是文本，重绘正确性免费，且一条代码路径服务所有终端。
- **transcript 也全部半块。** 否决：协议终端今天提交后已是全分辨率图；半块保持 `'none'` 回退定位，每个终端拿到各自可达的最佳保真度。
- **经 sips/magick CLI 链解码**（`image-tool.ts`）。否决：macOS 原生有 sips 没有 magick，而 sips 吐不出原始像素——回退在 macOS 上是坏的。`sharp` 已是同进程附件管线验证过的原生依赖。
- **纯 JS PNG/JPEG 解码器。** 否决：为六种容器格式手搓解码器违背仓库的“优先维护依赖”政策。

## 后果

- 所有终端都能看到即将发送图片的像素级预览；无协议终端在提交后的 transcript 里也能看到。
- `@huiliyi37/dsh-tui` 新增 `sharp` 依赖（原生，`^0.35.3`）；bundle 安装体积不变（attachment-local 已携带同版本），独立 TUI 消费者多拉一次。懒加载 + null 降级保证原生模块加载失败时渲染路径仍然活着。
- 预览行携带重真彩 SGR 内容穿过 live 引擎；这在 `LiveRegionLine.text` 契约（ANSI 格式化文本）之内，`displayWidth` 剥转义，spec 里有宽度断言验证。
- 未做：动图帧选择（只取首帧）、回退 scrollback 成本的配置开关、sixel 支持（检测集合里没有终端需要它）。
