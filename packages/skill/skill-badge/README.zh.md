# @huiliyi37/dsh-skill-badge

[English](README.md) | 中文

可选的内置 skill（技能）提供方，向 `ctx.skills` 贡献 `dsh-badge`。该 skill 提供官方「powered by oh-my-tianshu」Markdown 徽章片段。

挂载该插件即可启用提供方。它没有配置。随附的 CLI（命令行界面）组合以 `disabled: true` 包含该插件；用户必须显式启用其 `skill-badge` 配置行，该 skill 才会进入目录。

该提供方将随包分发的 `assets/` 目录作为 skill 资源基底公开。

## 模型体验

通过 `@huiliyi37/dsh-tool-skill` 间接影响模型；该包会渲染目录条目和所选 skill 的正文。

#### KV Cache 影响

该插件默认禁用，不会改变任何请求。启用后，其目录条目和任何已加载正文都会在各自插入点改变提供方的 KV 前缀。

## 已知限制与暂缓事项

- 该提供方只贡献一个固定 skill，不提供运行时自定义。
- 徽章是 Shields.io 远程图片；无法获取远程图片的目标环境需自备副本。
