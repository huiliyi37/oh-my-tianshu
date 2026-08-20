# Agent Note：Loader 插值条目 `disabled` 字段

Status: implemented

[English](2026-08-11-loader-entry-disabled-interpolation.md) | 中文

## 问题

条目元数据没有条件机制：`!!js` 只在插件 `config` 下插值，[postmortem 0002](../../../../docs/postmortem/0002-js-expression-disabled-filesystem-tools.md) 记录了 `disabled: !!js ...` 保持真值表达式对象、在所有平台上禁用该行的事故。持久 pwsh 栈（[基于 PTY seam 的持久化 pwsh](2026-08-11-pwsh-persistent-pty.md)）需要同一份预设文件在每宿主恰好挂载一个持久 shell——POSIX 上的 bash 行、win32 上的 pwsh 行——静态元数据表达不了这一点。

## 决策

Loader 插值条目 `disabled` 字段（`vendor/loader/src/config/entry.ts`）：`!!js` 表达式在每次挂载决策时基于 loader 上下文求值。`disabled` 是唯一被插值的元数据字段；`id`、`name`、`group`、`inject` 保持静态。原始节点保留在 options 中，写回保持 `!!js` 形式。`verify-cordis-config` 现在只允许 `disabled` 中的表达式，并在检查期拒绝无法解析的表达式，而不是等到启动时。

首个发货消费者是 `minimal` 预设的持久 shell 栈：bash 行携带 `disabled: !!js process.platform === 'win32'`，pwsh 行携带取反的表达式。一次性 shell 工具按设计不受影响：发货预设（standard、code、cordis）无条件挂载 `tool-bash` 与 `tool-pwsh`，平台缺位交给执行器处理。上游更大范围的平台层折叠（base bundle 行门控 `bash-sandbox`/`pwsh-sandbox`、删除独立的 Windows patch 层）此处未采纳；日后如需采纳，可直接使用这一机制，无需再改 loader。

## 备选方案

**行上的声明式 `platform` 字段。** 静态且可被门禁检查，但它是 `!!js` 之外的第二种组合机制，且平台只是今天的条件。

**预设级平台 overlay。** 被否：条件应当属于它所治理的行。

## 后果

行可以按平台或环境门控自身；错误的表达式在启动时响亮失败。其余元数据字段保持字面值，门禁继续拒绝那里的表达式——`disabled` 上的 postmortem-0002 隐患以「求值」而非「禁止」关闭。启动级行为由 `packages/boot/app-boot/tests/user-patches.spec.ts` 的 `Loader entry disabled interpolation` 套件（求值、写回保留原始节点、`update()` 时重新求值）、门禁自身的 spec，以及 `apps/cli/tests/windows-shell.spec.ts`（在任意宿主上钉死 minimal 预设的按平台阵容）共同固定。
