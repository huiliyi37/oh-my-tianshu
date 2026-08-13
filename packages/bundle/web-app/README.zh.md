# `@deepseek-ai/dsh-web-app`

[English](README.md) | 中文

dsh 浏览器表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上：设置 coding persona，插入 Web 宿主行（webserver、API 网关、workspace、投影缓存、存储）与浏览器插件名录，并挂载本包的 `web-runtime` 粘合插件（配置为 `{mode, printUrl, surfaceContext, lanAddresses}`）。该插件通过 `@deepseek-ai/dsh-frontend` 的 exports 解析已构建的前端 dist，挂载 [`frontend-static`](../../host/frontend-static/README.md) 回退席位所有者，在 `surfaceContext` 为 true 时注册 web 表层提示词段落和 bash 可见的 `DSH_WEB_URL`／`DSH_WEB_MODE` 运行时变量，并在 `printUrl` 为 true 时打印 `dsh web:` URL 行。`dsh web` 启动器别名把 `mode`／`lanAddresses` 与相应 flag 家族 patch 到这些行上。[`dsh-headless`](../headless/README.md) 是同一 base 之上的同级表层，不挂载本组合包。

## 模型体验

### Web 表层提示词段落与 bash 运行时变量

#### 模型看到的内容

当 `surfaceContext` 为 true 时，全局段落 `app:web-surface`（顺序 −98）向模型说明 GUI：规范的本地 URL、「this page」指代什么、当前模式下 HMR（热模块替换）／重建的更新约定，以及不要启动替代服务器的指令。`DSH_WEB_URL` 与 `DSH_WEB_MODE` 还会连同各自描述出现在受管 bash 环境中，每次调用时从运行中的服务器解析。当它为 false 时，该提示词段和这些变量都不会注册。

#### Token 影响

每个会话一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定（端口与模式是启动期事实），因此不会使跨轮次缓存失效。

## 已知限制与延期工作

- **前端 dist 必须已构建**：对 dist 的 `require.resolve` 在激活时明确报错并给出构建提示；没有从源码直接服务的回退路径。
- **`lanAddresses` 是启动期快照**：启动后的网卡变化不会重新公告；打印的 LAN URL 始终与配置的信任栅栏一致。
