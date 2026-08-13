<!-- 英文源文件由 scripts/gen-doc-graphs.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/capability-seams.md` 重新记录配对。 -->

# 能力 Seams 与核心服务

[English](capability-seams.md) | 中文

服务可以是核心主干服务、可替换的能力 seam，也可以是组合包／组合点。下图展示了拥有服务声明的包、已知实现包，以及直接消费该服务的包。

```mermaid
flowchart LR
  pkg_llm["llm"]
  svc_llm["ctx.llm<br/>LLM adapter registry"]
  pkg_llm_deepseek["llm-deepseek"]
  pkg_llm_pi_ai["llm-pi-ai"]
  pkg_llm_replay["llm-replay"]
  pkg_agent_loop["agent-loop"]
  pkg_compact_basic["compact-basic"]
  pkg_token_meter["token-meter"]
  svc_tokenMeter["ctx.tokenMeter<br/>Replay token measurement"]
  pkg_compact_tool_result_prune["compact-tool-result-prune"]
  svc_toolResultPrune["ctx.toolResultPrune<br/>Model-free tool-result pruning"]
  pkg_session["session"]
  svc_sessions["ctx.sessions<br/>In-memory session store"]
  pkg_agent["agent"]
  pkg_session_persistence["session-persistence"]
  pkg_session_query["session-query"]
  pkg_session_query_sqlite["session-query-sqlite"]
  pkg_subagent_inprocess["subagent-inprocess"]
  pkg_invariants["invariants"]
  svc_invariants["ctx.invariants<br/>Package-owned invariant registry"]
  pkg_scope["scope"]
  pkg_typert_registry["typert-registry"]
  svc_typert["ctx.typert<br/>Runtime type registry"]
  pkg_typert_loader["typert-loader"]
  pkg_api_gateway["api-gateway"]
  svc_typertGateway["ctx.typertGateway<br/>TypeRT Host invocation gateway"]
  svc_sessionPersistence["ctx.sessionPersistence<br/>Durable session persistence seam"]
  pkg_session_persistence_jsonl["session-persistence-jsonl"]
  pkg_session_persistence_sqlite["session-persistence-sqlite"]
  pkg_tool_bash["tool-bash"]
  pkg_hooks_claude["hooks-claude"]
  pkg_hooks_codex["hooks-codex"]
  pkg_settings["settings"]
  svc_settings["ctx.settings<br/>User-settings seam"]
  pkg_settings_local["settings-local"]
  pkg_apiproxy["apiproxy"]
  pkg_credentials["credentials"]
  svc_credentials["ctx.credentials<br/>Credential seam"]
  pkg_credentials_local["credentials-local"]
  pkg_session_telemetry["session-telemetry"]
  svc_telemetry["ctx.telemetry<br/>Session telemetry seam"]
  pkg_session_telemetry_otel["session-telemetry-otel"]
  pkg_storage["storage"]
  svc_storage["ctx.storage<br/>Non-session storage hub"]
  pkg_storage_json["storage-json"]
  pkg_storage_sqlite["storage-sqlite"]
  pkg_storage_domain["storage-domain"]
  svc_storageDomain["ctx.storageDomain<br/>Domain data facility"]
  pkg_workspace["workspace"]
  svc_workspace["ctx.workspace<br/>Workspace entity registry"]
  svc_sessionQuery["ctx.sessionQuery<br/>Session reads, traces, filters, and search"]
  pkg_session_reference["session-reference"]
  pkg_tool_session_query["tool-session-query"]
  svc_sessionReferences["ctx.sessionReferences<br/>Cross-session snapshot preparation"]
  pkg_session_title["session-title"]
  svc_sessionTitle["ctx.sessionTitle<br/>Log-backed session titles"]
  pkg_session_title_first_message_llm["session-title-first-message-llm"]
  pkg_session_title_all_messages_llm["session-title-all-messages-llm"]
  pkg_system_prompt["system-prompt"]
  svc_systemPrompt["ctx.systemPrompt<br/>System prompt assembly registry"]
  pkg_tools["tools"]
  pkg_tool_fs["tool-fs"]
  pkg_tool_pty["tool-pty"]
  pkg_tool_web["tool-web"]
  svc_tools["ctx.tools<br/>Tool registry and guarded execution pipeline"]
  pkg_tool_ask_user["tool-ask-user"]
  pkg_tool_cordis["tool-cordis"]
  pkg_tool_skill["tool-skill"]
  pkg_tool_subagent["tool-subagent"]
  pkg_tool_todo["tool-todo"]
  pkg_user_interaction["user-interaction"]
  svc_userInteraction["ctx.userInteraction<br/>Human question/answer seam"]
  pkg_plan_mode["plan-mode"]
  svc_planMode["ctx.planMode<br/>Plan collaboration state"]
  pkg_commands["commands"]
  svc_commands["ctx.commands<br/>Human command registry"]
  pkg_session_projection["session-projection"]
  svc_sessionProjections["ctx.sessionProjections<br/>Session projection units"]
  pkg_host_apiproxy["host-apiproxy"]
  pkg_session_projection_cache["session-projection-cache"]
  svc_sessionProjectionCache["ctx.sessionProjectionCache<br/>Persisted projection cache"]
  pkg_skill["skill"]
  svc_skills["ctx.skills<br/>Skill provider registry"]
  pkg_skill_badge["skill-badge"]
  pkg_skill_local["skill-local"]
  svc_agents["ctx.agents<br/>Agent service"]
  pkg_acp["acp"]
  pkg_agent_default_model["agent-default-model"]
  svc_agentDefaultModel["ctx.agentDefaultModel<br/>Default Agent model selection"]
  pkg_headless["headless"]
  svc_agentLoop["ctx.agentLoop<br/>Concrete loop driver"]
  pkg_agent_spine_demo["agent-spine-demo"]
  pkg_goal["goal"]
  svc_goals["ctx.goals<br/>Same-session goal domain"]
  pkg_e2b["e2b"]
  svc_e2b["ctx.e2b<br/>E2B sandbox lifecycle owner"]
  pkg_fs_e2b["fs-e2b"]
  pkg_subprocess_e2b["subprocess-e2b"]
  pkg_subprocess["subprocess"]
  svc_subprocess["ctx.subprocess<br/>Subprocess seam"]
  pkg_subprocess_local["subprocess-local"]
  pkg_bash_local["bash-local"]
  pkg_bash_sandbox["bash-sandbox"]
  pkg_pty_local["pty-local"]
  pkg_lsp_local["lsp-local"]
  pkg_subagent_acp["subagent-acp"]
  pkg_subagent_codex["subagent-codex"]
  pkg_subagent_claude_code["subagent-claude-code"]
  pkg_bash["bash"]
  svc_bash["ctx.bash<br/>Bash executor seam"]
  pkg_pwsh_local["pwsh-local"]
  pkg_tool_pwsh["tool-pwsh"]
  pkg_bash_env["bash-env"]
  svc_bashEnv["ctx.bashEnv<br/>Managed bash environment registry"]
  pkg_pty["pty"]
  svc_pty["ctx.pty<br/>Persistent PTY session registry"]
  pkg_sandbox["sandbox"]
  svc_sandbox["ctx.sandbox<br/>Process-sandbox seam"]
  pkg_sandbox_local["sandbox-local"]
  pkg_sandbox_policy["sandbox-policy"]
  svc_sandboxPolicy["ctx.sandboxPolicy<br/>Sandbox policy home"]
  pkg_fs_sandbox["fs-sandbox"]
  pkg_approval["approval"]
  svc_approval["ctx.approval<br/>Approval seam"]
  pkg_permission["permission"]
  svc_permission["ctx.permission<br/>Permission presets"]
  pkg_code_runtime["code-runtime"]
  svc_codeRuntime["ctx.codeRuntime<br/>Code-execution seam"]
  pkg_code_runtime_worker["code-runtime-worker"]
  pkg_fs["fs"]
  svc_fs["ctx.fs<br/>Filesystem provider seam"]
  pkg_fs_local["fs-local"]
  pkg_fs_policy["fs-policy"]
  pkg_compact["compact"]
  svc_compact["ctx.compact<br/>Compaction seam"]
  pkg_subagent["subagent"]
  svc_subagents["ctx.subagents<br/>Subagent provider and continuation service"]
  pkg_subagent_spawn["subagent-spawn"]
  pkg_subagent_fork["subagent-fork"]
  pkg_subagent_dsh_sdk["subagent-dsh-sdk"]
  pkg_tool_subagent_control["tool-subagent-control"]
  pkg_tool_ralph["tool-ralph"]
  pkg_tasks["tasks"]
  svc_tasks["ctx.tasks<br/>Background task registry"]
  pkg_tasks_local["tasks-local"]
  pkg_tool_tasks["tool-tasks"]
  pkg_web["web"]
  svc_web["ctx.web<br/>Web access provider registry"]
  pkg_web_search_exa["web-search-exa"]
  pkg_web_search_perplexity["web-search-perplexity"]
  pkg_web_search_deepseek["web-search-deepseek"]
  pkg_web_fetch_local["web-fetch-local"]
  pkg_spill["spill"]
  svc_spillStore["ctx.spillStore<br/>Spill storage seam"]
  pkg_spill_local["spill-local"]
  pkg_spill_policy["spill-policy"]
  pkg_directory_picker["directory-picker"]
  svc_directoryPicker["ctx.directoryPicker<br/>Workspace-directory picking seam"]
  pkg_directory_picker_native["directory-picker-native"]
  pkg_directory_picker_browse["directory-picker-browse"]
  pkg_webserver["webserver"]
  svc_httpServer["ctx.httpServer<br/>HTTP route registration"]
  pkg_connection["connection"]
  pkg_modules["modules"]
  pkg_hmr["hmr"]
  svc_clientModuleHost["ctx.clientModuleHost<br/>Client plugin graph host"]
  pkg_workflow["workflow"]
  svc_workflows["ctx.workflows<br/>Workflow script engine"]
  pkg_workflow_workerthread["workflow-workerthread"]
  pkg_tool_workflow["tool-workflow"]
  pkg_acp --> svc_approval
  pkg_agent --> svc_agents
  pkg_agent_default_model --> svc_agentDefaultModel
  pkg_agent_loop --> svc_agentLoop
  pkg_api_gateway --> svc_typertGateway
  pkg_approval --> svc_approval
  pkg_bash --> svc_bash
  pkg_bash_env --> svc_bashEnv
  pkg_bash_local --> svc_bash
  pkg_bash_sandbox --> svc_bash
  pkg_code_runtime --> svc_codeRuntime
  pkg_code_runtime_worker --> svc_codeRuntime
  pkg_commands --> svc_commands
  pkg_compact --> svc_compact
  pkg_compact_basic --> svc_compact
  pkg_compact_tool_result_prune --> svc_toolResultPrune
  pkg_credentials --> svc_credentials
  pkg_credentials_local --> svc_credentials
  pkg_directory_picker --> svc_directoryPicker
  pkg_directory_picker_browse --> svc_directoryPicker
  pkg_directory_picker_native --> svc_directoryPicker
  pkg_e2b --> svc_e2b
  pkg_fs --> svc_fs
  pkg_fs_e2b --> svc_fs
  pkg_fs_local --> svc_fs
  pkg_fs_sandbox --> svc_fs
  pkg_goal --> svc_goals
  pkg_invariants --> svc_invariants
  pkg_llm --> svc_llm
  pkg_llm_deepseek --> svc_llm
  pkg_llm_pi_ai --> svc_llm
  pkg_llm_replay --> svc_llm
  pkg_modules --> svc_clientModuleHost
  pkg_permission --> svc_permission
  pkg_plan_mode --> svc_planMode
  pkg_pty --> svc_pty
  pkg_pty_local --> svc_pty
  pkg_pwsh_local --> svc_bash
  pkg_sandbox --> svc_sandbox
  pkg_sandbox_local --> svc_sandbox
  pkg_sandbox_policy --> svc_sandboxPolicy
  pkg_session --> svc_sessions
  pkg_session_persistence --> svc_sessionPersistence
  pkg_session_persistence_jsonl --> svc_sessionPersistence
  pkg_session_persistence_sqlite --> svc_sessionPersistence
  pkg_session_projection --> svc_sessionProjections
  pkg_session_projection_cache --> svc_sessionProjectionCache
  pkg_session_query --> svc_sessionQuery
  pkg_session_query_sqlite --> svc_sessionQuery
  pkg_session_reference --> svc_sessionReferences
  pkg_session_telemetry --> svc_telemetry
  pkg_session_telemetry_otel --> svc_telemetry
  pkg_session_title --> svc_sessionTitle
  pkg_session_title_all_messages_llm --> svc_sessionTitle
  pkg_session_title_first_message_llm --> svc_sessionTitle
  pkg_settings --> svc_settings
  pkg_settings_local --> svc_settings
  pkg_skill --> svc_skills
  pkg_skill_badge --> svc_skills
  pkg_skill_local --> svc_skills
  pkg_spill --> svc_spillStore
  pkg_spill_local --> svc_spillStore
  pkg_storage --> svc_storage
  pkg_storage_domain --> svc_storageDomain
  pkg_storage_json --> svc_storage
  pkg_storage_sqlite --> svc_storage
  pkg_subagent --> svc_subagents
  pkg_subagent_acp --> svc_subagents
  pkg_subagent_claude_code --> svc_subagents
  pkg_subagent_codex --> svc_subagents
  pkg_subagent_dsh_sdk --> svc_subagents
  pkg_subagent_fork --> svc_subagents
  pkg_subagent_spawn --> svc_subagents
  pkg_subprocess --> svc_subprocess
  pkg_subprocess_e2b --> svc_subprocess
  pkg_subprocess_local --> svc_subprocess
  pkg_system_prompt --> svc_systemPrompt
  pkg_tasks --> svc_tasks
  pkg_tasks_local --> svc_tasks
  pkg_token_meter --> svc_tokenMeter
  pkg_tools --> svc_tools
  pkg_typert_registry --> svc_typert
  pkg_user_interaction --> svc_userInteraction
  pkg_web --> svc_web
  pkg_web_fetch_local --> svc_web
  pkg_web_search_deepseek --> svc_web
  pkg_web_search_exa --> svc_web
  pkg_web_search_perplexity --> svc_web
  pkg_webserver --> svc_httpServer
  pkg_workflow --> svc_workflows
  pkg_workflow_workerthread --> svc_workflows
  pkg_workspace --> svc_workspace
  svc_agentDefaultModel --> pkg_headless
  svc_agentDefaultModel --> pkg_host_apiproxy
  svc_agentLoop --> pkg_agent_spine_demo
  svc_agents --> pkg_acp
  svc_agents --> pkg_agent_loop
  svc_agents --> pkg_subagent_inprocess
  svc_approval --> pkg_tool_bash
  svc_approval --> pkg_tools
  svc_bash --> pkg_hooks_claude
  svc_bash --> pkg_hooks_codex
  svc_bash --> pkg_tool_bash
  svc_bash --> pkg_tool_pwsh
  svc_bashEnv --> pkg_tool_bash
  svc_bashEnv --> pkg_tool_pwsh
  svc_clientModuleHost --> pkg_hmr
  svc_codeRuntime --> pkg_tools
  svc_compact --> pkg_compact_basic
  svc_credentials --> pkg_apiproxy
  svc_credentials --> pkg_llm_deepseek
  svc_credentials --> pkg_llm_pi_ai
  svc_directoryPicker --> pkg_apiproxy
  svc_e2b --> pkg_fs_e2b
  svc_e2b --> pkg_subprocess_e2b
  svc_fs --> pkg_tool_fs
  svc_httpServer --> pkg_connection
  svc_httpServer --> pkg_hmr
  svc_httpServer --> pkg_modules
  svc_invariants --> pkg_agent
  svc_invariants --> pkg_agent_loop
  svc_invariants --> pkg_scope
  svc_invariants --> pkg_session
  svc_llm --> pkg_agent_loop
  svc_llm --> pkg_compact_basic
  svc_pty --> pkg_tool_pty
  svc_sandbox --> pkg_bash_sandbox
  svc_sandbox --> pkg_pty_local
  svc_sandboxPolicy --> pkg_bash_sandbox
  svc_sandboxPolicy --> pkg_fs_sandbox
  svc_sandboxPolicy --> pkg_pty_local
  svc_sessionPersistence --> pkg_agent_loop
  svc_sessionPersistence --> pkg_hooks_claude
  svc_sessionPersistence --> pkg_hooks_codex
  svc_sessionPersistence --> pkg_session_query
  svc_sessionPersistence --> pkg_session_query_sqlite
  svc_sessionPersistence --> pkg_tool_bash
  svc_sessionProjectionCache --> pkg_host_apiproxy
  svc_sessionProjections --> pkg_host_apiproxy
  svc_sessionProjections --> pkg_session_title
  svc_sessionProjections --> pkg_tool_todo
  svc_sessionQuery --> pkg_session_reference
  svc_sessionQuery --> pkg_tool_session_query
  svc_sessions --> pkg_agent
  svc_sessions --> pkg_agent_loop
  svc_sessions --> pkg_invariants
  svc_sessions --> pkg_session_persistence
  svc_sessions --> pkg_session_query
  svc_sessions --> pkg_session_query_sqlite
  svc_sessions --> pkg_subagent_inprocess
  svc_settings --> pkg_apiproxy
  svc_settings --> pkg_llm_deepseek
  svc_settings --> pkg_llm_pi_ai
  svc_skills --> pkg_tool_skill
  svc_spillStore --> pkg_spill_policy
  svc_storage --> pkg_storage_domain
  svc_storageDomain --> pkg_workspace
  svc_subagents --> pkg_tool_ralph
  svc_subagents --> pkg_tool_subagent
  svc_subagents --> pkg_tool_subagent_control
  svc_subprocess --> pkg_bash_local
  svc_subprocess --> pkg_bash_sandbox
  svc_subprocess --> pkg_lsp_local
  svc_subprocess --> pkg_pty_local
  svc_subprocess --> pkg_subagent_acp
  svc_subprocess --> pkg_subagent_claude_code
  svc_subprocess --> pkg_subagent_codex
  svc_systemPrompt --> pkg_agent_loop
  svc_systemPrompt --> pkg_tool_fs
  svc_systemPrompt --> pkg_tool_pty
  svc_systemPrompt --> pkg_tool_web
  svc_systemPrompt --> pkg_tools
  svc_tasks --> pkg_tool_bash
  svc_tasks --> pkg_tool_pty
  svc_tasks --> pkg_tool_subagent
  svc_tasks --> pkg_tool_tasks
  svc_tokenMeter --> pkg_compact_basic
  svc_toolResultPrune --> pkg_compact_basic
  svc_tools --> pkg_agent_loop
  svc_tools --> pkg_tool_ask_user
  svc_tools --> pkg_tool_bash
  svc_tools --> pkg_tool_cordis
  svc_tools --> pkg_tool_fs
  svc_tools --> pkg_tool_pty
  svc_tools --> pkg_tool_skill
  svc_tools --> pkg_tool_subagent
  svc_tools --> pkg_tool_todo
  svc_tools --> pkg_tool_web
  svc_typert --> pkg_api_gateway
  svc_typert --> pkg_typert_loader
  svc_userInteraction --> pkg_tool_ask_user
  svc_web --> pkg_tool_web
  svc_workflows --> pkg_tool_ralph
  svc_workflows --> pkg_tool_workflow
  svc_workspace --> pkg_apiproxy
  svc_fs -. event gate .-> pkg_fs_policy
```

| ctx 键 | 角色 | 所属包 | 实现 | 直接消费方 | 配套插件 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `ctx.llm` | `seam` | [`llm`](../packages/llm/llm) | [`llm-deepseek`](../packages/llm/llm-deepseek)、[`llm-pi-ai`](../packages/llm/llm-pi-ai)、[`llm-replay`](../packages/support/llm-replay) | [`agent-loop`](../packages/core/agent-loop)、[`compact-basic`](../packages/compact/compact-basic) | - | 适配器注册提供方实现；agent loop（智能体循环）与压缩功能调用提供方无关的流服务。 |
| `ctx.tokenMeter` | `core` | [`token-meter`](../packages/llm/token-meter) | - | [`compact-basic`](../packages/compact/compact-basic) | - | 拥有按会话隔离的回放折叠区；压力消费方共享不可变且带修订版本的测量结果。 |
| `ctx.toolResultPrune` | `core` | [`compact-tool-result-prune`](../packages/compact/compact-tool-result-prune) | - | [`compact-basic`](../packages/compact/compact-basic) | - | 在摘要压缩前，通过可回放的单节点表层替换来改写过大的当前工具结果。 |
| `ctx.sessions` | `core` | [`session`](../packages/core/session) | - | [`agent-loop`](../packages/core/agent-loop)、[`agent`](../packages/core/agent)、[`session-persistence`](../packages/session/session-persistence)、[`session-query`](../packages/session-query/session-query)、[`session-query-sqlite`](../packages/session-query/session-query-sqlite)、[`subagent-inprocess`](../packages/subagent/subagent-inprocess)、[`invariants`](../packages/support/invariants) | - | 拥有仅追加的 Session 实例，并发出持久的会话事件流。 |
| `ctx.invariants` | `core` | [`invariants`](../packages/support/invariants) | - | [`session`](../packages/core/session)、[`agent`](../packages/core/agent)、[`scope`](../packages/core/scope)、[`agent-loop`](../packages/core/agent-loop) | - | 配套子路径注册所属包本地的检查；该服务负责选择、唯一性、子 fiber，以及标明所属包的失败。 |
| `ctx.typert` | `core` | [`typert-registry`](../packages/typert/registry) | - | [`typert-loader`](../packages/typert/loader)、[`api-gateway`](../packages/api/gateway) | - | 插件直接或通过 dsh-typert-loader 注册实时 zod 贡献；API 网关消费调用描述符和提供方，其他运行时消费方则在各自边界查询 schema 与反射元数据。 |
| `ctx.typertGateway` | `core` | [`api-gateway`](../packages/api/gateway) | - | - | - | 将生成的 Remote 描述符与实时 Cordis 服务关联，解析已注册的身份，并通过共享的 Connection RPC 载体提供一元调用。 |
| `ctx.sessionPersistence` | `seam` | [`session-persistence`](../packages/session/session-persistence) | [`session-persistence-jsonl`](../packages/session/session-persistence-jsonl)、[`session-persistence-sqlite`](../packages/session/session-persistence-sqlite) | [`agent-loop`](../packages/core/agent-loop)、[`tool-bash`](../packages/bash/tool-bash)、[`hooks-claude`](../packages/hooks/hooks-claude)、[`hooks-codex`](../packages/hooks/hooks-codex)、[`session-query`](../packages/session-query/session-query)、[`session-query-sqlite`](../packages/session-query/session-query-sqlite) | - | 各后端持久化同一套 SessionEvent 词汇；应用在组合时选择后端。 |
| `ctx.settings` | `seam` | [`settings`](../packages/settings/settings) | [`settings-local`](../packages/settings/settings-local) | [`llm-deepseek`](../packages/llm/llm-deepseek)、[`llm-pi-ai`](../packages/llm/llm-pi-ai)、`apiproxy` | - | 插件注册命名空间 schema 并解析分层值；提供方存储原始文档。LLM（大语言模型）适配器在用户分区下将其入口配置注册为组合基础；Web 网关提供经过脱敏的分层描述符，并写入用户层。 |
| `ctx.credentials` | `seam` | [`credentials`](../packages/credentials/credentials) | [`credentials-local`](../packages/credentials/credentials-local) | [`llm-deepseek`](../packages/llm/llm-deepseek)、[`llm-pi-ai`](../packages/llm/llm-pi-ai)、`apiproxy` | - | 配置携带对机密信息的引用；提供方拥有实际值。消费方按操作解析，因此轮换后的凭据会在紧接着的下一次请求中生效；Web 网关提供不含实际值的视图和只写存储。 |
| `ctx.telemetry` | `seam` | [`session-telemetry`](../packages/session/session-telemetry) | [`session-telemetry-otel`](../packages/session/session-telemetry-otel) | - | - | 该 seam 捕获会话记录、进行脱敏并交给一个后端；没有其他组件消费该服务，其输出会离开当前进程。 |
| `ctx.storage` | `seam` | [`storage`](../packages/storage/storage) | [`storage-json`](../packages/storage/storage-json)、[`storage-sqlite`](../packages/storage/storage-sqlite) | [`storage-domain`](../packages/storage/storage-domain) | - | 各后端以不同名称并列注册；数据形态（领域优先）挂载到枢纽上，并将类型化操作转换为不透明的 KV 单元原语。 |
| `ctx.storageDomain` | `core` | [`storage-domain`](../packages/storage/storage-domain) | - | [`workspace`](../packages/workspace/workspace) | - | 等待所有已配置后端就绪，然后将领域形态发布为一个受生命周期约束的服务，用于类型化持久状态。 |
| `ctx.workspace` | `core` | [`workspace`](../packages/workspace/workspace) | - | `apiproxy` | - | 通过领域设施拥有带 WorkspaceId 品牌类型的记录；稳定的 sessionIds 账户驱动 Host RPC 与 GUI 投影。 |
| `ctx.sessionQuery` | `seam` | [`session-query`](../packages/session-query/session-query) | [`session-query-sqlite`](../packages/session-query/session-query-sqlite) | [`session-reference`](../packages/context/session-reference)、[`tool-session-query`](../packages/session-query/tool-session-query) | - | 该接口提供精确读取、过滤和追踪；具体后端还提供全文协调、排序、摘要片段和游标世代，而模型消费方负责工作区权限与不含游标的渲染。 |
| `ctx.sessionReferences` | `core` | [`session-reference`](../packages/context/session-reference) | - | - | - | 将当前表层中有界的对话快照投影为持久但不可信的消息上下文；Host 适配器负责提及语法。 |
| `ctx.sessionTitle` | `seam` | [`session-title`](../packages/session/session-title) | [`session-title-first-message-llm`](../packages/session/session-title-first-message-llm)、[`session-title-all-messages-llm`](../packages/session/session-title-all-messages-llm) | - | - | 负责确定性回退、最新标题折叠区，以及唯一的可选异步提供方注册。 |
| `ctx.systemPrompt` | `core` | [`system-prompt`](../packages/core/system-prompt) | - | [`agent-loop`](../packages/core/agent-loop)、[`tools`](../packages/core/tools)、[`tool-fs`](../packages/fs/tool-fs)、[`tool-pty`](../packages/pty/tool-pty)、[`tool-web`](../packages/web/tool-web) | - | 为每个步骤收集提示词各部分和面向模型的工具 schema。 |
| `ctx.tools` | `core` | [`tools`](../packages/core/tools) | - | [`agent-loop`](../packages/core/agent-loop)、[`tool-ask-user`](../packages/interaction/tool-ask-user)、[`tool-bash`](../packages/bash/tool-bash)、[`tool-cordis`](../packages/self-modification/tool-cordis)、[`tool-fs`](../packages/fs/tool-fs)、[`tool-pty`](../packages/pty/tool-pty)、[`tool-skill`](../packages/skill/tool-skill)、[`tool-subagent`](../packages/subagent/tool-subagent)、[`tool-todo`](../packages/todo/tool-todo)、[`tool-web`](../packages/web/tool-web) | - | 注册能力，负责 Code Mode 传输，并让调用依次经过策略前处理、单调守卫、环绕分派、策略后处理和最终结果观测。 |
| `ctx.userInteraction` | `seam` | [`user-interaction`](../packages/interaction/user-interaction) | - | [`tool-ask-user`](../packages/interaction/tool-ask-user) | - | UI 入口提供当前生效的人工回答提供方；tool-ask-user 在提供方无关的 ask() promise 上暂停工具调用。 |
| `ctx.planMode` | `core` | [`plan-mode`](../packages/plan/plan-mode) | - | - | - | 折叠已记录的计划／模式状态，在轮次边界刷新用户选择，渲染由部署方拥有的指导信息，注册 /plan，并在状态转换期间保持计划退出 schema 稳定。 |
| `ctx.commands` | `core` | [`commands`](../packages/interaction/commands) | - | - | - | 插件注册直接面向人的命令，而不会把调用发送给模型。 |
| `ctx.sessionProjections` | `core` | [`session-projection`](../packages/session/session-projection) | - | [`tool-todo`](../packages/todo/tool-todo)、[`session-title`](../packages/session/session-title)、[`host-apiproxy`](../packages/host/apiproxy) | - | 各领域注册由状态驱动的折叠单元；主动驱动过程维护每个会话的水位状态，api-proxy 提供基线并推送发生变化的值。 |
| `ctx.sessionProjectionCache` | `core` | [`session-projection-cache`](../packages/session/session-projection-cache) | - | [`host-apiproxy`](../packages/host/apiproxy) | - | 按会话持久保存投影单元状态的检查点（节流检查点，以及轮次／结束／分离时的必选检查点），并提供冷读取阶梯：缓存行加持久化尾部回放，因此列表读取永远不需要加载完整日志。 |
| `ctx.skills` | `seam` | [`skill`](../packages/skill/skill) | [`skill-badge`](../packages/skill/skill-badge)、[`skill-local`](../packages/skill/skill-local) | [`tool-skill`](../packages/skill/tool-skill) | - | 合并提供方的 skill（技能）目录；tool-skill 渲染会话前缀目录，并加载完整的 skill 正文。 |
| `ctx.agents` | `core` | [`agent`](../packages/core/agent) | - | [`agent-loop`](../packages/core/agent-loop)、[`acp`](../packages/acp/acp)、[`subagent-inprocess`](../packages/subagent/subagent-inprocess) | - | 拥有实时 Agent 句柄、创建／恢复工厂 seam，以及进程本地的发起方传播。 |
| `ctx.agentDefaultModel` | `core` | [`agent-default-model`](../packages/core/agent-default-model) | - | [`headless`](../packages/bundle/headless)、[`host-apiproxy`](../packages/host/apiproxy) | - | 通过 settings 分层默认 `ModelSelection`，让直接前门与 Host 支撑的 Agent 前门共享同一个状态所有者。 |
| `ctx.agentLoop` | `bundle` | [`agent-loop`](../packages/core/agent-loop) | - | [`agent-spine-demo`](../packages/examples/agent-spine-demo) | - | 唯一的具体循环插件；扩展包依赖 dsh-agent 的事件和服务，而不依赖此包。 |
| `ctx.goals` | `core` | [`goal`](../packages/goal/goal) | - | - | - | 从会话日志折叠带修订版本的目标状态，并将实时延续激活保留在进程本地。 |
| `ctx.e2b` | `core` | [`e2b`](../packages/e2b/e2b) | - | [`fs-e2b`](../packages/e2b/fs-e2b)、[`subprocess-e2b`](../packages/e2b/subprocess-e2b) | - | 拥有一个共享的 E2B SDK 句柄、远程工作目录和最终沙箱处置，使两个基础 E2B 提供方处于同一个 Linux 运行时中。 |
| `ctx.subprocess` | `seam` | [`subprocess`](../packages/subprocess/subprocess) | [`subprocess-local`](../packages/subprocess/subprocess-local)、[`subprocess-e2b`](../packages/e2b/subprocess-e2b) | [`bash-local`](../packages/bash/bash-local)、[`bash-sandbox`](../packages/bash/bash-sandbox)、[`pty-local`](../packages/pty/pty-local)、[`lsp-local`](../packages/lsp/lsp-local)、[`subagent-acp`](../packages/subagent/subagent-acp)、[`subagent-codex`](../packages/subagent/subagent-codex)、[`subagent-claude-code`](../packages/subagent/subagent-claude-code) | - | Bash 执行器、PTY shell 后端、LSP Host，以及进程外 ACP、Codex 和 Claude Code subagent 后端都通过 ctx.subprocess 执行 spawn；该服务负责进程坐标、进程树／会话生命周期、stdio 处置、终端机制和 kill 升级。 |
| `ctx.bash` | `seam` | [`bash`](../packages/bash/bash) | [`bash-local`](../packages/bash/bash-local)、[`bash-sandbox`](../packages/bash/bash-sandbox)、[`pwsh-local`](../packages/bash/pwsh-local) | [`tool-bash`](../packages/bash/tool-bash)、[`tool-pwsh`](../packages/bash/tool-pwsh)、[`hooks-claude`](../packages/hooks/hooks-claude)、[`hooks-codex`](../packages/hooks/hooks-codex) | - | 面向模型的 shell 工具和钩子桥接消费此 seam；沙箱、远程或 PowerShell 执行器可以替换 bash-local，而无需改动这些消费方。 |
| `ctx.bashEnv` | `core` | [`bash-env`](../packages/bash/bash-env) | - | [`tool-bash`](../packages/bash/tool-bash)、[`tool-pwsh`](../packages/bash/tool-pwsh) | - | 插件声明限定于 effect 作用域的 DSH_* 事实；每个 shell 工具在每次执行时收集一份可信快照，其执行器据此重建命名空间。 |
| `ctx.pty` | `seam` | [`pty`](../packages/pty/pty) | [`pty-local`](../packages/pty/pty-local) | [`tool-pty`](../packages/pty/tool-pty) | - | 注册表负责精确到 Agent 的会话身份和清理；后端负责终端机制，tool-pty 则提供限定于所有者作用域的模型接口。 |
| `ctx.sandbox` | `seam` | [`sandbox`](../packages/sandbox/sandbox) | [`sandbox-local`](../packages/sandbox/sandbox-local) | [`bash-sandbox`](../packages/bash/bash-sandbox)、[`pty-local`](../packages/pty/pty-local) | - | 消费方交出即将执行 spawn 的确切 argv；与宿主共享文件系统和内核的后端按每次调用的策略包装该 argv，并报告强制执行情况。 |
| `ctx.sandboxPolicy` | `core` | [`sandbox-policy`](../packages/sandbox/sandbox-policy) | - | [`bash-sandbox`](../packages/bash/bash-sandbox)、[`fs-sandbox`](../packages/fs/fs-sandbox)、[`pty-local`](../packages/pty/pty-local) | - | 统一保存部署默认模式和工作区根目录；只有沙箱执行器和提供方读取该服务（工具层使用它同时导出的纯 `sandbox/mode` 折叠区）。两类强制执行组件都读取该服务，因此 bash 与 fs 不会限制到不同的根目录。 |
| `ctx.approval` | `seam` | `approval` | [`acp`](../packages/acp/acp) | [`tools`](../packages/core/tools)、[`tool-bash`](../packages/bash/tool-bash) | - | 一次性权限决策通过 `approval/request` waterfall（瀑布式事件）分派；回答方是监听器（即 ACP 为自身 agent 提供的桥接），没有回答方时以 `unavailable` 关闭失败。 |
| `ctx.permission` | `core` | [`permission`](../packages/interaction/permission) | - | - | - | 面向用户的预设表（`workspace-write`／`danger-full-access`），将沙箱模式与审批策略选项组合在一起；一次切换会写入一个 `permission/preset` 事件，并贯通到两个选项事件。 |
| `ctx.codeRuntime` | `seam` | [`code-runtime`](../packages/code-runtime/code-runtime) | [`code-runtime-worker`](../packages/code-runtime/code-runtime-worker) | [`tools`](../packages/core/tools) | - | 使用 Host 提供的异步绑定运行一段由模型编写的程序；各后端采用不同的基础环境和语言（工具注册表在 Code Mode 下消费该服务）。 |
| `ctx.fs` | `seam` | [`fs`](../packages/fs/fs) | [`fs-local`](../packages/fs/fs-local)、[`fs-sandbox`](../packages/fs/fs-sandbox)、[`fs-e2b`](../packages/e2b/fs-e2b) | [`tool-fs`](../packages/fs/tool-fs) | [`fs-policy`](../packages/fs/fs-policy) | tool-fs 通过 ctx.fs 执行读取／写入／编辑；fs-sandbox 按共享沙箱模式限制变更；fs-policy 通过 fs/* 事件门禁贡献基于观测状态的检查。 |
| `ctx.compact` | `seam` | [`compact`](../packages/compact/compact) | [`compact-basic`](../packages/compact/compact-basic) | [`compact-basic`](../packages/compact/compact-basic) | - | 基础后端消费步骤后的压力事件和请求错误恢复事件；面向模型的压缩工具仍处于暂缓状态。 |
| `ctx.subagents` | `seam` | [`subagent`](../packages/subagent/subagent) | [`subagent-spawn`](../packages/subagent/subagent-spawn)、[`subagent-fork`](../packages/subagent/subagent-fork)、[`subagent-acp`](../packages/subagent/subagent-acp)、[`subagent-codex`](../packages/subagent/subagent-codex)、[`subagent-claude-code`](../packages/subagent/subagent-claude-code)、[`subagent-dsh-sdk`](../packages/subagent/subagent-dsh-sdk) | [`tool-subagent`](../packages/subagent/tool-subagent)、[`tool-subagent-control`](../packages/subagent/tool-subagent-control)、[`tool-ralph`](../packages/workflow/tool-ralph) | - | 提供方实现传输；该服务还负责可选的、基于 Activation 的延续编排，tool-subagent 选择一次性或可延续委派，tool-subagent-control 传递后续消息，而 tool-ralph 要求一条全新的结构化输出路由。 |
| `ctx.tasks` | `seam` | [`tasks`](../packages/tasks/tasks) | [`tasks-local`](../packages/tasks/tasks-local) | [`tool-bash`](../packages/bash/tool-bash)、[`tool-pty`](../packages/pty/tool-pty)、[`tool-subagent`](../packages/subagent/tool-subagent)、[`tool-tasks`](../packages/tasks/tool-tasks) | - | 生产方（后台 bash、PTY 发送和 subagent 委派）登记正在运行的工作；tool-tasks 是面向模型的控制接口，用于读取、列出和终止这些工作；tasks-local 是进程本地注册表。 |
| `ctx.web` | `seam` | [`web`](../packages/web/web) | [`web-search-exa`](../packages/web/web-search-exa)、[`web-search-perplexity`](../packages/web/web-search-perplexity)、[`web-search-deepseek`](../packages/web/web-search-deepseek)、[`web-fetch-local`](../packages/web/web-fetch-local) | [`tool-web`](../packages/web/tool-web) | - | 搜索和抓取提供方注册到同一个 ctx.web seam；tool-web 负责稳定的面向模型名称。 |
| `ctx.spillStore` | `seam` | [`spill`](../packages/spill/spill) | [`spill-local`](../packages/spill/spill-local) | [`spill-policy`](../packages/spill/spill-policy) | - | 后端保存过大的工具文本，并返回面向模型的定位信息和取回提示；spill-policy 是 tools/post-execute 消费方，负责决定何时 spill。 |
| `ctx.directoryPicker` | `seam` | `directory-picker` | `directory-picker-native`、`directory-picker-browse` | `apiproxy` | - | 带判别标记的交互能力：原生后端在 Host 显示设备上打开一个操作系统选择器，浏览后端为应用内浏览器提供列表与创建原语；双端后端通过其浏览器侧填充 ui-workspace 目录流程的 slot（不通过协议发布）。 |
| `ctx.httpServer` | `core` | `webserver` | - | `connection`、`modules`、`hmr` | - | 普通的 node:http 载体：具名路由注册表、索引转换 tap，以及静态 dist 回退；Web 传输插件注册自己的路由。 |
| `ctx.clientModuleHost` | `core` | `modules` | - | `hmr` | - | 通过增量 dshClient 扫描组合 __DSH_BOOT__ 入口图，提供插件组合包，并通知重建／图变更订阅方。 |
| `ctx.workflows` | `seam` | [`workflow`](../packages/workflow/workflow) | [`workflow-workerthread`](../packages/workflow/workflow-workerthread) | [`tool-workflow`](../packages/workflow/tool-workflow)、[`tool-ralph`](../packages/workflow/tool-ralph) | - | 每个上下文使用一个引擎（bash 形态，无具名提供方注册表）；通用工作流与固定 Ralph 消费方启动运行，其中的 agent() 调用通过 ctx.subagents 扇出。 |

维护模式：混合模式。服务从 Cordis 声明中发现；接口、实现和消费方角色在 `scripts/gen-doc-graphs.ts` 中分类，并设有完整性守卫。
