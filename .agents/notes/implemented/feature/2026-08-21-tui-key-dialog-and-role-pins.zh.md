# Agent Note：TUI key 对话框与 `/model` 角色 pin

状态：已实现

[English](2026-08-21-tui-key-dialog-and-role-pins.md) | 中文

## 问题

TUI 此前只能检测 DeepSeek 凭据缺失（欢迎行、footer 徽标、`/config` 面板），没有任何设置入口——写入凭据缝的唯一路径是 Web 模型页，纯终端用户只能手改 `.env` 或研究文件布局，才能让第一次请求成功。`model-roles` 能力缝（见[按角色 pin 模型](2026-08-21-model-role-pins.md)）同样落地时没有 TUI 前门，只能编辑 `settings.yaml`。

## 决策

`packages/tui/tui/src/ui/key-dialog.ts` 是一个掩码输入 overlay，写入走既有 `ctx.credentials` 缝而不是另造存储：key 先向 `GET {baseURL}/models` 探测（`DEEPSEEK_BASE_URL`，缺省官方端点），401/403 拒绝写入；网络错误或超时无法证伪 key，只告警并允许显式的"仍要保存"确认。`describe()` 报 `writable: false`（进程环境遮蔽该引用）时短路为说明态，而不是写一个永远不会生效的值；凭据服务缺席则降级为设置环境变量的指引。对话框由 `/key`（别名 `/login`）打开，并在未配置 key 时于每次启动的欢迎屏之后自动打开一次；保存成功会重跑就绪检查，欢迎行与 footer 无需重启即翻转——`llm-deepseek` 的按请求凭据解析本就保证这一点。对话框消费的是最小结构凭据面（`KeyDialogCredentials`）而不是 import `dsh-credentials`，包边界留在装配方。

`/model` 新增角色子命令 `vision` / `secondary` / `subagent`（选择器或直接 `provider/model` 参数），调用 `ctx.modelRoles.pin`/`unpin`；选择器首行把 pin 清回"跟随默认"。这三个角色词在 `/model` 首参中成为保留字，接管了旧的裸词语义（名叫 `vision` 的模型现在必须写成 `provider/vision`）。`/config` 面板显示各角色的 pin 状态——已 pin 的路由或"跟随默认"——并刻意不复制消费者的回退链，那横跨面板看不到的插件。角色逻辑收在 `src/model-roles.ts`，对话框收在 `key-dialog.ts`，`app.ts` 只承担接线。

## 考虑过的替代方案

- **从 TUI 编辑 `$DSH_HOME/.env`**——`.env` 层的解析优先级低于凭据存储，且同样被进程环境遮蔽；凭据缝已经拥有可写、热发布的存储，再开一条写入路径会分叉优先级契约。
- **首次请求时才验证 key**——失败晚一轮才暴露的首启流程正是本次要补的引导缺口；grok-build 在 initialize 时探测 key，同样是 401/403 拒绝、网络错误放行的分类法。
- **`/config` 里显示完整有效解析**——如实的每角色"有效路由"需要各消费者的回退链（组合配置、auto-bridge、会话继承），没有跨插件可查的途径；面板改为显示 pin 状态并指向 `/model <role>`。

## 影响

探测端点与对话框文案是 DeepSeek 专属的，但对话框结构（describe 门控写入、探测分类、掩码输入）是供应商无关的——接入新供应商意味着新的 ref 与探测 URL，而不是新对话框。首启自动打开是每次启动一次，不做持久化的"不再提示"。`/model vision` 的保留字接管对裸模型 id 恰好等于角色名的用户是行为变化。`app.ts` 的 source budget 随本特性与 key 对话框接线从 4061 提到 4435；两个特性的逻辑都落进了独立模块，清单编辑让增长在评审中可见。

## 测试

TUI spec 覆盖对话框状态机（超过 8 字符的掩码、环境遮蔽的 blocked 态、invalid 探测回输入态、unknown 探测的仍要保存、`onSaved` 刷新）与角色命令（选择器打开与当前 pin 标记、直参 pin、目录拒绝与建议、非 `supportsVision` 模型的 vision 警告、"跟随默认" unpin 行、缝缺席时的降级），以及 `/config` 段的两种渲染状态。
