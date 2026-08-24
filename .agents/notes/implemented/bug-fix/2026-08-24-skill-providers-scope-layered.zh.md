# Agent Note: 技能提供方按作用域分层,不再进程全局

Status: implemented

[English](2026-08-24-skill-providers-scope-layered.md) | 中文

## 问题

roster 已运行 `standard` 时执行 `/preset taiyi` 报 `a skill provider named "local" is already registered`:两个预设组装都携带 `skill-filesystem`(`dsh-skill-local`),而技能注册表在一张扁平的进程全局 Map 上强制提供方名唯一。预设文件一直写的是另一种设计——「skill 寄存器按作用域分层:这些行注册进本预设的层」——但实现从未有过分层,于是任何第二个 standing 组装都相撞。

## Decision

提供方存储迁到 `ScopedLayers`(与工具注册表同一原语)。`registerProvider` 经 traced receiver(`scopeOf(this.ctx)`)取调用方作用域,把提供方归入该作用域层(宿主面调用方进全局层),并按层强制名称唯一:两个并存预设可各自运行同名提供方,作用域条目在自己的视图里阴影同名全局条目,同层重复仍然抛错——那一直是双重挂载 bug。目录折叠(`list`/`snapshot`/`get`)以同法解析查询作用域:全局条目打底、作用域链条目按名阴影、最近作用域获胜。collect 缓存以稳定的按作用域 id 入键,一个 agent 的目录缓存不会供给另一个预设的视图。

## Alternatives considered

- **跨作用域重名即抛错,让预设给提供方改名。** 否决:提供方名是目录身份(优先级档、`skills/change` 归因);按预设改名会把组装细节泄漏进用户可见名称。
- **同一时刻只允许一个 standing 组装——挂 taiyi 前先卸 standard。** 否决:standing 的意义就是让已加入的会话继续在其组装下运行;卸掉 standard 会打断所有 standard 会话。

## Consequences

注册表现在与工具注册表确立的作用域注册模型一致;运行时技能注册(`register`)保持扁平先到先得。`dsh-skill` 新增 `dsh-scope` peer 依赖。

## Testing

单元:双作用域同名提供方共存且视图各自正确;作用域条目仅在自己视图阴影全局同名;同层重复仍响亮失败。组合(`apps/cli/tests/tui-preset-composition.spec.ts`):taiyi 会话在 standard 会话保持挂载时成功挂载——两者武装出相同禅锚定面,工具与提供方零冲突。
