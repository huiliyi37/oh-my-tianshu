# @huiliyi37/dsh-command-files

[English](README.md) | 中文

从两层 Markdown 命令文件加载用户自定义斜杠命令。部署或用户把一个 `.md` 文件放到 `<resolveDshHome()>/commands`（默认 `~/.dsh-tianshu/commands`）或 `<cwd>/.dsh/commands` 下，插件就把每个文件变成一个 `/命令`，且不经过模型回合——命令渲染模板并把结果 steer 给 agent。

## 问题

harness 里的其他命令都是代码所有：`/plan`、`/style`、`/next-workflow` 由各自插件注册。用户无法在不改插件、不重新构建的情况下扩充自己的斜杠命令。命令文件补上这个缺口：命令集合变成普通文件，用户或项目可以自行添加、版本化、共享。

## 设计

加载时扫描两层：

- **用户层**：`<resolveDshHome()>/commands`；
- **项目层**：`<cwd>/.dsh/commands`。

两层目录都可通过 `Config` 字段 `userDir` / `projectDir` 覆盖（部署可变路径必须是经过校验的 `Config` 字段，而非硬编码常量）。只有这两个层目录走插件；文件格式与命名文法固定不变。

每个 `.md` 文件是一个命令。文件携带 YAML `---` frontmatter：必填 `description`，可选 `images` 标志，随后是模板正文。命令名是文件 stem 的小写形式，嵌套目录用 `-` 展平（如 `git/log.md` → `git-log`）。每个名字都必须匹配注册中心正则 `/^[a-z][a-z0-9_-]*$/u`，要求**首字符是字母**——`1foo.md`、`my command.md`、大写 stem 都在加载期 fail loud，并报出问题文件路径。

跨层去重由 loader 自己完成，因为命令注册中心对 global 同名 `register` 会抛异常。loader 先收集用户层，再让项目层覆盖它，于是项目命令遮蔽同名用户命令，只把胜者注册进去。同一层内的重名（stem 冲突或展平后冲突）同样在加载期 fail loud。

模板正文针对原始输入精确渲染：

- `$ARGUMENTS`——完整 `rawInput` 原文；
- `$1` … `$9`——按空白切分的位置参数（某个参数不存在时，`$n` 占位符原样保留）；
- 其他 `$` 前缀序列（如 `$0`、`$10`、`$foo`）原样透传，模板不会静默吞掉未知占位符。

渲染结果作为用户消息 steer 给 agent；空模板正文在执行期返回错误，而不是 steer 一个空回合。图像附件仅在文件声明 `images: true` 时透传。

命令还通过可选缝 `tui.commands` 镜像到 TUI 斜杠菜单，执行仍委托 host 命令注册中心，保持 `command/run` / `command/done` 生命周期事件。

## 组合

挂载命令注册中心与本插件，并把两个层目录指向你的命令文件（或使用默认值）：

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: command-files
  name: '@huiliyi37/dsh-command-files'
  config:
    userDir: /home/me/.dsh-tianshu/commands
    projectDir: /work/project/.dsh/commands
```

## Model Experience

### 文件命令的 steer

#### What the model sees

每个文件命令被调用时，渲染其模板正文，并作为 `createUserMessage`（`source: { kind: 'user' }`）经 `agent.steer` 提交。这条用户消息就是模型可见的转录：模型看到的就是渲染后的文本（文件接受附件时还含声明的 `images` 块）。没有引入新的会话事件——steer 的用户消息本来就是已记录的模型可见输入（`model-visible ⟺ logged`），而注册中心的 `command/run` / `command/done` 只是日志，不进入请求。

#### Token effect

每次调用一条用户消息，其 token 数为渲染后的模板正文（外加声明的图像块）。没有按命令配置的 system-prompt 或工具段，因此挂载插件本身零模型 token，直到真正调用某个命令。

#### KV Cache effect

steer 的用户消息作为新的回合后缀追加，不会使已可复用的请求前缀失效。命令文件发现与命令注册中心生命周期事件只是日志，不进入请求，所以本包既不增长也不替换前缀；每次调用只是在末尾追加一条用户消息。

## Known Limitations and Deferred Work

- **无文件监听**——新增或修改命令文件只在重启后生效；两层目录都没有 `add`/`change`/`unlink` 监听。
- **无 per-agent 作用域**——文件命令是部署全局的。per-agent 变体需要遮蔽规则的属主（注册中心支持 agent `agent.ctx` 下注入命令的子插件，但本包只注册全局）。
- **无 keyless PTY 快照场景**——模型可见面是直接对照会话日志断言的 steer 用户消息；harness 的交互终端（PTY）呈现快照尚未接入本包。
