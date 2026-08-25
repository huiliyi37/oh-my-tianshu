# Agent Note: /doctor 原生依赖预检

Status: implemented

[English](2026-08-25-doctor-native-dependency-preflight.md) | 中文

范围：`packages/tui/tui/src/format/doctor-report.ts`、`packages/tui/tui/src/commands/registry.ts`（`/doctor`）、`packages/tui/tui/package.json`（声明 `@huiliyi37/dsh-subprocess-local`）

## 问题

lifecycle scripts 被拦截的安装（npm 11+ 默认）会丢掉原生构建——`koffi`（进程表 FFI）与 `node-pty`（PTY 后端）——用户只能在 bash 执行器失败时看到故障，且没有任何指向修复方式的提示。根 README 记录了确切补救（`npm i -g --allow-scripts=koffi,node-pty,…`），但诊断现场无人呈现它。

## 设计

`collectNativeDependencyChecks(probe?)` 加入 `/doctor` 报告：两行（koffi / node-pty），探针加载不了模块时 `warn` + `fixId 3`。TUI 包装明 `@huiliyi37/dsh-subprocess-local`，plain Node 才能从 `import.meta.url` 解析该属主（vitest 路径映射不能代替）。默认探针经 `createRequire` 从该属主解析每个模块，再试 `process.argv[1]`，再回退裸 specifier（npm -g 安装的顶层布局）；require 缓存使重复探测零开销。探针可注入，保持 doctor-report 的纯函数面；`DOCTOR_FIXES[3]` 携带 README 的原句 `--allow-scripts` 重装命令。取值行写明坏的是什么（`bash 终端执行器` / `Windows 进程表/信号`），读起来是诊断而不只是布尔值。

## 边界

检查的是可加载性而非构建健康（能加载但坏的二进制不在范围）；TUI 组合本身启动不需要这些模块——本预检告诉用户环境是否就绪于需要它们的组合。

## 凭证

`doctor-report.spec.ts` 钉住全在、各自缺失（fixId + 指引文本含该命令）、默认探针在本仓开发安装上的 ok 路径，以及同一探针在 plain `node --import tsx/esm` 下（不是 vite 路径映射）；`/doctor` 命令规格钉住两行原生条目出现在回显报告中。
