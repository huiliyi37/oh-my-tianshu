<!-- 英文源文件由 scripts/gen-module-graph.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-module-graph` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/module-graph.md` 重新记录配对。 -->

# 模块依赖关系图

[English](module-graph.md) | 中文

`@huiliyi37/dsh-*` harness 包之间的依赖关系。该关系图根据各包的 `peerDependencies`（规范的运行时依赖信号）生成，并按 `packages/<group>/<pkg>` 层级分组。边 `a --> b` 表示包 `a` 依赖包 `b`。名称中的 `@huiliyi37/dsh-` 前缀已移除。

```mermaid
flowchart TD
  subgraph group_util["packages/util"]
    pkg_atomic_write["atomic-write"]
    pkg_brand["brand"]
    pkg_environment["environment"]
    pkg_native_command["native-command"]
    pkg_paths["paths"]
    pkg_retention["retention"]
    pkg_timeout["timeout"]
  end
  subgraph group_llm["packages/llm"]
    pkg_cache_diagnostic["cache-diagnostic"]
    pkg_llm["llm"]
    pkg_llm_deepseek["llm-deepseek"]
    pkg_llm_pi_ai["llm-pi-ai"]
    pkg_llm_retry["llm-retry"]
    pkg_token_meter["token-meter"]
    pkg_tool_json_repair["tool-json-repair"]
  end
  subgraph group_core["packages/core"]
    pkg_agent["agent"]
    pkg_agent_default_model["agent-default-model"]
    pkg_agent_loop["agent-loop"]
    pkg_agent_tool_presentation["agent-tool-presentation"]
    pkg_model_roles["model-roles"]
    pkg_scope["scope"]
    pkg_session["session"]
    pkg_system_prompt["system-prompt"]
    pkg_tools["tools"]
  end
  subgraph group_goal["packages/goal"]
    pkg_command_goal["command-goal"]
    pkg_goal["goal"]
    pkg_goal_session["goal-session"]
    pkg_tool_goal["tool-goal"]
  end
  subgraph group_bash["packages/bash"]
    pkg_bash["bash"]
    pkg_bash_env["bash-env"]
    pkg_bash_local["bash-local"]
    pkg_bash_sandbox["bash-sandbox"]
    pkg_pwsh_local["pwsh-local"]
    pkg_pwsh_sandbox["pwsh-sandbox"]
    pkg_tool_bash["tool-bash"]
    pkg_tool_pwsh["tool-pwsh"]
  end
  subgraph group_fs["packages/fs"]
    pkg_fs["fs"]
    pkg_fs_local["fs-local"]
    pkg_fs_policy["fs-policy"]
    pkg_fs_sandbox["fs-sandbox"]
    pkg_fs_snapshot["fs-snapshot"]
    pkg_tool_file_info["tool-file-info"]
    pkg_tool_fs["tool-fs"]
    pkg_tool_fs_search["tool-fs-search"]
    pkg_tool_str_replace_editor["tool-str-replace-editor"]
  end
  subgraph group_skill["packages/skill"]
    pkg_skill["skill"]
    pkg_skill_badge["skill-badge"]
    pkg_skill_local["skill-local"]
    pkg_tool_skill["tool-skill"]
  end
  subgraph group_compact["packages/compact"]
    pkg_command_compact["command-compact"]
    pkg_compact["compact"]
    pkg_compact_basic["compact-basic"]
    pkg_compact_tool_result_prune["compact-tool-result-prune"]
  end
  subgraph group_subagent["packages/subagent"]
    pkg_agent_definitions["agent-definitions"]
    pkg_subagent["subagent"]
    pkg_subagent_acp["subagent-acp"]
    pkg_subagent_claude_code["subagent-claude-code"]
    pkg_subagent_codex["subagent-codex"]
    pkg_subagent_dsh_sdk["subagent-dsh-sdk"]
    pkg_subagent_fork["subagent-fork"]
    pkg_subagent_inprocess["subagent-inprocess"]
    pkg_subagent_spawn["subagent-spawn"]
    pkg_tool_subagent["tool-subagent"]
    pkg_tool_subagent_control["tool-subagent-control"]
    pkg_tool_subagent_report["tool-subagent-report"]
  end
  subgraph group_web["packages/web"]
    pkg_tool_web["tool-web"]
    pkg_web["web"]
    pkg_web_fetch_local["web-fetch-local"]
    pkg_web_search_deepseek["web-search-deepseek"]
    pkg_web_search_exa["web-search-exa"]
    pkg_web_search_perplexity["web-search-perplexity"]
  end
  subgraph group_spill["packages/spill"]
    pkg_spill["spill"]
    pkg_spill_local["spill-local"]
    pkg_spill_policy["spill-policy"]
  end
  subgraph group_todo["packages/todo"]
    pkg_tool_todo["tool-todo"]
  end
  subgraph group_plan["packages/plan"]
    pkg_plan_mode["plan-mode"]
  end
  subgraph group_hooks["packages/hooks"]
    pkg_hook_protocol["hook-protocol"]
    pkg_hooks_claude["hooks-claude"]
    pkg_hooks_codex["hooks-codex"]
  end
  subgraph group_session_query["packages/session-query"]
    pkg_session_query["session-query"]
    pkg_session_query_sqlite["session-query-sqlite"]
    pkg_tool_session_query["tool-session-query"]
  end
  subgraph group_support["packages/support"]
    pkg_acp_snapshot["acp-snapshot"]
    pkg_agent_loop_testkit["agent-loop-testkit"]
    pkg_invariants["invariants"]
    pkg_llm_mock_server["llm-mock-server"]
    pkg_llm_replay["llm-replay"]
    pkg_loader_smoke["loader-smoke"]
  end
  subgraph group_acp["packages/acp"]
    pkg_acp["acp"]
  end
  subgraph group_api["packages/api"]
    pkg_api_gateway["api-gateway"]
    pkg_api_remotes["api-remotes"]
  end
  subgraph group_attachment["packages/attachment"]
    pkg_attachment["attachment"]
    pkg_attachment_local["attachment-local"]
  end
  subgraph group_boot["packages/boot"]
    pkg_app_boot["app-boot"]
  end
  subgraph group_bundle["packages/bundle"]
    pkg_base["base"]
    pkg_headless["headless"]
    pkg_web_app["web-app"]
  end
  subgraph group_client["packages/client"]
    pkg_client_connection["client-connection"]
    pkg_client_hmr["client-hmr"]
    pkg_client_locale["client-locale"]
    pkg_client_modules["client-modules"]
    pkg_client_runtime["client-runtime"]
    pkg_client_schema_form["client-schema-form"]
    pkg_client_test_runtime["client-test-runtime"]
    pkg_client_ui_command["client-ui-command"]
    pkg_client_ui_conversation["client-ui-conversation"]
    pkg_client_ui_deliverables["client-ui-deliverables"]
    pkg_client_ui_goal["client-ui-goal"]
    pkg_client_ui_input_trigger["client-ui-input-trigger"]
    pkg_client_ui_layout["client-ui-layout"]
    pkg_client_ui_model["client-ui-model"]
    pkg_client_ui_models["client-ui-models"]
    pkg_client_ui_permission["client-ui-permission"]
    pkg_client_ui_plan["client-ui-plan"]
    pkg_client_ui_primitives["client-ui-primitives"]
    pkg_client_ui_question["client-ui-question"]
    pkg_client_ui_settings["client-ui-settings"]
    pkg_client_ui_settings_general["client-ui-settings-general"]
    pkg_client_ui_sidebar["client-ui-sidebar"]
    pkg_client_ui_skill["client-ui-skill"]
    pkg_client_ui_slash["client-ui-slash"]
    pkg_client_ui_slots["client-ui-slots"]
    pkg_client_ui_subagent["client-ui-subagent"]
    pkg_client_ui_theme["client-ui-theme"]
    pkg_client_ui_tool["client-ui-tool"]
    pkg_client_ui_trajectory["client-ui-trajectory"]
    pkg_client_ui_workspace["client-ui-workspace"]
    pkg_client_web["client-web"]
    pkg_client_web_react["client-web-react"]
  end
  subgraph group_code_runtime["packages/code-runtime"]
    pkg_code_runtime["code-runtime"]
    pkg_code_runtime_python["code-runtime-python"]
    pkg_code_runtime_worker["code-runtime-worker"]
  end
  subgraph group_context["packages/context"]
    pkg_session_reference["session-reference"]
    pkg_spark_anchors["spark-anchors"]
    pkg_time_context["time-context"]
    pkg_tmux_context["tmux-context"]
    pkg_vision_bridge["vision-bridge"]
    pkg_workspace_context["workspace-context"]
  end
  subgraph group_credentials["packages/credentials"]
    pkg_authorization["authorization"]
    pkg_credentials["credentials"]
    pkg_credentials_local["credentials-local"]
  end
  subgraph group_e2b["packages/e2b"]
    pkg_e2b["e2b"]
    pkg_fs_e2b["fs-e2b"]
    pkg_subprocess_e2b["subprocess-e2b"]
  end
  subgraph group_examples["packages/examples"]
    pkg_acp_demo["acp-demo"]
    pkg_agent_spine_demo["agent-spine-demo"]
    pkg_jsonrpc_demo["jsonrpc-demo"]
  end
  subgraph group_feedback["packages/feedback"]
    pkg_command_feedback["command-feedback"]
    pkg_message_feedback["message-feedback"]
  end
  subgraph group_git["packages/git"]
    pkg_git["git"]
    pkg_tool_git["tool-git"]
  end
  subgraph group_guard["packages/guard"]
    pkg_agent_router["agent-router"]
    pkg_doom_loop_guard["doom-loop-guard"]
    pkg_evidence_gate["evidence-gate"]
    pkg_intent_bridge["intent-bridge"]
    pkg_pheromone["pheromone"]
    pkg_repeat_tool_guard["repeat-tool-guard"]
    pkg_task_card["task-card"]
    pkg_timeout_policy["timeout-policy"]
    pkg_zen["zen"]
  end
  subgraph group_host["packages/host"]
    pkg_frontend_static["frontend-static"]
    pkg_host_apiproxy["host-apiproxy"]
    pkg_host_directory_picker["host-directory-picker"]
    pkg_host_directory_picker_auto["host-directory-picker-auto"]
    pkg_host_directory_picker_browse["host-directory-picker-browse"]
    pkg_host_directory_picker_native["host-directory-picker-native"]
    pkg_host_plugin_inventory["host-plugin-inventory"]
    pkg_host_webserver["host-webserver"]
  end
  subgraph group_identity["packages/identity"]
    pkg_anonymous_user_id["anonymous-user-id"]
  end
  subgraph group_interaction["packages/interaction"]
    pkg_approval_rules["approval-rules"]
    pkg_command_files["command-files"]
    pkg_commands["commands"]
    pkg_output_style["output-style"]
    pkg_permission["permission"]
    pkg_tool_ask_user["tool-ask-user"]
    pkg_user_approval["user-approval"]
    pkg_user_interaction["user-interaction"]
  end
  subgraph group_lsp["packages/lsp"]
    pkg_lsp["lsp"]
    pkg_lsp_local["lsp-local"]
    pkg_tool_lsp["tool-lsp"]
  end
  subgraph group_mcp["packages/mcp"]
    pkg_mcp_client["mcp-client"]
  end
  subgraph group_memory["packages/memory"]
    pkg_adaptive_memory["adaptive-memory"]
    pkg_command_memory["command-memory"]
    pkg_memory["memory"]
    pkg_memory_consolidate["memory-consolidate"]
    pkg_memory_pipeline["memory-pipeline"]
    pkg_memory_sqlite["memory-sqlite"]
    pkg_tool_memory["tool-memory"]
    pkg_tool_memory_recall["tool-memory-recall"]
  end
  subgraph group_preset["packages/preset"]
    pkg_agent_presets["agent-presets"]
    pkg_persona["persona"]
  end
  subgraph group_pty["packages/pty"]
    pkg_pty["pty"]
    pkg_pty_local["pty-local"]
    pkg_tool_bash_persistent["tool-bash-persistent"]
    pkg_tool_pty["tool-pty"]
    pkg_tool_pwsh_persistent["tool-pwsh-persistent"]
  end
  subgraph group_sandbox["packages/sandbox"]
    pkg_sandbox["sandbox"]
    pkg_sandbox_local["sandbox-local"]
    pkg_sandbox_policy["sandbox-policy"]
    pkg_sandbox_windows_acl["sandbox-windows-acl"]
  end
  subgraph group_scaffold["packages/scaffold"]
    pkg_jsonrpc["jsonrpc"]
    pkg_sdk_client["sdk-client"]
    pkg_sdk_protocol["sdk-protocol"]
  end
  subgraph group_schedule["packages/schedule"]
    pkg_schedule["schedule"]
  end
  subgraph group_search["packages/search"]
    pkg_meridian["meridian"]
    pkg_semantic_index["semantic-index"]
    pkg_tool_meridian["tool-meridian"]
    pkg_tool_semantic_search["tool-semantic-search"]
  end
  subgraph group_self_modification["packages/self-modification"]
    pkg_cordis_client_runner["cordis-client-runner"]
    pkg_cordis_host_runner["cordis-host-runner"]
    pkg_tool_cordis["tool-cordis"]
    pkg_ui_cordis["ui-cordis"]
  end
  subgraph group_session["packages/session"]
    pkg_session_checkpoint_policy["session-checkpoint-policy"]
    pkg_session_persistence["session-persistence"]
    pkg_session_persistence_jsonl["session-persistence-jsonl"]
    pkg_session_persistence_sqlite["session-persistence-sqlite"]
    pkg_session_projection["session-projection"]
    pkg_session_projection_cache["session-projection-cache"]
    pkg_session_stats["session-stats"]
    pkg_session_telemetry["session-telemetry"]
    pkg_session_telemetry_otel["session-telemetry-otel"]
    pkg_session_title["session-title"]
    pkg_session_title_all_messages_llm["session-title-all-messages-llm"]
    pkg_session_title_first_message_llm["session-title-first-message-llm"]
    pkg_session_title_llm["session-title-llm"]
  end
  subgraph group_settings["packages/settings"]
    pkg_settings["settings"]
    pkg_settings_local["settings-local"]
  end
  subgraph group_storage["packages/storage"]
    pkg_storage["storage"]
    pkg_storage_domain["storage-domain"]
    pkg_storage_json["storage-json"]
    pkg_storage_sqlite["storage-sqlite"]
  end
  subgraph group_subprocess["packages/subprocess"]
    pkg_subprocess["subprocess"]
    pkg_subprocess_local["subprocess-local"]
  end
  subgraph group_tasks["packages/tasks"]
    pkg_tasks["tasks"]
    pkg_tasks_local["tasks-local"]
    pkg_tool_tasks["tool-tasks"]
  end
  subgraph group_tests["packages/tests"]
    pkg_tool_run_tests["tool-run-tests"]
  end
  subgraph group_tui["packages/tui"]
    pkg_tui["tui"]
    pkg_vision_ask["vision-ask"]
  end
  subgraph group_typert["packages/typert"]
    pkg_type_meta["type-meta"]
    pkg_typert_generator["typert-generator"]
    pkg_typert_loader["typert-loader"]
    pkg_typert_registry["typert-registry"]
  end
  subgraph group_workflow["packages/workflow"]
    pkg_next_workflow["next-workflow"]
    pkg_tool_ralph["tool-ralph"]
    pkg_tool_workflow["tool-workflow"]
    pkg_workflow["workflow"]
    pkg_workflow_workerthread["workflow-workerthread"]
  end
  subgraph group_workspace["packages/workspace"]
    pkg_workspace["workspace"]
  end
  pkg_atomic_write --> pkg_invariants
  pkg_brand --> pkg_invariants
  pkg_environment --> pkg_invariants
  pkg_native_command --> pkg_invariants
  pkg_paths --> pkg_invariants
  pkg_retention --> pkg_invariants
  pkg_timeout --> pkg_invariants
  pkg_scope --> pkg_invariants
  pkg_llm_mock_server --> pkg_invariants
  pkg_base --> pkg_invariants
  pkg_client_modules --> pkg_invariants
  pkg_client_schema_form --> pkg_invariants
  pkg_client_ui_primitives --> pkg_invariants
  pkg_client_ui_slots --> pkg_invariants
  pkg_client_web --> pkg_invariants
  pkg_client_web_react --> pkg_invariants
  pkg_code_runtime --> pkg_invariants
  pkg_code_runtime_python --> pkg_invariants
  pkg_e2b --> pkg_invariants
  pkg_jsonrpc_demo --> pkg_invariants
  pkg_git --> pkg_invariants
  pkg_host_apiproxy --> pkg_invariants
  pkg_host_directory_picker --> pkg_invariants
  pkg_host_webserver --> pkg_invariants
  pkg_memory --> pkg_invariants
  pkg_sandbox_windows_acl --> pkg_invariants
  pkg_semantic_index --> pkg_invariants
  pkg_storage --> pkg_invariants
  pkg_subprocess --> pkg_invariants
  pkg_type_meta --> pkg_invariants
  pkg_typert_generator --> pkg_invariants
  pkg_typert_registry --> pkg_invariants
  pkg_llm --> pkg_brand
  pkg_llm --> pkg_invariants
  pkg_llm --> pkg_timeout
  pkg_attachment --> pkg_brand
  pkg_attachment --> pkg_invariants
  pkg_client_connection --> pkg_host_webserver
  pkg_client_connection --> pkg_invariants
  pkg_client_hmr --> pkg_client_modules
  pkg_client_hmr --> pkg_host_webserver
  pkg_client_hmr --> pkg_invariants
  pkg_client_runtime --> pkg_invariants
  pkg_client_runtime --> pkg_type_meta
  pkg_client_runtime --> pkg_typert_registry
  pkg_credentials --> pkg_brand
  pkg_credentials --> pkg_invariants
  pkg_subprocess_e2b --> pkg_e2b
  pkg_subprocess_e2b --> pkg_invariants
  pkg_subprocess_e2b --> pkg_subprocess
  pkg_subprocess_e2b --> pkg_timeout
  pkg_pheromone --> pkg_atomic_write
  pkg_pheromone --> pkg_invariants
  pkg_frontend_static --> pkg_host_webserver
  pkg_frontend_static --> pkg_invariants
  pkg_host_plugin_inventory --> pkg_brand
  pkg_host_plugin_inventory --> pkg_invariants
  pkg_host_plugin_inventory --> pkg_type_meta
  pkg_anonymous_user_id --> pkg_brand
  pkg_anonymous_user_id --> pkg_invariants
  pkg_anonymous_user_id --> pkg_paths
  pkg_settings --> pkg_brand
  pkg_settings --> pkg_invariants
  pkg_storage_domain --> pkg_invariants
  pkg_storage_domain --> pkg_storage
  pkg_storage_json --> pkg_invariants
  pkg_storage_json --> pkg_storage
  pkg_storage_sqlite --> pkg_invariants
  pkg_storage_sqlite --> pkg_storage
  pkg_subprocess_local --> pkg_invariants
  pkg_subprocess_local --> pkg_subprocess
  pkg_subprocess_local --> pkg_timeout
  pkg_typert_loader --> pkg_invariants
  pkg_typert_loader --> pkg_typert_registry
  pkg_llm_deepseek --> pkg_credentials
  pkg_llm_deepseek --> pkg_environment
  pkg_llm_deepseek --> pkg_invariants
  pkg_llm_deepseek --> pkg_llm
  pkg_llm_deepseek --> pkg_settings
  pkg_llm_deepseek --> pkg_timeout
  pkg_tool_json_repair --> pkg_invariants
  pkg_tool_json_repair --> pkg_llm
  pkg_model_roles --> pkg_invariants
  pkg_model_roles --> pkg_settings
  pkg_session --> pkg_brand
  pkg_session --> pkg_invariants
  pkg_session --> pkg_llm
  pkg_session --> pkg_scope
  pkg_session --> pkg_type_meta
  pkg_system_prompt --> pkg_invariants
  pkg_system_prompt --> pkg_llm
  pkg_system_prompt --> pkg_scope
  pkg_skill --> pkg_invariants
  pkg_skill --> pkg_llm
  pkg_web --> pkg_invariants
  pkg_web --> pkg_llm
  pkg_api_gateway --> pkg_client_connection
  pkg_api_gateway --> pkg_invariants
  pkg_api_gateway --> pkg_typert_registry
  pkg_attachment_local --> pkg_attachment
  pkg_attachment_local --> pkg_invariants
  pkg_attachment_local --> pkg_paths
  pkg_client_locale --> pkg_client_runtime
  pkg_client_locale --> pkg_client_ui_primitives
  pkg_client_locale --> pkg_client_ui_slots
  pkg_client_locale --> pkg_invariants
  pkg_client_test_runtime --> pkg_client_runtime
  pkg_client_test_runtime --> pkg_client_ui_slots
  pkg_client_test_runtime --> pkg_client_web_react
  pkg_client_test_runtime --> pkg_host_apiproxy
  pkg_client_test_runtime --> pkg_invariants
  pkg_client_ui_models --> pkg_client_connection
  pkg_client_ui_models --> pkg_client_runtime
  pkg_client_ui_models --> pkg_client_schema_form
  pkg_client_ui_models --> pkg_client_ui_primitives
  pkg_client_ui_models --> pkg_client_ui_slots
  pkg_client_ui_models --> pkg_client_web_react
  pkg_client_ui_models --> pkg_invariants
  pkg_client_ui_settings --> pkg_client_runtime
  pkg_client_ui_settings --> pkg_client_ui_primitives
  pkg_client_ui_settings --> pkg_client_ui_slots
  pkg_client_ui_settings --> pkg_invariants
  pkg_client_ui_trajectory --> pkg_client_runtime
  pkg_client_ui_trajectory --> pkg_client_ui_primitives
  pkg_client_ui_trajectory --> pkg_invariants
  pkg_authorization --> pkg_credentials
  pkg_authorization --> pkg_invariants
  pkg_authorization --> pkg_llm
  pkg_credentials_local --> pkg_atomic_write
  pkg_credentials_local --> pkg_credentials
  pkg_credentials_local --> pkg_environment
  pkg_credentials_local --> pkg_invariants
  pkg_credentials_local --> pkg_paths
  pkg_lsp --> pkg_brand
  pkg_lsp --> pkg_invariants
  pkg_lsp --> pkg_llm
  pkg_memory_sqlite --> pkg_invariants
  pkg_memory_sqlite --> pkg_llm
  pkg_memory_sqlite --> pkg_memory
  pkg_memory_sqlite --> pkg_semantic_index
  pkg_memory_sqlite --> pkg_timeout
  pkg_sandbox --> pkg_invariants
  pkg_sandbox --> pkg_llm
  pkg_meridian --> pkg_invariants
  pkg_meridian --> pkg_pheromone
  pkg_settings_local --> pkg_atomic_write
  pkg_settings_local --> pkg_invariants
  pkg_settings_local --> pkg_paths
  pkg_settings_local --> pkg_settings
  pkg_llm_pi_ai --> pkg_authorization
  pkg_llm_pi_ai --> pkg_credentials
  pkg_llm_pi_ai --> pkg_environment
  pkg_llm_pi_ai --> pkg_invariants
  pkg_llm_pi_ai --> pkg_llm
  pkg_llm_pi_ai --> pkg_settings
  pkg_llm_pi_ai --> pkg_timeout
  pkg_agent --> pkg_invariants
  pkg_agent --> pkg_llm
  pkg_agent --> pkg_scope
  pkg_agent --> pkg_session
  pkg_agent --> pkg_system_prompt
  pkg_agent --> pkg_type_meta
  pkg_bash --> pkg_invariants
  pkg_bash --> pkg_sandbox
  pkg_bash --> pkg_subprocess
  pkg_fs --> pkg_brand
  pkg_fs --> pkg_invariants
  pkg_fs --> pkg_llm
  pkg_fs --> pkg_sandbox
  pkg_skill_badge --> pkg_invariants
  pkg_skill_badge --> pkg_skill
  pkg_web_fetch_local --> pkg_invariants
  pkg_web_fetch_local --> pkg_timeout
  pkg_web_fetch_local --> pkg_web
  pkg_web_search_exa --> pkg_environment
  pkg_web_search_exa --> pkg_invariants
  pkg_web_search_exa --> pkg_web
  pkg_web_search_perplexity --> pkg_environment
  pkg_web_search_perplexity --> pkg_invariants
  pkg_web_search_perplexity --> pkg_web
  pkg_spill --> pkg_brand
  pkg_spill --> pkg_invariants
  pkg_spill --> pkg_llm
  pkg_spill --> pkg_session
  pkg_acp_snapshot --> pkg_invariants
  pkg_acp_snapshot --> pkg_session
  pkg_app_boot --> pkg_environment
  pkg_app_boot --> pkg_invariants
  pkg_app_boot --> pkg_paths
  pkg_app_boot --> pkg_system_prompt
  pkg_client_ui_input_trigger --> pkg_client_locale
  pkg_client_ui_input_trigger --> pkg_client_runtime
  pkg_client_ui_input_trigger --> pkg_client_ui_primitives
  pkg_client_ui_input_trigger --> pkg_client_ui_slots
  pkg_client_ui_input_trigger --> pkg_invariants
  pkg_client_ui_question --> pkg_client_locale
  pkg_client_ui_question --> pkg_invariants
  pkg_client_ui_settings_general --> pkg_client_connection
  pkg_client_ui_settings_general --> pkg_client_locale
  pkg_client_ui_settings_general --> pkg_client_runtime
  pkg_client_ui_settings_general --> pkg_client_ui_primitives
  pkg_client_ui_settings_general --> pkg_client_ui_settings
  pkg_client_ui_settings_general --> pkg_client_ui_slots
  pkg_client_ui_settings_general --> pkg_client_web_react
  pkg_client_ui_settings_general --> pkg_invariants
  pkg_client_ui_sidebar --> pkg_client_locale
  pkg_client_ui_sidebar --> pkg_client_runtime
  pkg_client_ui_sidebar --> pkg_client_ui_primitives
  pkg_client_ui_sidebar --> pkg_client_ui_slots
  pkg_client_ui_sidebar --> pkg_invariants
  pkg_client_ui_slash --> pkg_client_locale
  pkg_client_ui_slash --> pkg_client_runtime
  pkg_client_ui_slash --> pkg_client_ui_primitives
  pkg_client_ui_slash --> pkg_client_ui_slots
  pkg_client_ui_slash --> pkg_invariants
  pkg_client_ui_theme --> pkg_client_locale
  pkg_client_ui_theme --> pkg_client_runtime
  pkg_client_ui_theme --> pkg_client_ui_primitives
  pkg_client_ui_theme --> pkg_client_ui_slots
  pkg_client_ui_theme --> pkg_invariants
  pkg_client_ui_workspace --> pkg_client_connection
  pkg_client_ui_workspace --> pkg_client_locale
  pkg_client_ui_workspace --> pkg_client_runtime
  pkg_client_ui_workspace --> pkg_client_ui_primitives
  pkg_client_ui_workspace --> pkg_client_ui_slots
  pkg_client_ui_workspace --> pkg_invariants
  pkg_code_runtime_worker --> pkg_code_runtime
  pkg_code_runtime_worker --> pkg_invariants
  pkg_code_runtime_worker --> pkg_session
  pkg_code_runtime_worker --> pkg_timeout
  pkg_memory_consolidate --> pkg_invariants
  pkg_memory_consolidate --> pkg_llm
  pkg_memory_consolidate --> pkg_memory
  pkg_memory_consolidate --> pkg_session
  pkg_memory_consolidate --> pkg_timeout
  pkg_persona --> pkg_invariants
  pkg_persona --> pkg_system_prompt
  pkg_sandbox_local --> pkg_invariants
  pkg_sandbox_local --> pkg_llm
  pkg_sandbox_local --> pkg_sandbox
  pkg_sandbox_local --> pkg_session
  pkg_session_persistence --> pkg_brand
  pkg_session_persistence --> pkg_invariants
  pkg_session_persistence --> pkg_session
  pkg_session_persistence --> pkg_timeout
  pkg_session_projection --> pkg_invariants
  pkg_session_projection --> pkg_session
  pkg_llm_retry --> pkg_agent
  pkg_llm_retry --> pkg_brand
  pkg_llm_retry --> pkg_invariants
  pkg_llm_retry --> pkg_llm
  pkg_llm_retry --> pkg_session
  pkg_llm_retry --> pkg_timeout
  pkg_agent_default_model --> pkg_agent
  pkg_agent_default_model --> pkg_invariants
  pkg_agent_default_model --> pkg_llm
  pkg_agent_default_model --> pkg_settings
  pkg_goal --> pkg_agent
  pkg_goal --> pkg_brand
  pkg_goal --> pkg_invariants
  pkg_goal --> pkg_llm
  pkg_goal --> pkg_scope
  pkg_goal --> pkg_session
  pkg_goal --> pkg_session_projection
  pkg_goal --> pkg_type_meta
  pkg_bash_local --> pkg_bash
  pkg_bash_local --> pkg_invariants
  pkg_bash_local --> pkg_subprocess
  pkg_bash_local --> pkg_timeout
  pkg_pwsh_local --> pkg_bash
  pkg_pwsh_local --> pkg_invariants
  pkg_pwsh_local --> pkg_subprocess
  pkg_pwsh_local --> pkg_timeout
  pkg_fs_local --> pkg_fs
  pkg_fs_local --> pkg_invariants
  pkg_fs_policy --> pkg_fs
  pkg_fs_policy --> pkg_invariants
  pkg_skill_local --> pkg_fs
  pkg_skill_local --> pkg_invariants
  pkg_skill_local --> pkg_paths
  pkg_skill_local --> pkg_skill
  pkg_agent_definitions --> pkg_fs
  pkg_agent_definitions --> pkg_invariants
  pkg_agent_definitions --> pkg_paths
  pkg_agent_definitions --> pkg_skill
  pkg_web_search_deepseek --> pkg_agent
  pkg_web_search_deepseek --> pkg_credentials
  pkg_web_search_deepseek --> pkg_environment
  pkg_web_search_deepseek --> pkg_invariants
  pkg_web_search_deepseek --> pkg_session
  pkg_web_search_deepseek --> pkg_web
  pkg_spill_local --> pkg_invariants
  pkg_spill_local --> pkg_spill
  pkg_hook_protocol --> pkg_bash
  pkg_hook_protocol --> pkg_invariants
  pkg_hook_protocol --> pkg_session
  pkg_loader_smoke --> pkg_agent
  pkg_loader_smoke --> pkg_invariants
  pkg_loader_smoke --> pkg_llm
  pkg_loader_smoke --> pkg_session
  pkg_client_ui_layout --> pkg_client_runtime
  pkg_client_ui_layout --> pkg_client_ui_slots
  pkg_client_ui_layout --> pkg_client_ui_theme
  pkg_client_ui_layout --> pkg_invariants
  pkg_spark_anchors --> pkg_agent
  pkg_spark_anchors --> pkg_invariants
  pkg_spark_anchors --> pkg_llm
  pkg_spark_anchors --> pkg_llm_deepseek
  pkg_spark_anchors --> pkg_session
  pkg_spark_anchors --> pkg_settings
  pkg_time_context --> pkg_agent
  pkg_time_context --> pkg_invariants
  pkg_time_context --> pkg_session
  pkg_tmux_context --> pkg_agent
  pkg_tmux_context --> pkg_bash
  pkg_tmux_context --> pkg_invariants
  pkg_tmux_context --> pkg_session
  pkg_vision_bridge --> pkg_agent
  pkg_vision_bridge --> pkg_invariants
  pkg_vision_bridge --> pkg_llm
  pkg_vision_bridge --> pkg_model_roles
  pkg_vision_bridge --> pkg_session
  pkg_fs_e2b --> pkg_e2b
  pkg_fs_e2b --> pkg_fs
  pkg_fs_e2b --> pkg_invariants
  pkg_message_feedback --> pkg_brand
  pkg_message_feedback --> pkg_invariants
  pkg_message_feedback --> pkg_llm
  pkg_message_feedback --> pkg_session
  pkg_message_feedback --> pkg_session_persistence
  pkg_message_feedback --> pkg_storage_domain
  pkg_message_feedback --> pkg_type_meta
  pkg_task_card --> pkg_agent
  pkg_task_card --> pkg_invariants
  pkg_task_card --> pkg_llm
  pkg_task_card --> pkg_session
  pkg_task_card --> pkg_timeout
  pkg_host_directory_picker_browse --> pkg_client_locale
  pkg_host_directory_picker_browse --> pkg_client_runtime
  pkg_host_directory_picker_browse --> pkg_client_ui_primitives
  pkg_host_directory_picker_browse --> pkg_client_ui_slots
  pkg_host_directory_picker_browse --> pkg_client_ui_workspace
  pkg_host_directory_picker_browse --> pkg_invariants
  pkg_host_directory_picker_native --> pkg_client_runtime
  pkg_host_directory_picker_native --> pkg_client_ui_slots
  pkg_host_directory_picker_native --> pkg_client_ui_workspace
  pkg_host_directory_picker_native --> pkg_invariants
  pkg_commands --> pkg_agent
  pkg_commands --> pkg_brand
  pkg_commands --> pkg_invariants
  pkg_commands --> pkg_llm
  pkg_commands --> pkg_scope
  pkg_commands --> pkg_session
  pkg_user_approval --> pkg_agent
  pkg_user_approval --> pkg_brand
  pkg_user_approval --> pkg_invariants
  pkg_user_approval --> pkg_llm
  pkg_user_approval --> pkg_scope
  pkg_user_approval --> pkg_session
  pkg_user_approval --> pkg_system_prompt
  pkg_user_interaction --> pkg_agent
  pkg_user_interaction --> pkg_invariants
  pkg_user_interaction --> pkg_llm
  pkg_lsp_local --> pkg_brand
  pkg_lsp_local --> pkg_fs
  pkg_lsp_local --> pkg_invariants
  pkg_lsp_local --> pkg_llm
  pkg_lsp_local --> pkg_lsp
  pkg_lsp_local --> pkg_subprocess
  pkg_lsp_local --> pkg_timeout
  pkg_agent_presets --> pkg_agent
  pkg_agent_presets --> pkg_atomic_write
  pkg_agent_presets --> pkg_invariants
  pkg_agent_presets --> pkg_paths
  pkg_agent_presets --> pkg_scope
  pkg_agent_presets --> pkg_session
  pkg_agent_presets --> pkg_settings
  pkg_agent_presets --> pkg_system_prompt
  pkg_pty --> pkg_agent
  pkg_pty --> pkg_brand
  pkg_pty --> pkg_invariants
  pkg_sandbox_policy --> pkg_agent
  pkg_sandbox_policy --> pkg_invariants
  pkg_sandbox_policy --> pkg_sandbox
  pkg_sandbox_policy --> pkg_session
  pkg_sandbox_policy --> pkg_system_prompt
  pkg_session_persistence_jsonl --> pkg_invariants
  pkg_session_persistence_jsonl --> pkg_session
  pkg_session_persistence_jsonl --> pkg_session_persistence
  pkg_session_persistence_sqlite --> pkg_invariants
  pkg_session_persistence_sqlite --> pkg_session
  pkg_session_persistence_sqlite --> pkg_session_persistence
  pkg_session_projection_cache --> pkg_invariants
  pkg_session_projection_cache --> pkg_session
  pkg_session_projection_cache --> pkg_session_persistence
  pkg_session_projection_cache --> pkg_session_projection
  pkg_session_projection_cache --> pkg_storage_domain
  pkg_session_stats --> pkg_invariants
  pkg_session_stats --> pkg_llm
  pkg_session_stats --> pkg_session
  pkg_session_stats --> pkg_session_projection
  pkg_session_telemetry --> pkg_agent
  pkg_session_telemetry --> pkg_invariants
  pkg_session_telemetry --> pkg_session
  pkg_session_title --> pkg_brand
  pkg_session_title --> pkg_invariants
  pkg_session_title --> pkg_llm
  pkg_session_title --> pkg_session
  pkg_session_title --> pkg_session_projection
  pkg_tasks --> pkg_agent
  pkg_tasks --> pkg_brand
  pkg_tasks --> pkg_invariants
  pkg_tasks --> pkg_session
  pkg_workflow --> pkg_agent
  pkg_workflow --> pkg_brand
  pkg_workflow --> pkg_invariants
  pkg_workflow --> pkg_llm
  pkg_workflow --> pkg_session
  pkg_workspace --> pkg_brand
  pkg_workspace --> pkg_invariants
  pkg_workspace --> pkg_session
  pkg_workspace --> pkg_session_persistence
  pkg_workspace --> pkg_storage
  pkg_workspace --> pkg_storage_domain
  pkg_tools --> pkg_agent
  pkg_tools --> pkg_code_runtime
  pkg_tools --> pkg_invariants
  pkg_tools --> pkg_llm
  pkg_tools --> pkg_scope
  pkg_tools --> pkg_session
  pkg_tools --> pkg_system_prompt
  pkg_tools --> pkg_user_approval
  pkg_command_goal --> pkg_commands
  pkg_command_goal --> pkg_goal
  pkg_command_goal --> pkg_invariants
  pkg_command_goal --> pkg_llm
  pkg_goal_session --> pkg_agent
  pkg_goal_session --> pkg_goal
  pkg_goal_session --> pkg_invariants
  pkg_goal_session --> pkg_llm
  pkg_goal_session --> pkg_session
  pkg_bash_sandbox --> pkg_bash
  pkg_bash_sandbox --> pkg_bash_local
  pkg_bash_sandbox --> pkg_invariants
  pkg_bash_sandbox --> pkg_sandbox
  pkg_bash_sandbox --> pkg_sandbox_policy
  pkg_pwsh_sandbox --> pkg_bash
  pkg_pwsh_sandbox --> pkg_invariants
  pkg_pwsh_sandbox --> pkg_pwsh_local
  pkg_pwsh_sandbox --> pkg_sandbox
  pkg_pwsh_sandbox --> pkg_sandbox_policy
  pkg_fs_sandbox --> pkg_fs
  pkg_fs_sandbox --> pkg_fs_local
  pkg_fs_sandbox --> pkg_invariants
  pkg_fs_sandbox --> pkg_sandbox
  pkg_fs_sandbox --> pkg_sandbox_policy
  pkg_compact --> pkg_brand
  pkg_compact --> pkg_commands
  pkg_compact --> pkg_invariants
  pkg_compact --> pkg_llm
  pkg_compact --> pkg_session
  pkg_session_query --> pkg_brand
  pkg_session_query --> pkg_invariants
  pkg_session_query --> pkg_llm
  pkg_session_query --> pkg_session
  pkg_session_query --> pkg_session_persistence
  pkg_session_query --> pkg_session_title
  pkg_acp --> pkg_agent
  pkg_acp --> pkg_invariants
  pkg_acp --> pkg_session
  pkg_acp --> pkg_user_approval
  pkg_api_remotes --> pkg_agent
  pkg_api_remotes --> pkg_goal
  pkg_api_remotes --> pkg_invariants
  pkg_api_remotes --> pkg_session
  pkg_api_remotes --> pkg_session_persistence
  pkg_api_remotes --> pkg_typert_registry
  pkg_headless --> pkg_agent
  pkg_headless --> pkg_agent_default_model
  pkg_headless --> pkg_invariants
  pkg_headless --> pkg_llm
  pkg_headless --> pkg_session
  pkg_command_feedback --> pkg_commands
  pkg_command_feedback --> pkg_invariants
  pkg_command_feedback --> pkg_session
  pkg_host_directory_picker_auto --> pkg_host_directory_picker_browse
  pkg_host_directory_picker_auto --> pkg_host_directory_picker_native
  pkg_host_directory_picker_auto --> pkg_host_webserver
  pkg_host_directory_picker_auto --> pkg_invariants
  pkg_approval_rules --> pkg_agent
  pkg_approval_rules --> pkg_commands
  pkg_approval_rules --> pkg_invariants
  pkg_approval_rules --> pkg_llm
  pkg_approval_rules --> pkg_paths
  pkg_approval_rules --> pkg_session
  pkg_approval_rules --> pkg_user_approval
  pkg_command_files --> pkg_commands
  pkg_command_files --> pkg_invariants
  pkg_command_files --> pkg_llm
  pkg_command_files --> pkg_paths
  pkg_output_style --> pkg_commands
  pkg_output_style --> pkg_invariants
  pkg_output_style --> pkg_settings
  pkg_output_style --> pkg_system_prompt
  pkg_permission --> pkg_bash
  pkg_permission --> pkg_commands
  pkg_permission --> pkg_invariants
  pkg_permission --> pkg_sandbox
  pkg_permission --> pkg_sandbox_policy
  pkg_permission --> pkg_session
  pkg_permission --> pkg_session_projection
  pkg_permission --> pkg_settings
  pkg_permission --> pkg_user_approval
  pkg_command_memory --> pkg_commands
  pkg_command_memory --> pkg_invariants
  pkg_memory_pipeline --> pkg_atomic_write
  pkg_memory_pipeline --> pkg_invariants
  pkg_memory_pipeline --> pkg_llm
  pkg_memory_pipeline --> pkg_memory
  pkg_memory_pipeline --> pkg_memory_consolidate
  pkg_memory_pipeline --> pkg_session
  pkg_memory_pipeline --> pkg_session_persistence
  pkg_memory_pipeline --> pkg_tasks
  pkg_memory_pipeline --> pkg_timeout
  pkg_pty_local --> pkg_agent
  pkg_pty_local --> pkg_invariants
  pkg_pty_local --> pkg_pty
  pkg_pty_local --> pkg_pwsh_local
  pkg_pty_local --> pkg_sandbox
  pkg_pty_local --> pkg_sandbox_policy
  pkg_pty_local --> pkg_session
  pkg_pty_local --> pkg_subprocess
  pkg_session_title_llm --> pkg_invariants
  pkg_session_title_llm --> pkg_llm
  pkg_session_title_llm --> pkg_model_roles
  pkg_session_title_llm --> pkg_session
  pkg_session_title_llm --> pkg_session_title
  pkg_session_title_llm --> pkg_timeout
  pkg_tasks_local --> pkg_agent
  pkg_tasks_local --> pkg_invariants
  pkg_tasks_local --> pkg_tasks
  pkg_tasks_local --> pkg_timeout
  pkg_cache_diagnostic --> pkg_compact
  pkg_cache_diagnostic --> pkg_invariants
  pkg_cache_diagnostic --> pkg_llm
  pkg_cache_diagnostic --> pkg_session
  pkg_cache_diagnostic --> pkg_session_projection
  pkg_token_meter --> pkg_compact
  pkg_token_meter --> pkg_invariants
  pkg_token_meter --> pkg_llm
  pkg_token_meter --> pkg_session
  pkg_token_meter --> pkg_session_projection
  pkg_agent_loop --> pkg_agent
  pkg_agent_loop --> pkg_invariants
  pkg_agent_loop --> pkg_llm
  pkg_agent_loop --> pkg_scope
  pkg_agent_loop --> pkg_session
  pkg_agent_loop --> pkg_session_persistence
  pkg_agent_loop --> pkg_system_prompt
  pkg_agent_loop --> pkg_tools
  pkg_agent_tool_presentation --> pkg_invariants
  pkg_agent_tool_presentation --> pkg_tools
  pkg_tool_goal --> pkg_agent
  pkg_tool_goal --> pkg_goal
  pkg_tool_goal --> pkg_invariants
  pkg_tool_goal --> pkg_llm
  pkg_tool_goal --> pkg_session
  pkg_tool_goal --> pkg_system_prompt
  pkg_tool_goal --> pkg_tools
  pkg_bash_env --> pkg_bash
  pkg_bash_env --> pkg_invariants
  pkg_bash_env --> pkg_paths
  pkg_bash_env --> pkg_session_persistence
  pkg_bash_env --> pkg_tools
  pkg_fs_snapshot --> pkg_invariants
  pkg_fs_snapshot --> pkg_session
  pkg_fs_snapshot --> pkg_tools
  pkg_tool_file_info --> pkg_fs
  pkg_tool_file_info --> pkg_invariants
  pkg_tool_file_info --> pkg_llm
  pkg_tool_file_info --> pkg_pheromone
  pkg_tool_file_info --> pkg_session
  pkg_tool_file_info --> pkg_tools
  pkg_tool_fs --> pkg_fs
  pkg_tool_fs --> pkg_invariants
  pkg_tool_fs --> pkg_llm
  pkg_tool_fs --> pkg_sandbox
  pkg_tool_fs --> pkg_sandbox_policy
  pkg_tool_fs --> pkg_session
  pkg_tool_fs --> pkg_system_prompt
  pkg_tool_fs --> pkg_tools
  pkg_tool_fs --> pkg_user_approval
  pkg_tool_fs_search --> pkg_invariants
  pkg_tool_fs_search --> pkg_llm
  pkg_tool_fs_search --> pkg_retention
  pkg_tool_fs_search --> pkg_session
  pkg_tool_fs_search --> pkg_spill
  pkg_tool_fs_search --> pkg_subprocess
  pkg_tool_fs_search --> pkg_system_prompt
  pkg_tool_fs_search --> pkg_timeout
  pkg_tool_fs_search --> pkg_tools
  pkg_tool_str_replace_editor --> pkg_fs
  pkg_tool_str_replace_editor --> pkg_invariants
  pkg_tool_str_replace_editor --> pkg_sandbox
  pkg_tool_str_replace_editor --> pkg_sandbox_policy
  pkg_tool_str_replace_editor --> pkg_tools
  pkg_tool_skill --> pkg_agent
  pkg_tool_skill --> pkg_invariants
  pkg_tool_skill --> pkg_llm
  pkg_tool_skill --> pkg_skill
  pkg_tool_skill --> pkg_tools
  pkg_command_compact --> pkg_commands
  pkg_command_compact --> pkg_compact
  pkg_command_compact --> pkg_invariants
  pkg_subagent --> pkg_agent
  pkg_subagent --> pkg_brand
  pkg_subagent --> pkg_invariants
  pkg_subagent --> pkg_llm
  pkg_subagent --> pkg_model_roles
  pkg_subagent --> pkg_sandbox_policy
  pkg_subagent --> pkg_scope
  pkg_subagent --> pkg_session
  pkg_subagent --> pkg_session_persistence
  pkg_subagent --> pkg_session_projection
  pkg_subagent --> pkg_session_projection_cache
  pkg_subagent --> pkg_tasks
  pkg_subagent --> pkg_tools
  pkg_tool_web --> pkg_invariants
  pkg_tool_web --> pkg_llm
  pkg_tool_web --> pkg_system_prompt
  pkg_tool_web --> pkg_tools
  pkg_tool_web --> pkg_web
  pkg_spill_policy --> pkg_invariants
  pkg_spill_policy --> pkg_llm
  pkg_spill_policy --> pkg_retention
  pkg_spill_policy --> pkg_session
  pkg_spill_policy --> pkg_spill
  pkg_spill_policy --> pkg_tools
  pkg_tool_todo --> pkg_agent
  pkg_tool_todo --> pkg_invariants
  pkg_tool_todo --> pkg_session
  pkg_tool_todo --> pkg_session_projection
  pkg_tool_todo --> pkg_tools
  pkg_plan_mode --> pkg_agent
  pkg_plan_mode --> pkg_commands
  pkg_plan_mode --> pkg_invariants
  pkg_plan_mode --> pkg_llm
  pkg_plan_mode --> pkg_paths
  pkg_plan_mode --> pkg_session
  pkg_plan_mode --> pkg_session_projection
  pkg_plan_mode --> pkg_system_prompt
  pkg_plan_mode --> pkg_tools
  pkg_plan_mode --> pkg_user_interaction
  pkg_hooks_codex --> pkg_agent
  pkg_hooks_codex --> pkg_hook_protocol
  pkg_hooks_codex --> pkg_invariants
  pkg_hooks_codex --> pkg_llm
  pkg_hooks_codex --> pkg_session
  pkg_hooks_codex --> pkg_session_persistence
  pkg_hooks_codex --> pkg_tools
  pkg_session_query_sqlite --> pkg_invariants
  pkg_session_query_sqlite --> pkg_session
  pkg_session_query_sqlite --> pkg_session_persistence
  pkg_session_query_sqlite --> pkg_session_query
  pkg_tool_session_query --> pkg_invariants
  pkg_tool_session_query --> pkg_llm
  pkg_tool_session_query --> pkg_session
  pkg_tool_session_query --> pkg_session_query
  pkg_tool_session_query --> pkg_system_prompt
  pkg_tool_session_query --> pkg_timeout
  pkg_tool_session_query --> pkg_tools
  pkg_agent_loop_testkit --> pkg_agent
  pkg_agent_loop_testkit --> pkg_invariants
  pkg_agent_loop_testkit --> pkg_llm
  pkg_agent_loop_testkit --> pkg_session
  pkg_agent_loop_testkit --> pkg_system_prompt
  pkg_agent_loop_testkit --> pkg_tools
  pkg_llm_replay --> pkg_compact
  pkg_llm_replay --> pkg_invariants
  pkg_llm_replay --> pkg_llm
  pkg_llm_replay --> pkg_session
  pkg_session_reference --> pkg_agent
  pkg_session_reference --> pkg_compact
  pkg_session_reference --> pkg_invariants
  pkg_session_reference --> pkg_llm
  pkg_session_reference --> pkg_retention
  pkg_session_reference --> pkg_session
  pkg_session_reference --> pkg_session_query
  pkg_workspace_context --> pkg_agent
  pkg_workspace_context --> pkg_fs
  pkg_workspace_context --> pkg_invariants
  pkg_workspace_context --> pkg_llm
  pkg_workspace_context --> pkg_paths
  pkg_workspace_context --> pkg_session
  pkg_workspace_context --> pkg_tools
  pkg_tool_git --> pkg_git
  pkg_tool_git --> pkg_invariants
  pkg_tool_git --> pkg_system_prompt
  pkg_tool_git --> pkg_tools
  pkg_doom_loop_guard --> pkg_agent
  pkg_doom_loop_guard --> pkg_invariants
  pkg_doom_loop_guard --> pkg_llm
  pkg_doom_loop_guard --> pkg_tools
  pkg_evidence_gate --> pkg_invariants
  pkg_evidence_gate --> pkg_session
  pkg_evidence_gate --> pkg_tools
  pkg_intent_bridge --> pkg_agent
  pkg_intent_bridge --> pkg_invariants
  pkg_intent_bridge --> pkg_llm
  pkg_intent_bridge --> pkg_session
  pkg_intent_bridge --> pkg_session_title
  pkg_intent_bridge --> pkg_task_card
  pkg_intent_bridge --> pkg_tools
  pkg_repeat_tool_guard --> pkg_agent
  pkg_repeat_tool_guard --> pkg_invariants
  pkg_repeat_tool_guard --> pkg_tools
  pkg_timeout_policy --> pkg_invariants
  pkg_timeout_policy --> pkg_llm
  pkg_timeout_policy --> pkg_timeout
  pkg_timeout_policy --> pkg_tools
  pkg_zen --> pkg_agent
  pkg_zen --> pkg_commands
  pkg_zen --> pkg_invariants
  pkg_zen --> pkg_llm
  pkg_zen --> pkg_session
  pkg_zen --> pkg_system_prompt
  pkg_zen --> pkg_tools
  pkg_tool_ask_user --> pkg_agent
  pkg_tool_ask_user --> pkg_invariants
  pkg_tool_ask_user --> pkg_tools
  pkg_tool_ask_user --> pkg_user_interaction
  pkg_tool_lsp --> pkg_invariants
  pkg_tool_lsp --> pkg_llm
  pkg_tool_lsp --> pkg_lsp
  pkg_tool_lsp --> pkg_system_prompt
  pkg_tool_lsp --> pkg_timeout
  pkg_tool_lsp --> pkg_tools
  pkg_mcp_client --> pkg_invariants
  pkg_mcp_client --> pkg_llm
  pkg_mcp_client --> pkg_subprocess
  pkg_mcp_client --> pkg_tools
  pkg_adaptive_memory --> pkg_agent
  pkg_adaptive_memory --> pkg_invariants
  pkg_adaptive_memory --> pkg_memory
  pkg_adaptive_memory --> pkg_session
  pkg_adaptive_memory --> pkg_system_prompt
  pkg_adaptive_memory --> pkg_tools
  pkg_tool_memory --> pkg_invariants
  pkg_tool_memory --> pkg_system_prompt
  pkg_tool_memory --> pkg_tools
  pkg_tool_bash_persistent --> pkg_agent
  pkg_tool_bash_persistent --> pkg_invariants
  pkg_tool_bash_persistent --> pkg_pty
  pkg_tool_bash_persistent --> pkg_timeout
  pkg_tool_bash_persistent --> pkg_tools
  pkg_tool_pty --> pkg_agent
  pkg_tool_pty --> pkg_invariants
  pkg_tool_pty --> pkg_llm
  pkg_tool_pty --> pkg_pty
  pkg_tool_pty --> pkg_retention
  pkg_tool_pty --> pkg_system_prompt
  pkg_tool_pty --> pkg_tasks
  pkg_tool_pty --> pkg_tools
  pkg_tool_pwsh_persistent --> pkg_agent
  pkg_tool_pwsh_persistent --> pkg_invariants
  pkg_tool_pwsh_persistent --> pkg_pty
  pkg_tool_pwsh_persistent --> pkg_timeout
  pkg_tool_pwsh_persistent --> pkg_tools
  pkg_schedule --> pkg_agent
  pkg_schedule --> pkg_brand
  pkg_schedule --> pkg_invariants
  pkg_schedule --> pkg_llm
  pkg_schedule --> pkg_session
  pkg_schedule --> pkg_session_persistence
  pkg_schedule --> pkg_tools
  pkg_tool_meridian --> pkg_invariants
  pkg_tool_meridian --> pkg_meridian
  pkg_tool_meridian --> pkg_system_prompt
  pkg_tool_meridian --> pkg_tools
  pkg_tool_semantic_search --> pkg_invariants
  pkg_tool_semantic_search --> pkg_semantic_index
  pkg_tool_semantic_search --> pkg_system_prompt
  pkg_tool_semantic_search --> pkg_tools
  pkg_cordis_client_runner --> pkg_api_remotes
  pkg_cordis_client_runner --> pkg_client_connection
  pkg_cordis_client_runner --> pkg_client_modules
  pkg_cordis_client_runner --> pkg_client_runtime
  pkg_cordis_client_runner --> pkg_client_ui_slots
  pkg_cordis_client_runner --> pkg_client_ui_theme
  pkg_cordis_client_runner --> pkg_invariants
  pkg_cordis_host_runner --> pkg_agent
  pkg_cordis_host_runner --> pkg_brand
  pkg_cordis_host_runner --> pkg_invariants
  pkg_cordis_host_runner --> pkg_llm
  pkg_cordis_host_runner --> pkg_scope
  pkg_cordis_host_runner --> pkg_session
  pkg_cordis_host_runner --> pkg_tools
  pkg_cordis_host_runner --> pkg_type_meta
  pkg_tool_cordis --> pkg_invariants
  pkg_tool_cordis --> pkg_scope
  pkg_tool_cordis --> pkg_tools
  pkg_session_checkpoint_policy --> pkg_agent
  pkg_session_checkpoint_policy --> pkg_invariants
  pkg_session_checkpoint_policy --> pkg_llm
  pkg_session_checkpoint_policy --> pkg_session
  pkg_session_checkpoint_policy --> pkg_session_persistence
  pkg_session_checkpoint_policy --> pkg_tools
  pkg_session_telemetry_otel --> pkg_anonymous_user_id
  pkg_session_telemetry_otel --> pkg_brand
  pkg_session_telemetry_otel --> pkg_command_feedback
  pkg_session_telemetry_otel --> pkg_invariants
  pkg_session_telemetry_otel --> pkg_llm
  pkg_session_telemetry_otel --> pkg_paths
  pkg_session_telemetry_otel --> pkg_session
  pkg_session_telemetry_otel --> pkg_session_telemetry
  pkg_session_title_all_messages_llm --> pkg_invariants
  pkg_session_title_all_messages_llm --> pkg_llm
  pkg_session_title_all_messages_llm --> pkg_session
  pkg_session_title_all_messages_llm --> pkg_session_title
  pkg_session_title_all_messages_llm --> pkg_session_title_llm
  pkg_session_title_first_message_llm --> pkg_invariants
  pkg_session_title_first_message_llm --> pkg_llm
  pkg_session_title_first_message_llm --> pkg_session
  pkg_session_title_first_message_llm --> pkg_session_title
  pkg_session_title_first_message_llm --> pkg_session_title_llm
  pkg_tool_tasks --> pkg_agent
  pkg_tool_tasks --> pkg_invariants
  pkg_tool_tasks --> pkg_llm
  pkg_tool_tasks --> pkg_retention
  pkg_tool_tasks --> pkg_system_prompt
  pkg_tool_tasks --> pkg_tasks
  pkg_tool_tasks --> pkg_tools
  pkg_tool_run_tests --> pkg_bash
  pkg_tool_run_tests --> pkg_invariants
  pkg_tool_run_tests --> pkg_llm
  pkg_tool_run_tests --> pkg_tasks
  pkg_tool_run_tests --> pkg_tools
  pkg_tui --> pkg_agent
  pkg_tui --> pkg_agent_default_model
  pkg_tui --> pkg_invariants
  pkg_tui --> pkg_llm
  pkg_tui --> pkg_model_roles
  pkg_tui --> pkg_session
  pkg_tui --> pkg_session_title
  pkg_tui --> pkg_tools
  pkg_tui --> pkg_user_interaction
  pkg_vision_ask --> pkg_agent
  pkg_vision_ask --> pkg_invariants
  pkg_vision_ask --> pkg_llm
  pkg_vision_ask --> pkg_session
  pkg_vision_ask --> pkg_tools
  pkg_tool_workflow --> pkg_agent
  pkg_tool_workflow --> pkg_invariants
  pkg_tool_workflow --> pkg_llm
  pkg_tool_workflow --> pkg_system_prompt
  pkg_tool_workflow --> pkg_tools
  pkg_tool_workflow --> pkg_workflow
  pkg_tool_bash --> pkg_agent
  pkg_tool_bash --> pkg_bash
  pkg_tool_bash --> pkg_bash_env
  pkg_tool_bash --> pkg_invariants
  pkg_tool_bash --> pkg_llm
  pkg_tool_bash --> pkg_sandbox
  pkg_tool_bash --> pkg_sandbox_policy
  pkg_tool_bash --> pkg_system_prompt
  pkg_tool_bash --> pkg_tasks
  pkg_tool_bash --> pkg_tools
  pkg_tool_bash --> pkg_user_approval
  pkg_tool_pwsh --> pkg_agent
  pkg_tool_pwsh --> pkg_bash
  pkg_tool_pwsh --> pkg_bash_env
  pkg_tool_pwsh --> pkg_invariants
  pkg_tool_pwsh --> pkg_llm
  pkg_tool_pwsh --> pkg_system_prompt
  pkg_tool_pwsh --> pkg_tasks
  pkg_tool_pwsh --> pkg_tools
  pkg_compact_tool_result_prune --> pkg_compact
  pkg_compact_tool_result_prune --> pkg_invariants
  pkg_compact_tool_result_prune --> pkg_llm
  pkg_compact_tool_result_prune --> pkg_session
  pkg_compact_tool_result_prune --> pkg_token_meter
  pkg_subagent_acp --> pkg_agent
  pkg_subagent_acp --> pkg_invariants
  pkg_subagent_acp --> pkg_llm
  pkg_subagent_acp --> pkg_session
  pkg_subagent_acp --> pkg_subagent
  pkg_subagent_acp --> pkg_subprocess
  pkg_subagent_acp --> pkg_timeout
  pkg_subagent_claude_code --> pkg_invariants
  pkg_subagent_claude_code --> pkg_llm
  pkg_subagent_claude_code --> pkg_session
  pkg_subagent_claude_code --> pkg_subagent
  pkg_subagent_claude_code --> pkg_subprocess
  pkg_subagent_claude_code --> pkg_timeout
  pkg_subagent_inprocess --> pkg_agent
  pkg_subagent_inprocess --> pkg_invariants
  pkg_subagent_inprocess --> pkg_llm
  pkg_subagent_inprocess --> pkg_model_roles
  pkg_subagent_inprocess --> pkg_sandbox_policy
  pkg_subagent_inprocess --> pkg_session
  pkg_subagent_inprocess --> pkg_subagent
  pkg_subagent_inprocess --> pkg_system_prompt
  pkg_subagent_inprocess --> pkg_tools
  pkg_subagent_inprocess --> pkg_user_approval
  pkg_tool_subagent --> pkg_agent
  pkg_tool_subagent --> pkg_agent_definitions
  pkg_tool_subagent --> pkg_invariants
  pkg_tool_subagent --> pkg_llm
  pkg_tool_subagent --> pkg_model_roles
  pkg_tool_subagent --> pkg_skill
  pkg_tool_subagent --> pkg_subagent
  pkg_tool_subagent --> pkg_tasks
  pkg_tool_subagent --> pkg_tools
  pkg_tool_subagent_control --> pkg_invariants
  pkg_tool_subagent_control --> pkg_llm
  pkg_tool_subagent_control --> pkg_session
  pkg_tool_subagent_control --> pkg_skill
  pkg_tool_subagent_control --> pkg_subagent
  pkg_tool_subagent_control --> pkg_tools
  pkg_tool_subagent_report --> pkg_invariants
  pkg_tool_subagent_report --> pkg_llm
  pkg_tool_subagent_report --> pkg_skill
  pkg_tool_subagent_report --> pkg_subagent
  pkg_tool_subagent_report --> pkg_tools
  pkg_hooks_claude --> pkg_agent
  pkg_hooks_claude --> pkg_hook_protocol
  pkg_hooks_claude --> pkg_invariants
  pkg_hooks_claude --> pkg_llm
  pkg_hooks_claude --> pkg_session
  pkg_hooks_claude --> pkg_session_persistence
  pkg_hooks_claude --> pkg_subagent
  pkg_hooks_claude --> pkg_tools
  pkg_web_app --> pkg_bash_env
  pkg_web_app --> pkg_invariants
  pkg_web_app --> pkg_system_prompt
  pkg_client_ui_conversation --> pkg_agent
  pkg_client_ui_conversation --> pkg_client_locale
  pkg_client_ui_conversation --> pkg_client_runtime
  pkg_client_ui_conversation --> pkg_client_ui_primitives
  pkg_client_ui_conversation --> pkg_client_ui_slash
  pkg_client_ui_conversation --> pkg_client_ui_slots
  pkg_client_ui_conversation --> pkg_commands
  pkg_client_ui_conversation --> pkg_compact
  pkg_client_ui_conversation --> pkg_invariants
  pkg_client_ui_conversation --> pkg_llm_retry
  pkg_client_ui_conversation --> pkg_token_meter
  pkg_client_ui_conversation --> pkg_tools
  pkg_agent_router --> pkg_agent
  pkg_agent_router --> pkg_brand
  pkg_agent_router --> pkg_invariants
  pkg_agent_router --> pkg_llm
  pkg_agent_router --> pkg_session
  pkg_agent_router --> pkg_subagent
  pkg_agent_router --> pkg_system_prompt
  pkg_agent_router --> pkg_tools
  pkg_agent_router --> pkg_zen
  pkg_tool_memory_recall --> pkg_invariants
  pkg_tool_memory_recall --> pkg_llm
  pkg_tool_memory_recall --> pkg_session_query
  pkg_tool_memory_recall --> pkg_subagent
  pkg_tool_memory_recall --> pkg_system_prompt
  pkg_tool_memory_recall --> pkg_tools
  pkg_sdk_protocol --> pkg_invariants
  pkg_sdk_protocol --> pkg_llm
  pkg_sdk_protocol --> pkg_session
  pkg_sdk_protocol --> pkg_subagent
  pkg_next_workflow --> pkg_agent
  pkg_next_workflow --> pkg_bash
  pkg_next_workflow --> pkg_commands
  pkg_next_workflow --> pkg_git
  pkg_next_workflow --> pkg_invariants
  pkg_next_workflow --> pkg_llm
  pkg_next_workflow --> pkg_paths
  pkg_next_workflow --> pkg_session
  pkg_next_workflow --> pkg_subagent
  pkg_next_workflow --> pkg_tools
  pkg_tool_ralph --> pkg_agent
  pkg_tool_ralph --> pkg_invariants
  pkg_tool_ralph --> pkg_llm
  pkg_tool_ralph --> pkg_subagent
  pkg_tool_ralph --> pkg_system_prompt
  pkg_tool_ralph --> pkg_tools
  pkg_tool_ralph --> pkg_workflow
  pkg_workflow_workerthread --> pkg_agent
  pkg_workflow_workerthread --> pkg_brand
  pkg_workflow_workerthread --> pkg_invariants
  pkg_workflow_workerthread --> pkg_llm
  pkg_workflow_workerthread --> pkg_session
  pkg_workflow_workerthread --> pkg_subagent
  pkg_workflow_workerthread --> pkg_tools
  pkg_workflow_workerthread --> pkg_workflow
  pkg_compact_basic --> pkg_agent
  pkg_compact_basic --> pkg_commands
  pkg_compact_basic --> pkg_compact
  pkg_compact_basic --> pkg_compact_tool_result_prune
  pkg_compact_basic --> pkg_invariants
  pkg_compact_basic --> pkg_llm
  pkg_compact_basic --> pkg_model_roles
  pkg_compact_basic --> pkg_session
  pkg_compact_basic --> pkg_token_meter
  pkg_subagent_codex --> pkg_invariants
  pkg_subagent_codex --> pkg_llm
  pkg_subagent_codex --> pkg_sdk_protocol
  pkg_subagent_codex --> pkg_session
  pkg_subagent_codex --> pkg_subagent
  pkg_subagent_codex --> pkg_subprocess
  pkg_subagent_codex --> pkg_timeout
  pkg_subagent_fork --> pkg_agent
  pkg_subagent_fork --> pkg_invariants
  pkg_subagent_fork --> pkg_session
  pkg_subagent_fork --> pkg_subagent
  pkg_subagent_fork --> pkg_subagent_inprocess
  pkg_subagent_spawn --> pkg_invariants
  pkg_subagent_spawn --> pkg_subagent
  pkg_subagent_spawn --> pkg_subagent_inprocess
  pkg_client_ui_command --> pkg_client_connection
  pkg_client_ui_command --> pkg_client_locale
  pkg_client_ui_command --> pkg_client_runtime
  pkg_client_ui_command --> pkg_client_ui_conversation
  pkg_client_ui_command --> pkg_client_ui_primitives
  pkg_client_ui_command --> pkg_client_ui_slash
  pkg_client_ui_command --> pkg_client_ui_slots
  pkg_client_ui_command --> pkg_invariants
  pkg_client_ui_deliverables --> pkg_client_locale
  pkg_client_ui_deliverables --> pkg_client_runtime
  pkg_client_ui_deliverables --> pkg_client_ui_conversation
  pkg_client_ui_deliverables --> pkg_client_ui_slots
  pkg_client_ui_deliverables --> pkg_invariants
  pkg_client_ui_goal --> pkg_api_remotes
  pkg_client_ui_goal --> pkg_client_locale
  pkg_client_ui_goal --> pkg_client_runtime
  pkg_client_ui_goal --> pkg_client_ui_conversation
  pkg_client_ui_goal --> pkg_client_ui_primitives
  pkg_client_ui_goal --> pkg_client_ui_slots
  pkg_client_ui_goal --> pkg_goal
  pkg_client_ui_goal --> pkg_invariants
  pkg_client_ui_plan --> pkg_client_connection
  pkg_client_ui_plan --> pkg_client_locale
  pkg_client_ui_plan --> pkg_client_runtime
  pkg_client_ui_plan --> pkg_client_ui_conversation
  pkg_client_ui_plan --> pkg_client_ui_primitives
  pkg_client_ui_plan --> pkg_client_ui_slots
  pkg_client_ui_plan --> pkg_invariants
  pkg_client_ui_plan --> pkg_plan_mode
  pkg_client_ui_subagent --> pkg_client_locale
  pkg_client_ui_subagent --> pkg_client_runtime
  pkg_client_ui_subagent --> pkg_client_ui_conversation
  pkg_client_ui_subagent --> pkg_client_ui_primitives
  pkg_client_ui_subagent --> pkg_client_ui_slash
  pkg_client_ui_subagent --> pkg_client_ui_slots
  pkg_client_ui_subagent --> pkg_invariants
  pkg_client_ui_subagent --> pkg_subagent
  pkg_client_ui_subagent --> pkg_token_meter
  pkg_client_ui_tool --> pkg_client_connection
  pkg_client_ui_tool --> pkg_client_locale
  pkg_client_ui_tool --> pkg_client_runtime
  pkg_client_ui_tool --> pkg_client_ui_conversation
  pkg_client_ui_tool --> pkg_client_ui_primitives
  pkg_client_ui_tool --> pkg_client_ui_slots
  pkg_client_ui_tool --> pkg_invariants
  pkg_agent_spine_demo --> pkg_agent
  pkg_agent_spine_demo --> pkg_agent_loop
  pkg_agent_spine_demo --> pkg_bash_env
  pkg_agent_spine_demo --> pkg_goal
  pkg_agent_spine_demo --> pkg_goal_session
  pkg_agent_spine_demo --> pkg_invariants
  pkg_agent_spine_demo --> pkg_llm
  pkg_agent_spine_demo --> pkg_llm_retry
  pkg_agent_spine_demo --> pkg_paths
  pkg_agent_spine_demo --> pkg_scope
  pkg_agent_spine_demo --> pkg_session
  pkg_agent_spine_demo --> pkg_session_title
  pkg_agent_spine_demo --> pkg_skill
  pkg_agent_spine_demo --> pkg_skill_local
  pkg_agent_spine_demo --> pkg_system_prompt
  pkg_agent_spine_demo --> pkg_tasks_local
  pkg_agent_spine_demo --> pkg_tool_bash
  pkg_agent_spine_demo --> pkg_tool_goal
  pkg_agent_spine_demo --> pkg_tool_skill
  pkg_agent_spine_demo --> pkg_tool_tasks
  pkg_agent_spine_demo --> pkg_tools
  pkg_agent_spine_demo --> pkg_workspace_context
  pkg_jsonrpc --> pkg_agent
  pkg_jsonrpc --> pkg_invariants
  pkg_jsonrpc --> pkg_llm
  pkg_jsonrpc --> pkg_llm_deepseek
  pkg_jsonrpc --> pkg_scope
  pkg_jsonrpc --> pkg_sdk_protocol
  pkg_jsonrpc --> pkg_session
  pkg_jsonrpc --> pkg_subagent
  pkg_sdk_client --> pkg_invariants
  pkg_sdk_client --> pkg_llm
  pkg_sdk_client --> pkg_sdk_protocol
  pkg_sdk_client --> pkg_session
  pkg_subagent_dsh_sdk --> pkg_agent
  pkg_subagent_dsh_sdk --> pkg_invariants
  pkg_subagent_dsh_sdk --> pkg_llm
  pkg_subagent_dsh_sdk --> pkg_sdk_client
  pkg_subagent_dsh_sdk --> pkg_session
  pkg_subagent_dsh_sdk --> pkg_subagent
  pkg_subagent_dsh_sdk --> pkg_subprocess
  pkg_client_ui_model --> pkg_client_connection
  pkg_client_ui_model --> pkg_client_locale
  pkg_client_ui_model --> pkg_client_runtime
  pkg_client_ui_model --> pkg_client_ui_command
  pkg_client_ui_model --> pkg_client_ui_conversation
  pkg_client_ui_model --> pkg_client_ui_primitives
  pkg_client_ui_model --> pkg_client_ui_slash
  pkg_client_ui_model --> pkg_client_ui_slots
  pkg_client_ui_model --> pkg_invariants
  pkg_client_ui_permission --> pkg_client_connection
  pkg_client_ui_permission --> pkg_client_locale
  pkg_client_ui_permission --> pkg_client_runtime
  pkg_client_ui_permission --> pkg_client_schema_form
  pkg_client_ui_permission --> pkg_client_ui_command
  pkg_client_ui_permission --> pkg_client_ui_primitives
  pkg_client_ui_permission --> pkg_client_ui_slash
  pkg_client_ui_permission --> pkg_client_ui_slots
  pkg_client_ui_permission --> pkg_invariants
  pkg_client_ui_permission --> pkg_permission
  pkg_client_ui_skill --> pkg_client_connection
  pkg_client_ui_skill --> pkg_client_locale
  pkg_client_ui_skill --> pkg_client_runtime
  pkg_client_ui_skill --> pkg_client_ui_primitives
  pkg_client_ui_skill --> pkg_client_ui_slash
  pkg_client_ui_skill --> pkg_client_ui_slots
  pkg_client_ui_skill --> pkg_client_ui_tool
  pkg_client_ui_skill --> pkg_invariants
  pkg_acp_demo --> pkg_acp
  pkg_acp_demo --> pkg_agent_spine_demo
  pkg_acp_demo --> pkg_app_boot
  pkg_acp_demo --> pkg_invariants
  pkg_acp_demo --> pkg_session_checkpoint_policy
  pkg_acp_demo --> pkg_session_persistence_jsonl
  pkg_acp_demo --> pkg_session_query
  pkg_acp_demo --> pkg_session_query_sqlite
  pkg_acp_demo --> pkg_tools
  pkg_acp_demo --> pkg_workspace_context
  pkg_ui_cordis --> pkg_api_remotes
  pkg_ui_cordis --> pkg_client_connection
  pkg_ui_cordis --> pkg_client_locale
  pkg_ui_cordis --> pkg_client_runtime
  pkg_ui_cordis --> pkg_client_ui_input_trigger
  pkg_ui_cordis --> pkg_client_ui_primitives
  pkg_ui_cordis --> pkg_client_ui_sidebar
  pkg_ui_cordis --> pkg_client_ui_slots
  pkg_ui_cordis --> pkg_client_ui_tool
  pkg_ui_cordis --> pkg_cordis_client_runner
  pkg_ui_cordis --> pkg_invariants
```

| 包 | 分组 | 依赖项 |
| --- | --- | --- |
| [`invariants`](../packages/support/invariants) | `support` | — |
| [`atomic-write`](../packages/util/atomic-write) | `util` | [`invariants`](../packages/support/invariants) |
| [`brand`](../packages/util/brand) | `util` | [`invariants`](../packages/support/invariants) |
| [`environment`](../packages/util/environment) | `util` | [`invariants`](../packages/support/invariants) |
| [`native-command`](../packages/util/native-command) | `util` | [`invariants`](../packages/support/invariants) |
| [`paths`](../packages/util/paths) | `util` | [`invariants`](../packages/support/invariants) |
| [`retention`](../packages/util/retention) | `util` | [`invariants`](../packages/support/invariants) |
| [`timeout`](../packages/util/timeout) | `util` | [`invariants`](../packages/support/invariants) |
| [`scope`](../packages/core/scope) | `core` | [`invariants`](../packages/support/invariants) |
| [`llm-mock-server`](../packages/support/llm-mock-server) | `support` | [`invariants`](../packages/support/invariants) |
| [`base`](../packages/bundle/base) | `bundle` | [`invariants`](../packages/support/invariants) |
| [`client-modules`](../packages/client/modules) | `client` | [`invariants`](../packages/support/invariants) |
| [`client-schema-form`](../packages/client/schema-form) | `client` | [`invariants`](../packages/support/invariants) |
| [`client-ui-primitives`](../packages/client/ui-primitives) | `client` | [`invariants`](../packages/support/invariants) |
| [`client-ui-slots`](../packages/client/ui-slots) | `client` | [`invariants`](../packages/support/invariants) |
| [`client-web`](../packages/client/web) | `client` | [`invariants`](../packages/support/invariants) |
| [`client-web-react`](../packages/client/web-react) | `client` | [`invariants`](../packages/support/invariants) |
| [`code-runtime`](../packages/code-runtime/code-runtime) | `code-runtime` | [`invariants`](../packages/support/invariants) |
| [`code-runtime-python`](../packages/code-runtime/code-runtime-python) | `code-runtime` | [`invariants`](../packages/support/invariants) |
| [`e2b`](../packages/e2b/e2b) | `e2b` | [`invariants`](../packages/support/invariants) |
| [`jsonrpc-demo`](../packages/examples/jsonrpc-demo) | `examples` | [`invariants`](../packages/support/invariants) |
| [`git`](../packages/git/git) | `git` | [`invariants`](../packages/support/invariants) |
| [`host-apiproxy`](../packages/host/apiproxy) | `host` | [`invariants`](../packages/support/invariants) |
| [`host-directory-picker`](../packages/host/directory-picker) | `host` | [`invariants`](../packages/support/invariants) |
| [`host-webserver`](../packages/host/webserver) | `host` | [`invariants`](../packages/support/invariants) |
| [`memory`](../packages/memory/memory) | `memory` | [`invariants`](../packages/support/invariants) |
| [`sandbox-windows-acl`](../packages/sandbox/sandbox-windows-acl) | `sandbox` | [`invariants`](../packages/support/invariants) |
| [`semantic-index`](../packages/search/semantic-index) | `search` | [`invariants`](../packages/support/invariants) |
| [`storage`](../packages/storage/storage) | `storage` | [`invariants`](../packages/support/invariants) |
| [`subprocess`](../packages/subprocess/subprocess) | `subprocess` | [`invariants`](../packages/support/invariants) |
| [`type-meta`](../packages/typert/type-meta) | `typert` | [`invariants`](../packages/support/invariants) |
| [`typert-generator`](../packages/typert/generator) | `typert` | [`invariants`](../packages/support/invariants) |
| [`typert-registry`](../packages/typert/registry) | `typert` | [`invariants`](../packages/support/invariants) |
| [`llm`](../packages/llm/llm) | `llm` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`timeout`](../packages/util/timeout) |
| [`attachment`](../packages/attachment/attachment) | `attachment` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants) |
| [`client-connection`](../packages/client/connection) | `client` | [`host-webserver`](../packages/host/webserver), [`invariants`](../packages/support/invariants) |
| [`client-hmr`](../packages/client/hmr) | `client` | [`client-modules`](../packages/client/modules), [`host-webserver`](../packages/host/webserver), [`invariants`](../packages/support/invariants) |
| [`client-runtime`](../packages/client/runtime) | `client` | [`invariants`](../packages/support/invariants), [`type-meta`](../packages/typert/type-meta), [`typert-registry`](../packages/typert/registry) |
| [`credentials`](../packages/credentials/credentials) | `credentials` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants) |
| [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | `e2b` | [`e2b`](../packages/e2b/e2b), [`invariants`](../packages/support/invariants), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`pheromone`](../packages/guard/pheromone) | `guard` | [`atomic-write`](../packages/util/atomic-write), [`invariants`](../packages/support/invariants) |
| [`frontend-static`](../packages/host/frontend-static) | `host` | [`host-webserver`](../packages/host/webserver), [`invariants`](../packages/support/invariants) |
| [`host-plugin-inventory`](../packages/host/plugin-inventory) | `host` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`type-meta`](../packages/typert/type-meta) |
| [`anonymous-user-id`](../packages/identity/anonymous-user-id) | `identity` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths) |
| [`settings`](../packages/settings/settings) | `settings` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants) |
| [`storage-domain`](../packages/storage/storage-domain) | `storage` | [`invariants`](../packages/support/invariants), [`storage`](../packages/storage/storage) |
| [`storage-json`](../packages/storage/storage-json) | `storage` | [`invariants`](../packages/support/invariants), [`storage`](../packages/storage/storage) |
| [`storage-sqlite`](../packages/storage/storage-sqlite) | `storage` | [`invariants`](../packages/support/invariants), [`storage`](../packages/storage/storage) |
| [`subprocess-local`](../packages/subprocess/subprocess-local) | `subprocess` | [`invariants`](../packages/support/invariants), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`typert-loader`](../packages/typert/loader) | `typert` | [`invariants`](../packages/support/invariants), [`typert-registry`](../packages/typert/registry) |
| [`llm-deepseek`](../packages/llm/llm-deepseek) | `llm` | [`credentials`](../packages/credentials/credentials), [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`settings`](../packages/settings/settings), [`timeout`](../packages/util/timeout) |
| [`tool-json-repair`](../packages/llm/tool-json-repair) | `llm` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`model-roles`](../packages/core/model-roles) | `core` | [`invariants`](../packages/support/invariants), [`settings`](../packages/settings/settings) |
| [`session`](../packages/core/session) | `core` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`type-meta`](../packages/typert/type-meta) |
| [`system-prompt`](../packages/core/system-prompt) | `core` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope) |
| [`skill`](../packages/skill/skill) | `skill` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`web`](../packages/web/web) | `web` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`api-gateway`](../packages/api/gateway) | `api` | [`client-connection`](../packages/client/connection), [`invariants`](../packages/support/invariants), [`typert-registry`](../packages/typert/registry) |
| [`attachment-local`](../packages/attachment/attachment-local) | `attachment` | [`attachment`](../packages/attachment/attachment), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths) |
| [`client-locale`](../packages/client/locale) | `client` | [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-test-runtime`](../packages/client/test-runtime) | `client` | [`client-runtime`](../packages/client/runtime), [`client-ui-slots`](../packages/client/ui-slots), [`client-web-react`](../packages/client/web-react), [`host-apiproxy`](../packages/host/apiproxy), [`invariants`](../packages/support/invariants) |
| [`client-ui-models`](../packages/client/ui-models) | `client` | [`client-connection`](../packages/client/connection), [`client-runtime`](../packages/client/runtime), [`client-schema-form`](../packages/client/schema-form), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`client-web-react`](../packages/client/web-react), [`invariants`](../packages/support/invariants) |
| [`client-ui-settings`](../packages/client/ui-settings) | `client` | [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-trajectory`](../packages/client/ui-trajectory) | `client` | [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`invariants`](../packages/support/invariants) |
| [`authorization`](../packages/credentials/authorization) | `credentials` | [`credentials`](../packages/credentials/credentials), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`credentials-local`](../packages/credentials/credentials-local) | `credentials` | [`atomic-write`](../packages/util/atomic-write), [`credentials`](../packages/credentials/credentials), [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths) |
| [`lsp`](../packages/lsp/lsp) | `lsp` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`memory-sqlite`](../packages/memory/memory-sqlite) | `memory` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`memory`](../packages/memory/memory), [`semantic-index`](../packages/search/semantic-index), [`timeout`](../packages/util/timeout) |
| [`sandbox`](../packages/sandbox/sandbox) | `sandbox` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`meridian`](../packages/search/meridian) | `search` | [`invariants`](../packages/support/invariants), [`pheromone`](../packages/guard/pheromone) |
| [`settings-local`](../packages/settings/settings-local) | `settings` | [`atomic-write`](../packages/util/atomic-write), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths), [`settings`](../packages/settings/settings) |
| [`llm-pi-ai`](../packages/llm/llm-pi-ai) | `llm` | [`authorization`](../packages/credentials/authorization), [`credentials`](../packages/credentials/credentials), [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`settings`](../packages/settings/settings), [`timeout`](../packages/util/timeout) |
| [`agent`](../packages/core/agent) | `core` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`type-meta`](../packages/typert/type-meta) |
| [`bash`](../packages/bash/bash) | `bash` | [`invariants`](../packages/support/invariants), [`sandbox`](../packages/sandbox/sandbox), [`subprocess`](../packages/subprocess/subprocess) |
| [`fs`](../packages/fs/fs) | `fs` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sandbox`](../packages/sandbox/sandbox) |
| [`skill-badge`](../packages/skill/skill-badge) | `skill` | [`invariants`](../packages/support/invariants), [`skill`](../packages/skill/skill) |
| [`web-fetch-local`](../packages/web/web-fetch-local) | `web` | [`invariants`](../packages/support/invariants), [`timeout`](../packages/util/timeout), [`web`](../packages/web/web) |
| [`web-search-exa`](../packages/web/web-search-exa) | `web` | [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`web`](../packages/web/web) |
| [`web-search-perplexity`](../packages/web/web-search-perplexity) | `web` | [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`web`](../packages/web/web) |
| [`spill`](../packages/spill/spill) | `spill` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`acp-snapshot`](../packages/support/acp-snapshot) | `support` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`app-boot`](../packages/boot/app-boot) | `boot` | [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths), [`system-prompt`](../packages/core/system-prompt) |
| [`client-ui-input-trigger`](../packages/client/ui-input-trigger) | `client` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-question`](../packages/client/ui-question) | `client` | [`client-locale`](../packages/client/locale), [`invariants`](../packages/support/invariants) |
| [`client-ui-settings-general`](../packages/client/ui-settings-general) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-settings`](../packages/client/ui-settings), [`client-ui-slots`](../packages/client/ui-slots), [`client-web-react`](../packages/client/web-react), [`invariants`](../packages/support/invariants) |
| [`client-ui-sidebar`](../packages/client/ui-sidebar) | `client` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-slash`](../packages/client/ui-slash) | `client` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-theme`](../packages/client/ui-theme) | `client` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-workspace`](../packages/client/ui-workspace) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`code-runtime-worker`](../packages/code-runtime/code-runtime-worker) | `code-runtime` | [`code-runtime`](../packages/code-runtime/code-runtime), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`timeout`](../packages/util/timeout) |
| [`memory-consolidate`](../packages/memory/memory-consolidate) | `memory` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`memory`](../packages/memory/memory), [`session`](../packages/core/session), [`timeout`](../packages/util/timeout) |
| [`persona`](../packages/preset/persona) | `preset` | [`invariants`](../packages/support/invariants), [`system-prompt`](../packages/core/system-prompt) |
| [`sandbox-local`](../packages/sandbox/sandbox-local) | `sandbox` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sandbox`](../packages/sandbox/sandbox), [`session`](../packages/core/session) |
| [`session-persistence`](../packages/session/session-persistence) | `session` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`timeout`](../packages/util/timeout) |
| [`session-projection`](../packages/session/session-projection) | `session` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`llm-retry`](../packages/llm/llm-retry) | `llm` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`timeout`](../packages/util/timeout) |
| [`agent-default-model`](../packages/core/agent-default-model) | `core` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`settings`](../packages/settings/settings) |
| [`goal`](../packages/goal/goal) | `goal` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection), [`type-meta`](../packages/typert/type-meta) |
| [`bash-local`](../packages/bash/bash-local) | `bash` | [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`pwsh-local`](../packages/bash/pwsh-local) | `bash` | [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`fs-local`](../packages/fs/fs-local) | `fs` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants) |
| [`fs-policy`](../packages/fs/fs-policy) | `fs` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants) |
| [`skill-local`](../packages/skill/skill-local) | `skill` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths), [`skill`](../packages/skill/skill) |
| [`agent-definitions`](../packages/subagent/agent-definitions) | `subagent` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths), [`skill`](../packages/skill/skill) |
| [`web-search-deepseek`](../packages/web/web-search-deepseek) | `web` | [`agent`](../packages/core/agent), [`credentials`](../packages/credentials/credentials), [`environment`](../packages/util/environment), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`web`](../packages/web/web) |
| [`spill-local`](../packages/spill/spill-local) | `spill` | [`invariants`](../packages/support/invariants), [`spill`](../packages/spill/spill) |
| [`hook-protocol`](../packages/hooks/hook-protocol) | `hooks` | [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`loader-smoke`](../packages/support/loader-smoke) | `support` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`client-ui-layout`](../packages/client/ui-layout) | `client` | [`client-runtime`](../packages/client/runtime), [`client-ui-slots`](../packages/client/ui-slots), [`client-ui-theme`](../packages/client/ui-theme), [`invariants`](../packages/support/invariants) |
| [`spark-anchors`](../packages/context/spark-anchors) | `context` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`llm-deepseek`](../packages/llm/llm-deepseek), [`session`](../packages/core/session), [`settings`](../packages/settings/settings) |
| [`time-context`](../packages/context/time-context) | `context` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`tmux-context`](../packages/context/tmux-context) | `context` | [`agent`](../packages/core/agent), [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`vision-bridge`](../packages/context/vision-bridge) | `context` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`session`](../packages/core/session) |
| [`fs-e2b`](../packages/e2b/fs-e2b) | `e2b` | [`e2b`](../packages/e2b/e2b), [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants) |
| [`message-feedback`](../packages/feedback/message-feedback) | `feedback` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`storage-domain`](../packages/storage/storage-domain), [`type-meta`](../packages/typert/type-meta) |
| [`task-card`](../packages/guard/task-card) | `guard` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`timeout`](../packages/util/timeout) |
| [`host-directory-picker-browse`](../packages/host/directory-picker-browse) | `host` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`client-ui-workspace`](../packages/client/ui-workspace), [`invariants`](../packages/support/invariants) |
| [`host-directory-picker-native`](../packages/host/directory-picker-native) | `host` | [`client-runtime`](../packages/client/runtime), [`client-ui-slots`](../packages/client/ui-slots), [`client-ui-workspace`](../packages/client/ui-workspace), [`invariants`](../packages/support/invariants) |
| [`commands`](../packages/interaction/commands) | `interaction` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session) |
| [`user-approval`](../packages/interaction/user-approval) | `interaction` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt) |
| [`user-interaction`](../packages/interaction/user-interaction) | `interaction` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`lsp-local`](../packages/lsp/lsp-local) | `lsp` | [`brand`](../packages/util/brand), [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`lsp`](../packages/lsp/lsp), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`agent-presets`](../packages/preset/agent-presets) | `preset` | [`agent`](../packages/core/agent), [`atomic-write`](../packages/util/atomic-write), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`settings`](../packages/settings/settings), [`system-prompt`](../packages/core/system-prompt) |
| [`pty`](../packages/pty/pty) | `pty` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants) |
| [`sandbox-policy`](../packages/sandbox/sandbox-policy) | `sandbox` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`sandbox`](../packages/sandbox/sandbox), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt) |
| [`session-persistence-jsonl`](../packages/session/session-persistence-jsonl) | `session` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence) |
| [`session-persistence-sqlite`](../packages/session/session-persistence-sqlite) | `session` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence) |
| [`session-projection-cache`](../packages/session/session-projection-cache) | `session` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`session-projection`](../packages/session/session-projection), [`storage-domain`](../packages/storage/storage-domain) |
| [`session-stats`](../packages/session/session-stats) | `session` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection) |
| [`session-telemetry`](../packages/session/session-telemetry) | `session` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`session-title`](../packages/session/session-title) | `session` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection) |
| [`tasks`](../packages/tasks/tasks) | `tasks` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`workflow`](../packages/workflow/workflow) | `workflow` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`workspace`](../packages/workspace/workspace) | `workspace` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`storage`](../packages/storage/storage), [`storage-domain`](../packages/storage/storage-domain) |
| [`tools`](../packages/core/tools) | `core` | [`agent`](../packages/core/agent), [`code-runtime`](../packages/code-runtime/code-runtime), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`user-approval`](../packages/interaction/user-approval) |
| [`command-goal`](../packages/goal/command-goal) | `goal` | [`commands`](../packages/interaction/commands), [`goal`](../packages/goal/goal), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm) |
| [`goal-session`](../packages/goal/goal-session) | `goal` | [`agent`](../packages/core/agent), [`goal`](../packages/goal/goal), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`bash-sandbox`](../packages/bash/bash-sandbox) | `bash` | [`bash`](../packages/bash/bash), [`bash-local`](../packages/bash/bash-local), [`invariants`](../packages/support/invariants), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy) |
| [`pwsh-sandbox`](../packages/bash/pwsh-sandbox) | `bash` | [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`pwsh-local`](../packages/bash/pwsh-local), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy) |
| [`fs-sandbox`](../packages/fs/fs-sandbox) | `fs` | [`fs`](../packages/fs/fs), [`fs-local`](../packages/fs/fs-local), [`invariants`](../packages/support/invariants), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy) |
| [`compact`](../packages/compact/compact) | `compact` | [`brand`](../packages/util/brand), [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`session-query`](../packages/session-query/session-query) | `session-query` | [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`session-title`](../packages/session/session-title) |
| [`acp`](../packages/acp/acp) | `acp` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`user-approval`](../packages/interaction/user-approval) |
| [`api-remotes`](../packages/api/remotes) | `api` | [`agent`](../packages/core/agent), [`goal`](../packages/goal/goal), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`typert-registry`](../packages/typert/registry) |
| [`headless`](../packages/bundle/headless) | `bundle` | [`agent`](../packages/core/agent), [`agent-default-model`](../packages/core/agent-default-model), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`command-feedback`](../packages/feedback/command-feedback) | `feedback` | [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session) |
| [`host-directory-picker-auto`](../packages/host/directory-picker-auto) | `host` | [`host-directory-picker-browse`](../packages/host/directory-picker-browse), [`host-directory-picker-native`](../packages/host/directory-picker-native), [`host-webserver`](../packages/host/webserver), [`invariants`](../packages/support/invariants) |
| [`approval-rules`](../packages/interaction/approval-rules) | `interaction` | [`agent`](../packages/core/agent), [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`paths`](../packages/util/paths), [`session`](../packages/core/session), [`user-approval`](../packages/interaction/user-approval) |
| [`command-files`](../packages/interaction/command-files) | `interaction` | [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`paths`](../packages/util/paths) |
| [`output-style`](../packages/interaction/output-style) | `interaction` | [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`settings`](../packages/settings/settings), [`system-prompt`](../packages/core/system-prompt) |
| [`permission`](../packages/interaction/permission) | `interaction` | [`bash`](../packages/bash/bash), [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection), [`settings`](../packages/settings/settings), [`user-approval`](../packages/interaction/user-approval) |
| [`command-memory`](../packages/memory/command-memory) | `memory` | [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants) |
| [`memory-pipeline`](../packages/memory/memory-pipeline) | `memory` | [`atomic-write`](../packages/util/atomic-write), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`memory`](../packages/memory/memory), [`memory-consolidate`](../packages/memory/memory-consolidate), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`tasks`](../packages/tasks/tasks), [`timeout`](../packages/util/timeout) |
| [`pty-local`](../packages/pty/pty-local) | `pty` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`pty`](../packages/pty/pty), [`pwsh-local`](../packages/bash/pwsh-local), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`session`](../packages/core/session), [`subprocess`](../packages/subprocess/subprocess) |
| [`session-title-llm`](../packages/session/session-title-llm) | `session` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`session`](../packages/core/session), [`session-title`](../packages/session/session-title), [`timeout`](../packages/util/timeout) |
| [`tasks-local`](../packages/tasks/tasks-local) | `tasks` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`tasks`](../packages/tasks/tasks), [`timeout`](../packages/util/timeout) |
| [`cache-diagnostic`](../packages/llm/cache-diagnostic) | `llm` | [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection) |
| [`token-meter`](../packages/llm/token-meter) | `llm` | [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection) |
| [`agent-loop`](../packages/core/agent-loop) | `core` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`agent-tool-presentation`](../packages/core/agent-tool-presentation) | `core` | [`invariants`](../packages/support/invariants), [`tools`](../packages/core/tools) |
| [`tool-goal`](../packages/goal/tool-goal) | `goal` | [`agent`](../packages/core/agent), [`goal`](../packages/goal/goal), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`bash-env`](../packages/bash/bash-env) | `bash` | [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`paths`](../packages/util/paths), [`session-persistence`](../packages/session/session-persistence), [`tools`](../packages/core/tools) |
| [`fs-snapshot`](../packages/fs/fs-snapshot) | `fs` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`tools`](../packages/core/tools) |
| [`tool-file-info`](../packages/fs/tool-file-info) | `fs` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`pheromone`](../packages/guard/pheromone), [`session`](../packages/core/session), [`tools`](../packages/core/tools) |
| [`tool-fs`](../packages/fs/tool-fs) | `fs` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`user-approval`](../packages/interaction/user-approval) |
| [`tool-fs-search`](../packages/fs/tool-fs-search) | `fs` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`retention`](../packages/util/retention), [`session`](../packages/core/session), [`spill`](../packages/spill/spill), [`subprocess`](../packages/subprocess/subprocess), [`system-prompt`](../packages/core/system-prompt), [`timeout`](../packages/util/timeout), [`tools`](../packages/core/tools) |
| [`tool-str-replace-editor`](../packages/fs/tool-str-replace-editor) | `fs` | [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`tools`](../packages/core/tools) |
| [`tool-skill`](../packages/skill/tool-skill) | `skill` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`skill`](../packages/skill/skill), [`tools`](../packages/core/tools) |
| [`command-compact`](../packages/compact/command-compact) | `compact` | [`commands`](../packages/interaction/commands), [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants) |
| [`subagent`](../packages/subagent/subagent) | `subagent` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`session-projection`](../packages/session/session-projection), [`session-projection-cache`](../packages/session/session-projection-cache), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools) |
| [`tool-web`](../packages/web/tool-web) | `web` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`web`](../packages/web/web) |
| [`spill-policy`](../packages/spill/spill-policy) | `spill` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`retention`](../packages/util/retention), [`session`](../packages/core/session), [`spill`](../packages/spill/spill), [`tools`](../packages/core/tools) |
| [`tool-todo`](../packages/todo/tool-todo) | `todo` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection), [`tools`](../packages/core/tools) |
| [`plan-mode`](../packages/plan/plan-mode) | `plan` | [`agent`](../packages/core/agent), [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`paths`](../packages/util/paths), [`session`](../packages/core/session), [`session-projection`](../packages/session/session-projection), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`user-interaction`](../packages/interaction/user-interaction) |
| [`hooks-codex`](../packages/hooks/hooks-codex) | `hooks` | [`agent`](../packages/core/agent), [`hook-protocol`](../packages/hooks/hook-protocol), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`tools`](../packages/core/tools) |
| [`session-query-sqlite`](../packages/session-query/session-query-sqlite) | `session-query` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`session-query`](../packages/session-query/session-query) |
| [`tool-session-query`](../packages/session-query/tool-session-query) | `session-query` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-query`](../packages/session-query/session-query), [`system-prompt`](../packages/core/system-prompt), [`timeout`](../packages/util/timeout), [`tools`](../packages/core/tools) |
| [`agent-loop-testkit`](../packages/support/agent-loop-testkit) | `support` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`llm-replay`](../packages/support/llm-replay) | `support` | [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session) |
| [`session-reference`](../packages/context/session-reference) | `context` | [`agent`](../packages/core/agent), [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`retention`](../packages/util/retention), [`session`](../packages/core/session), [`session-query`](../packages/session-query/session-query) |
| [`workspace-context`](../packages/context/workspace-context) | `context` | [`agent`](../packages/core/agent), [`fs`](../packages/fs/fs), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`paths`](../packages/util/paths), [`session`](../packages/core/session), [`tools`](../packages/core/tools) |
| [`tool-git`](../packages/git/tool-git) | `git` | [`git`](../packages/git/git), [`invariants`](../packages/support/invariants), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`doom-loop-guard`](../packages/guard/doom-loop-guard) | `guard` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`tools`](../packages/core/tools) |
| [`evidence-gate`](../packages/guard/evidence-gate) | `guard` | [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`tools`](../packages/core/tools) |
| [`intent-bridge`](../packages/guard/intent-bridge) | `guard` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-title`](../packages/session/session-title), [`task-card`](../packages/guard/task-card), [`tools`](../packages/core/tools) |
| [`repeat-tool-guard`](../packages/guard/repeat-tool-guard) | `guard` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`tools`](../packages/core/tools) |
| [`timeout-policy`](../packages/guard/timeout-policy) | `guard` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`timeout`](../packages/util/timeout), [`tools`](../packages/core/tools) |
| [`zen`](../packages/guard/zen) | `guard` | [`agent`](../packages/core/agent), [`commands`](../packages/interaction/commands), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`tool-ask-user`](../packages/interaction/tool-ask-user) | `interaction` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`tools`](../packages/core/tools), [`user-interaction`](../packages/interaction/user-interaction) |
| [`tool-lsp`](../packages/lsp/tool-lsp) | `lsp` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`lsp`](../packages/lsp/lsp), [`system-prompt`](../packages/core/system-prompt), [`timeout`](../packages/util/timeout), [`tools`](../packages/core/tools) |
| [`mcp-client`](../packages/mcp/mcp-client) | `mcp` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`subprocess`](../packages/subprocess/subprocess), [`tools`](../packages/core/tools) |
| [`adaptive-memory`](../packages/memory/adaptive-memory) | `memory` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`memory`](../packages/memory/memory), [`session`](../packages/core/session), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`tool-memory`](../packages/memory/tool-memory) | `memory` | [`invariants`](../packages/support/invariants), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`tool-bash-persistent`](../packages/pty/tool-bash-persistent) | `pty` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`pty`](../packages/pty/pty), [`timeout`](../packages/util/timeout), [`tools`](../packages/core/tools) |
| [`tool-pty`](../packages/pty/tool-pty) | `pty` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`pty`](../packages/pty/pty), [`retention`](../packages/util/retention), [`system-prompt`](../packages/core/system-prompt), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools) |
| [`tool-pwsh-persistent`](../packages/pty/tool-pwsh-persistent) | `pty` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`pty`](../packages/pty/pty), [`timeout`](../packages/util/timeout), [`tools`](../packages/core/tools) |
| [`schedule`](../packages/schedule/schedule) | `schedule` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`tools`](../packages/core/tools) |
| [`tool-meridian`](../packages/search/tool-meridian) | `search` | [`invariants`](../packages/support/invariants), [`meridian`](../packages/search/meridian), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`tool-semantic-search`](../packages/search/tool-semantic-search) | `search` | [`invariants`](../packages/support/invariants), [`semantic-index`](../packages/search/semantic-index), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`cordis-client-runner`](../packages/self-modification/cordis-client-runner) | `self-modification` | [`api-remotes`](../packages/api/remotes), [`client-connection`](../packages/client/connection), [`client-modules`](../packages/client/modules), [`client-runtime`](../packages/client/runtime), [`client-ui-slots`](../packages/client/ui-slots), [`client-ui-theme`](../packages/client/ui-theme), [`invariants`](../packages/support/invariants) |
| [`cordis-host-runner`](../packages/self-modification/cordis-host-runner) | `self-modification` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`tools`](../packages/core/tools), [`type-meta`](../packages/typert/type-meta) |
| [`tool-cordis`](../packages/self-modification/tool-cordis) | `self-modification` | [`invariants`](../packages/support/invariants), [`scope`](../packages/core/scope), [`tools`](../packages/core/tools) |
| [`session-checkpoint-policy`](../packages/session/session-checkpoint-policy) | `session` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`tools`](../packages/core/tools) |
| [`session-telemetry-otel`](../packages/session/session-telemetry-otel) | `session` | [`anonymous-user-id`](../packages/identity/anonymous-user-id), [`brand`](../packages/util/brand), [`command-feedback`](../packages/feedback/command-feedback), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`paths`](../packages/util/paths), [`session`](../packages/core/session), [`session-telemetry`](../packages/session/session-telemetry) |
| [`session-title-all-messages-llm`](../packages/session/session-title-all-messages-llm) | `session` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-title`](../packages/session/session-title), [`session-title-llm`](../packages/session/session-title-llm) |
| [`session-title-first-message-llm`](../packages/session/session-title-first-message-llm) | `session` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-title`](../packages/session/session-title), [`session-title-llm`](../packages/session/session-title-llm) |
| [`tool-tasks`](../packages/tasks/tool-tasks) | `tasks` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`retention`](../packages/util/retention), [`system-prompt`](../packages/core/system-prompt), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools) |
| [`tool-run-tests`](../packages/tests/tool-run-tests) | `tests` | [`bash`](../packages/bash/bash), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools) |
| [`tui`](../packages/tui/tui) | `tui` | [`agent`](../packages/core/agent), [`agent-default-model`](../packages/core/agent-default-model), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`session`](../packages/core/session), [`session-title`](../packages/session/session-title), [`tools`](../packages/core/tools), [`user-interaction`](../packages/interaction/user-interaction) |
| [`vision-ask`](../packages/tui/vision-ask) | `tui` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`tools`](../packages/core/tools) |
| [`tool-workflow`](../packages/workflow/tool-workflow) | `workflow` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`workflow`](../packages/workflow/workflow) |
| [`tool-bash`](../packages/bash/tool-bash) | `bash` | [`agent`](../packages/core/agent), [`bash`](../packages/bash/bash), [`bash-env`](../packages/bash/bash-env), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sandbox`](../packages/sandbox/sandbox), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`system-prompt`](../packages/core/system-prompt), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools), [`user-approval`](../packages/interaction/user-approval) |
| [`tool-pwsh`](../packages/bash/tool-pwsh) | `bash` | [`agent`](../packages/core/agent), [`bash`](../packages/bash/bash), [`bash-env`](../packages/bash/bash-env), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`system-prompt`](../packages/core/system-prompt), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools) |
| [`compact-tool-result-prune`](../packages/compact/compact-tool-result-prune) | `compact` | [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`token-meter`](../packages/llm/token-meter) |
| [`subagent-acp`](../packages/subagent/subagent-acp) | `subagent` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`subagent-claude-code`](../packages/subagent/subagent-claude-code) | `subagent` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`subagent-inprocess`](../packages/subagent/subagent-inprocess) | `subagent` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`sandbox-policy`](../packages/sandbox/sandbox-policy), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`user-approval`](../packages/interaction/user-approval) |
| [`tool-subagent`](../packages/subagent/tool-subagent) | `subagent` | [`agent`](../packages/core/agent), [`agent-definitions`](../packages/subagent/agent-definitions), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`skill`](../packages/skill/skill), [`subagent`](../packages/subagent/subagent), [`tasks`](../packages/tasks/tasks), [`tools`](../packages/core/tools) |
| [`tool-subagent-control`](../packages/subagent/tool-subagent-control) | `subagent` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`skill`](../packages/skill/skill), [`subagent`](../packages/subagent/subagent), [`tools`](../packages/core/tools) |
| [`tool-subagent-report`](../packages/subagent/tool-subagent-report) | `subagent` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`skill`](../packages/skill/skill), [`subagent`](../packages/subagent/subagent), [`tools`](../packages/core/tools) |
| [`hooks-claude`](../packages/hooks/hooks-claude) | `hooks` | [`agent`](../packages/core/agent), [`hook-protocol`](../packages/hooks/hook-protocol), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`session-persistence`](../packages/session/session-persistence), [`subagent`](../packages/subagent/subagent), [`tools`](../packages/core/tools) |
| [`web-app`](../packages/bundle/web-app) | `bundle` | [`bash-env`](../packages/bash/bash-env), [`invariants`](../packages/support/invariants), [`system-prompt`](../packages/core/system-prompt) |
| [`client-ui-conversation`](../packages/client/ui-conversation) | `client` | [`agent`](../packages/core/agent), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slash`](../packages/client/ui-slash), [`client-ui-slots`](../packages/client/ui-slots), [`commands`](../packages/interaction/commands), [`compact`](../packages/compact/compact), [`invariants`](../packages/support/invariants), [`llm-retry`](../packages/llm/llm-retry), [`token-meter`](../packages/llm/token-meter), [`tools`](../packages/core/tools) |
| [`agent-router`](../packages/guard/agent-router) | `guard` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`zen`](../packages/guard/zen) |
| [`tool-memory-recall`](../packages/memory/tool-memory-recall) | `memory` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session-query`](../packages/session-query/session-query), [`subagent`](../packages/subagent/subagent), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools) |
| [`sdk-protocol`](../packages/scaffold/protocol) | `scaffold` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent) |
| [`next-workflow`](../packages/workflow/next-workflow) | `workflow` | [`agent`](../packages/core/agent), [`bash`](../packages/bash/bash), [`commands`](../packages/interaction/commands), [`git`](../packages/git/git), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`paths`](../packages/util/paths), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`tools`](../packages/core/tools) |
| [`tool-ralph`](../packages/workflow/tool-ralph) | `workflow` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`subagent`](../packages/subagent/subagent), [`system-prompt`](../packages/core/system-prompt), [`tools`](../packages/core/tools), [`workflow`](../packages/workflow/workflow) |
| [`workflow-workerthread`](../packages/workflow/workflow-workerthread) | `workflow` | [`agent`](../packages/core/agent), [`brand`](../packages/util/brand), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`tools`](../packages/core/tools), [`workflow`](../packages/workflow/workflow) |
| [`compact-basic`](../packages/compact/compact-basic) | `compact` | [`agent`](../packages/core/agent), [`commands`](../packages/interaction/commands), [`compact`](../packages/compact/compact), [`compact-tool-result-prune`](../packages/compact/compact-tool-result-prune), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`model-roles`](../packages/core/model-roles), [`session`](../packages/core/session), [`token-meter`](../packages/llm/token-meter) |
| [`subagent-codex`](../packages/subagent/subagent-codex) | `subagent` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sdk-protocol`](../packages/scaffold/protocol), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`subprocess`](../packages/subprocess/subprocess), [`timeout`](../packages/util/timeout) |
| [`subagent-fork`](../packages/subagent/subagent-fork) | `subagent` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`subagent-inprocess`](../packages/subagent/subagent-inprocess) |
| [`subagent-spawn`](../packages/subagent/subagent-spawn) | `subagent` | [`invariants`](../packages/support/invariants), [`subagent`](../packages/subagent/subagent), [`subagent-inprocess`](../packages/subagent/subagent-inprocess) |
| [`client-ui-command`](../packages/client/ui-command) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slash`](../packages/client/ui-slash), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-deliverables`](../packages/client/ui-deliverables) | `client` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-goal`](../packages/client/ui-goal) | `client` | [`api-remotes`](../packages/api/remotes), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`goal`](../packages/goal/goal), [`invariants`](../packages/support/invariants) |
| [`client-ui-plan`](../packages/client/ui-plan) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants), [`plan-mode`](../packages/plan/plan-mode) |
| [`client-ui-subagent`](../packages/client/ui-subagent) | `client` | [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slash`](../packages/client/ui-slash), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants), [`subagent`](../packages/subagent/subagent), [`token-meter`](../packages/llm/token-meter) |
| [`client-ui-tool`](../packages/client/ui-tool) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`agent-spine-demo`](../packages/examples/agent-spine-demo) | `examples` | [`agent`](../packages/core/agent), [`agent-loop`](../packages/core/agent-loop), [`bash-env`](../packages/bash/bash-env), [`goal`](../packages/goal/goal), [`goal-session`](../packages/goal/goal-session), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`llm-retry`](../packages/llm/llm-retry), [`paths`](../packages/util/paths), [`scope`](../packages/core/scope), [`session`](../packages/core/session), [`session-title`](../packages/session/session-title), [`skill`](../packages/skill/skill), [`skill-local`](../packages/skill/skill-local), [`system-prompt`](../packages/core/system-prompt), [`tasks-local`](../packages/tasks/tasks-local), [`tool-bash`](../packages/bash/tool-bash), [`tool-goal`](../packages/goal/tool-goal), [`tool-skill`](../packages/skill/tool-skill), [`tool-tasks`](../packages/tasks/tool-tasks), [`tools`](../packages/core/tools), [`workspace-context`](../packages/context/workspace-context) |
| [`jsonrpc`](../packages/scaffold/server) | `scaffold` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`llm-deepseek`](../packages/llm/llm-deepseek), [`scope`](../packages/core/scope), [`sdk-protocol`](../packages/scaffold/protocol), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent) |
| [`sdk-client`](../packages/scaffold/client) | `scaffold` | [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sdk-protocol`](../packages/scaffold/protocol), [`session`](../packages/core/session) |
| [`subagent-dsh-sdk`](../packages/subagent/subagent-dsh-sdk) | `subagent` | [`agent`](../packages/core/agent), [`invariants`](../packages/support/invariants), [`llm`](../packages/llm/llm), [`sdk-client`](../packages/scaffold/client), [`session`](../packages/core/session), [`subagent`](../packages/subagent/subagent), [`subprocess`](../packages/subprocess/subprocess) |
| [`client-ui-model`](../packages/client/ui-model) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-command`](../packages/client/ui-command), [`client-ui-conversation`](../packages/client/ui-conversation), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slash`](../packages/client/ui-slash), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants) |
| [`client-ui-permission`](../packages/client/ui-permission) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-schema-form`](../packages/client/schema-form), [`client-ui-command`](../packages/client/ui-command), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slash`](../packages/client/ui-slash), [`client-ui-slots`](../packages/client/ui-slots), [`invariants`](../packages/support/invariants), [`permission`](../packages/interaction/permission) |
| [`client-ui-skill`](../packages/client/ui-skill) | `client` | [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-slash`](../packages/client/ui-slash), [`client-ui-slots`](../packages/client/ui-slots), [`client-ui-tool`](../packages/client/ui-tool), [`invariants`](../packages/support/invariants) |
| [`acp-demo`](../packages/examples/acp-demo) | `examples` | [`acp`](../packages/acp/acp), [`agent-spine-demo`](../packages/examples/agent-spine-demo), [`app-boot`](../packages/boot/app-boot), [`invariants`](../packages/support/invariants), [`session-checkpoint-policy`](../packages/session/session-checkpoint-policy), [`session-persistence-jsonl`](../packages/session/session-persistence-jsonl), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), [`tools`](../packages/core/tools), [`workspace-context`](../packages/context/workspace-context) |
| [`ui-cordis`](../packages/self-modification/ui-cordis) | `self-modification` | [`api-remotes`](../packages/api/remotes), [`client-connection`](../packages/client/connection), [`client-locale`](../packages/client/locale), [`client-runtime`](../packages/client/runtime), [`client-ui-input-trigger`](../packages/client/ui-input-trigger), [`client-ui-primitives`](../packages/client/ui-primitives), [`client-ui-sidebar`](../packages/client/ui-sidebar), [`client-ui-slots`](../packages/client/ui-slots), [`client-ui-tool`](../packages/client/ui-tool), [`cordis-client-runner`](../packages/self-modification/cordis-client-runner), [`invariants`](../packages/support/invariants) |
