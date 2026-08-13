# @deepseek-ai/dsh-host-directory-picker

[English](README.md) | 中文

web GUI 宿主的**工作区目录选择 seam**：抽象服务 `DirectoryPicker`（`ctx.directoryPicker`），唯一约定方法 `capability()` 返回一个可辨识能力对象，描述操作者以何种方式选择目录。后端之间的差异在交互形态而不只是机制，因此 seam 显式建模形态而非统一方法集：`{ kind: 'native', pick(signal) }` 在宿主屏幕上打开一个原生 OS 选择器（[`-native`](../directory-picker-native/README.md)）；`{ kind: 'browse', list(path?), createDirectory(path, name) }` 提供应用内浏览器驱动的列举／创建原语，也能服务于 OS 对话框无法触及的远程客户端（[`-browse`](../directory-picker-browse/README.md)）。消费方按 `capability().kind` 分支；联合类型由可合并扩展的 `DirectoryPickerCapabilities` 映射派生（新后端通过声明合并加入自己的形态），未知 kind 的文档化默认行为是隐藏选择入口而非失败。能力对象在服务生命周期内必须保持稳定。client 侧以镜像方式承接该 seam，无需通过 wire 公布能力：每个后端包都是双面包，其 browser half 把匹配的选取交互注册进 ui-workspace 的目录流 slot——因此一项组合配置会同时切换宿主能力与 client 流程。不应固定某种交互的组合改为挂载 [`-auto`](../directory-picker-auto/README.md) 选择器，它在启动时一次性判定宿主处境，并自行挂载匹配的后端行。

浏览原语失败时会抛出带类型的 `DirectoryPickerError`（`directory-unreadable`／`directory-exists`／`directory-create-failed`，各自携带出错对象的 `path`），消费网关将其 1:1 映射为协议错误码。`DirectoryEntry` 行携带宿主判定的 `hidden` 标志（POSIX 点前缀约定），展示策略留在客户端；`DirectoryListing.crumbs` 是从文件系统根开始的祖先链，每个 crumb 都是跳转目标。设计依据、与 `ctx.fs` 的切分、策略裁决见[目录选择能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md)。

## 模型体验

无。该 seam 服务于 GUI 宿主的目录选择；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **约定未定义多根目录词汇**——浏览约定每次列举只暴露一条祖先链；按部署限定可浏览根（以及 Windows 盘符之上的根枚举）等到出现需要它的消费方再做，见 seam Agent Note。
