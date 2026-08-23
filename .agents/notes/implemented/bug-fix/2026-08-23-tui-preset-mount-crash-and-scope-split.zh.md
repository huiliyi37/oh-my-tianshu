# Agent Note: 出厂 TUI 挂不上 standard 预设

Status: implemented

[English](2026-08-23-tui-preset-mount-crash-and-scope-split.md) | 中文

## 问题

`a56b89bc54` 让每个出厂 agent 工厂在 `setup` 里挂载默认预设。TUI 启动后首个会话随即 `PresetMountError: preset "standard" failed to mount`——四个 loader 条目同时被拒；而可见崩溃背后还有四个彼此独立的缺陷，此前出厂组合从未真正挂载过预设，所以一个都没被踩到。

四个中有两个是公开基线迁移（私有 `90d10bba` → `35c60d0b70`）弄丢的。私有仓的 `e27d38efd6` 曾把 `cordis:group` 与 `cordis:include` 并列注册为 loader builtin，其 web overlay 也在预设接管 agent 面后禁用了 base 的 32 行 agent 面行；两样事实都在迁移中消失——于是预设里每个 `cordis:group` 行都解析成 `undefined`（对 undefined 读 `Symbol(cordis.group)`），`dsh-skill-local` 又与 base 自己的全局注册相撞（"a skill provider named 'local' is already registered"）。第三个：`apps/cli` 的预设依赖闭包（`649d733af9`）漏了 `@huiliyi37/dsh-tool-pwsh`——standard 预设里唯一 base 不同时携带的行，profile 的扁平模块回退解析不到。第四个——修完前三个才显形——挂载成功了，但 agent 的面停在 `['str_replace_editor', 'zen_anchor']`：`dsh-scope` 的两个缺陷加 zen 的一个缺陷，把 preset 层从 agent 视图里劈开了。

## Decision

作用域劈裂有两层。`dsh-scope` 用 `Symbol('dsh.scope')` 做上下文标签、用模块级 WeakMap 存 carrier/父子关系，而 loader 挂载的行在源/构建混合世界（tsx 源启动、vitest 转换器）里跑的是本模块的第二份副本：standing 上下文上的标签与 `scopeOf` 读的标签是字面意义上不同的 symbol 实例，`bindScopeParent` 写入的 WeakMap 也不是注册表视图走读的那张。标记改 `Symbol.for`、两张表挂到 `globalThis` 注册符号下——一个进程一张路由表，与模块副本数无关。

剩下的缺口在 zen 的面武装。`armRestrict`/`completeArm` 用**全局视图**（无作用域的 `tools.schemas()`）判断"哪些工具存在"。预设世界里 `bash`/`todo_write`/`subagent` 只存在于 standing 作用域层，zen 面被武装成 `['str_replace_editor']`，且 `completeArm` 会在首条消息时对一直可见的名字响亮报错——全局读武装不了带作用域的面。改读 agent 自己的限制后视图同样自败（已武装的限制会藏起它仍欠的名字），于是注册表新增 `restrictableNames(scope)`：`restrict()` 校验时所用的那条链感知、限制前的名字集。

- `packages/boot/app-boot`：在 `include` 旁恢复 `ctx.loader.builtins.group = Group`（复原 `e27d38efd6`）。
- `packages/tui/tui/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml`：禁用 standard 预设在 agent 面重复提供的 21 行 base 行。宿主面行（各寄存器、子代理后端、执行器）与预设不携带的面（`tool-git`、`tool-str-replace-editor` 等）保持全局——预设会话经作用域链照常可见。
- `apps/cli/package.json`：预设依赖闭包补 `@huiliyi37/dsh-tool-pwsh`。
- `packages/core/scope`：标记改 `Symbol.for`，carrier/父子两表挂 `globalThis`（一进程一张表）。
- `packages/core/tools`：公开 `restrictableNames(scope)`；`dsh-zen` 的武装与补全改读它。
- 随附清偿：ACP `newSession` 与其余工厂同款挂载默认预设（见[姊妹篇](../architecture/2026-08-23-preset-default-inheritance-and-agent-mount.md)）；`runner.spec` 的 welcomeAnimation 透传用例随 `51824216f3` 删除的字段一并退役；`SOURCE-MAP.md` 补上 `78703fd9c8` 漏掉的 `cache-telemetry.ts` 行。

## Consequences

每个挂 roster 的出厂 profile 现在跑的正是 preset 文件一直记载的分工：宿主面行全局、agent 面按预设组装、base 独有面经作用域链照常可见。`restrictableNames(scope)` 是注册表新增的公开读取口，供面武装使用；作用域路由在模块副本共存时保持一张表，而非按副本静默分裂。随附清偿 `51824216f3`（welcomeAnimation 透传）与 `78703fd9c8`（SOURCE-MAP 行）的已提交测试欠账，ACP 桥与其他工厂同款挂载。

## Alternatives considered

- **把 agent 面整体从 dsh-base 摘除，而非按 overlay 禁用。** 否决：只有 base 的部署（无 roster 的组合）会在无预设挂载时失去全部工具；overlay 禁用保住 base 自足性，并把选择权放在 roster 所在处。
- **zen 补全检查改读 agent 的限制后视图。** 否决：已武装的限制恰好藏起检查仍欠的名字，欠账永远无法结清；`restrict()` 自身校验所用的限制前集合才是正确读法。
- **消灭源/构建混合世界，而非共享作用域状态。** 否决：源启动契约（tsx ESM）与测试转换器都按设计让行加载打到构建 lib；一进程一张路由表是更小、更诚实的修复。

## 测试

`apps/cli/tests/tui-preset-composition.spec.ts` 经 `prepareProfile` 启动真实 tui profile（临时 `$DSH_HOME`、真实 bundle patch 层、shipped preset root，仅禁渲染器与 HMR 两行），钉三层事实：roster 以 `standard` 默认启动；全局层不再携带预设拥有的工具、base 独有面照常可见；工厂挂载的会话武装出精确 zen 面 `['bash','str_replace_editor','subagent','todo_write','zen_anchor']`——五者中三个只经 standing 层抵达，修复前该列表必假。真实 TUI 干净启动（`node --import tsx/esm apps/cli/src/bin.ts tui`）。受影响套件全绿：zen、scope、agent-presets、tool-skill、tool-subagent、tools、app-boot、tui。
