# 介绍

[English](index.md) | 中文

DeepSeek Harness 是一个**插件化的 agent（智能体）开发框架**，基于 [Cordis](https://github.com/cordiverse/cordis) 微内核构建。它的核心理念是：**一切皆插件**。

## 它是什么

Harness 将 AI（人工智能） agent 所需的所有能力——LLM（大语言模型）调用、工具执行、会话管理、子任务分配——全部构建为可组合的插件。你通过一个 `cordis.yml` 配置文件来声明加载哪些插件、使用什么参数，就能组装出一个完整的 agent。

```yaml
# Select the LLM backend
- name: '@deepseek-ai/dsh-llm-deepseek'

# Compose one configured agent
- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    agents:
      - id: main
        provider: deepseek-official
        model: deepseek-v4-flash
    workspaceContext: false
```

## 适合谁

### 应用使用者

如果你只是想用一个现成的 agent 应用（如编程助手、对话代理），你需要的全部操作就是：

1. 复制一个示例模板。
2. 填写 API 密钥。
3. 运行。

不需要写任何代码。详见 [快速开始](./quickstart.md)。

### 插件开发者

如果你想为 agent 添加新能力——一个自定义工具、一个新的 LLM 适配器、一个新的执行后端——你需要编写一个插件。Harness 提供了清晰的扩展接口和类型安全的开发体验。详见 [开发](../develop/basic/)。

## 核心功能

- **只需要配置** — `cordis.yml` 决定能力集合，换模型、加工具只需改一行
- **HMR（热模块替换）** — 开发时修改插件代码，无需重启进程

## 技术栈

- **运行时**：Node.js ^22.19 或 >= 24
- **语言**：TypeScript（ESM）
- **框架**：Cordis
- **包管理**：pnpm workspaces（仓库固定使用 pnpm 11）
