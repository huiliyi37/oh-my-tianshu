/**
 * Ordered builtin feature catalog: behavior entities only where project
 * context changes the contribution, typed specs everywhere else.
 *
 * @module @deepseek-ai/dsh-helper/features/builtin
 */

import type { Config as ClaudeHooksConfig } from '@deepseek-ai/dsh-hooks-claude'
import type { Config as CodexHooksConfig } from '@deepseek-ai/dsh-hooks-codex'
import type { Config as JsonlConfig } from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { Config as SqliteConfig } from '@deepseek-ai/dsh-session-persistence-sqlite'
import type { Config as ToolSubagentConfig } from '@deepseek-ai/dsh-tool-subagent'
import type { Config as ToolTodoConfig } from '@deepseek-ai/dsh-tool-todo'
import type { Config as ToolWebConfig } from '@deepseek-ai/dsh-tool-web'
import type { ProjectProfile } from '../../project/types.ts'
import { defineFeatures } from '../define-feature.ts'
import { FeatureRegistry } from '../registry.ts'
import { AppFeature } from './app.ts'
import { ProviderFeature } from './provider.ts'
import { SpineFeature } from './spine.ts'

/**
 * Build and definition-check the complete builtin set for one project profile.
 * @param profile - project context used to validate conditional contributions.
 * @returns ordered builtin feature registry.
 */
export function createBuiltinRegistry(profile: ProjectProfile): FeatureRegistry {
  return new FeatureRegistry(defineFeatures([
    new ProviderFeature(),
    new SpineFeature(),
    {
      id: 'bash',
      summary: 'Command execution',
      mode: 'exclusive',
      required: true,
      baseResources: [
        { kind: 'npm-cordis-config-entry', id: 'subprocess', package: '@deepseek-ai/dsh-subprocess-local' },
        { kind: 'npm-cordis-config-entry', id: 'bash-env', package: '@deepseek-ai/dsh-bash-env' },
        { kind: 'npm-cordis-config-entry', id: 'tool-bash', package: '@deepseek-ai/dsh-tool-bash' },
      ],
      options: [
        {
          id: 'local',
          label: 'Local executor',
          default: true,
          resources: [{ kind: 'npm-cordis-config-entry', id: 'bash', package: '@deepseek-ai/dsh-bash-local' }],
        },
        {
          id: 'sandbox',
          label: 'Sandboxed executor',
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'sandbox', package: '@deepseek-ai/dsh-sandbox-local' },
            {
              kind: 'npm-cordis-config-entry',
              id: 'bash',
              package: '@deepseek-ai/dsh-bash-sandbox',
              commentedExample: `Uncomment to allow writes under the project workspace.
config:
  mode: workspace-write
  workspaceRoot: !!js process.cwd()`,
            },
          ],
        },
      ],
    },
    new AppFeature(),
    {
      id: 'persistence',
      summary: 'Durable session storage',
      mode: 'exclusive',
      required: true,
      options: [
        {
          id: 'jsonl',
          label: 'JSONL files',
          default: true,
          resources: [{
            kind: 'npm-cordis-config-entry',
            id: 'session-persistence',
            package: '@deepseek-ai/dsh-session-persistence-jsonl',
            config: { root: './.sessions' } satisfies JsonlConfig,
          }],
        },
        {
          id: 'sqlite',
          label: 'SQLite database',
          resources: [{
            kind: 'npm-cordis-config-entry',
            id: 'session-persistence',
            package: '@deepseek-ai/dsh-session-persistence-sqlite',
            config: { path: './.sessions/sessions.sqlite' } satisfies SqliteConfig,
          }],
        },
      ],
    },
    {
      id: 'hmr',
      summary: 'Hot-module reload',
      mode: 'single',
      options: [{
        id: 'default',
        label: 'Cordis HMR',
        default: true,
        resources: [{ kind: 'npm-cordis-config-entry', id: 'hmr', package: '@cordisjs/plugin-hmr' }],
      }],
    },
    {
      id: 'fs',
      summary: 'Read, write, and edit local files',
      mode: 'single',
      options: [{
        id: 'local',
        label: 'Local filesystem',
        default: true,
        resources: [
          { kind: 'npm-cordis-config-entry', id: 'fs-local', package: '@deepseek-ai/dsh-fs-local' },
          { kind: 'npm-cordis-config-entry', id: 'fs-policy', package: '@deepseek-ai/dsh-fs-policy' },
          { kind: 'npm-cordis-config-entry', id: 'tool-fs', package: '@deepseek-ai/dsh-tool-fs' },
        ],
      }],
    },
    {
      id: 'todo',
      summary: 'Model-facing task tracking',
      mode: 'single',
      options: [{
        id: 'default',
        label: 'todo_write tool',
        default: true,
        resources: [{
          kind: 'npm-cordis-config-entry',
          id: 'tool-todo',
          package: '@deepseek-ai/dsh-tool-todo',
          config: { allowParallelInProgress: true } satisfies ToolTodoConfig,
        }],
      }],
    },
    {
      id: 'skill',
      summary: 'Local skill discovery',
      mode: 'single',
      options: [{
        id: 'default',
        label: 'Local skills and skill tool',
        default: true,
        resources: [
          { kind: 'npm-cordis-config-entry', id: 'skill', package: '@deepseek-ai/dsh-skill' },
          { kind: 'npm-cordis-config-entry', id: 'skill-local', package: '@deepseek-ai/dsh-skill-local' },
          { kind: 'npm-cordis-config-entry', id: 'tool-skill', package: '@deepseek-ai/dsh-tool-skill' },
        ],
      }],
    },
    {
      id: 'web',
      summary: 'Web search and fetch tools',
      mode: 'exclusive',
      suggests: ['timeout-policy'],
      baseResources: [
        { kind: 'npm-cordis-config-entry', id: 'web', package: '@deepseek-ai/dsh-web' },
        { kind: 'npm-cordis-config-entry', id: 'web-fetch-local', package: '@deepseek-ai/dsh-web-fetch-local' },
      ],
      options: [
        {
          id: 'deepseek-official',
          label: 'DeepSeek search',
          default: true,
          markers: [{ id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek' }],
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'web-search-deepseek', package: '@deepseek-ai/dsh-web-search-deepseek' },
            { kind: 'npm-cordis-config-entry', id: 'tool-web', package: '@deepseek-ai/dsh-tool-web' },
          ],
        },
        {
          id: 'exa',
          label: 'Exa search',
          secrets: [{ id: 'apiKey', environment: 'EXA_API_KEY', message: 'Exa API key', required: true }],
          markers: [{ id: 'web-search-exa', name: '@deepseek-ai/dsh-web-search-exa' }],
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'web-search-exa', package: '@deepseek-ai/dsh-web-search-exa' },
            { kind: 'npm-cordis-config-entry', id: 'tool-web', package: '@deepseek-ai/dsh-tool-web' },
          ],
        },
        {
          id: 'perplexity',
          label: 'Perplexity search',
          secrets: [{
            id: 'apiKey',
            environment: 'PERPLEXITY_API_KEY',
            message: 'Perplexity API key',
            required: true,
          }],
          markers: [{ id: 'web-search-perplexity', name: '@deepseek-ai/dsh-web-search-perplexity' }],
          resources: [
            {
              kind: 'npm-cordis-config-entry',
              id: 'web-search-perplexity',
              package: '@deepseek-ai/dsh-web-search-perplexity',
            },
            { kind: 'npm-cordis-config-entry', id: 'tool-web', package: '@deepseek-ai/dsh-tool-web' },
          ],
        },
        {
          id: 'fetch-only',
          label: 'Fetch only',
          markers: [{ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { search: false } }],
          resources: [{
            kind: 'npm-cordis-config-entry',
            id: 'tool-web',
            package: '@deepseek-ai/dsh-tool-web',
            config: { search: false } satisfies ToolWebConfig,
          }],
        },
      ],
    },
    {
      id: 'subagent',
      summary: 'Delegate work to child agents',
      mode: 'multiple',
      // In-process options select continuable background delegation; the
      // follow-up adapter remains an independently loadable global tool.
      baseResources: [
        { kind: 'npm-cordis-config-entry', id: 'tasks', package: '@deepseek-ai/dsh-tasks-local' },
        { kind: 'npm-cordis-config-entry', id: 'tool-tasks', package: '@deepseek-ai/dsh-tool-tasks' },
        { kind: 'npm-cordis-config-entry', id: 'subagent', package: '@deepseek-ai/dsh-subagent' },
        { kind: 'npm-cordis-config-entry', id: 'tool-subagent-control', package: '@deepseek-ai/dsh-tool-subagent-control' },
      ],
      options: [
        {
          id: 'spawn',
          label: 'Fresh child agent',
          default: true,
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'subagent-spawn', package: '@deepseek-ai/dsh-subagent-spawn' },
            {
              kind: 'npm-cordis-config-entry',
              id: 'tool-subagent',
              package: '@deepseek-ai/dsh-tool-subagent',
              config: { provider: 'spawn', backgroundMode: 'continuable' } satisfies ToolSubagentConfig,
            },
          ],
        },
        {
          id: 'fork',
          label: 'Fork parent history',
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'subagent-fork', package: '@deepseek-ai/dsh-subagent-fork' },
            {
              kind: 'npm-cordis-config-entry',
              id: 'tool-subagent-fork',
              package: '@deepseek-ai/dsh-tool-subagent',
              config: {
                provider: 'fork',
                toolName: 'subagent_fork',
                backgroundMode: 'continuable',
              } satisfies ToolSubagentConfig,
            },
          ],
        },
      ],
    },
    {
      id: 'workflow',
      summary: 'Scripted multi-agent workflows',
      mode: 'single',
      options: [{
        id: 'workerthread',
        label: 'Worker thread engine',
        default: true,
        requires: [{ id: 'subagent', options: ['spawn'] }],
        resources: [
          {
            kind: 'npm-cordis-config-entry',
            id: 'workflow-workerthread',
            package: '@deepseek-ai/dsh-workflow-workerthread',
          },
          { kind: 'npm-cordis-config-entry', id: 'tool-workflow', package: '@deepseek-ai/dsh-tool-workflow' },
        ],
      }],
    },
    {
      id: 'compact',
      summary: 'Automatic context compaction',
      mode: 'single',
      options: [{
        id: 'basic',
        label: 'Basic compaction',
        default: true,
        resources: [
          {
            kind: 'npm-cordis-config-entry',
            id: 'token-meter',
            package: '@deepseek-ai/dsh-token-meter',
          },
          {
            kind: 'npm-cordis-config-entry',
            id: 'compact-basic',
            package: '@deepseek-ai/dsh-compact-basic',
          },
        ],
      }],
    },
    {
      id: 'hooks',
      summary: 'Run Claude Code or Codex hooks',
      mode: 'multiple',
      requires: [{ id: 'bash' }],
      options: [
        {
          id: 'claude',
          label: 'Claude Code hooks',
          default: true,
          resources: [
            {
              kind: 'npm-cordis-config-entry',
              id: 'hooks-claude',
              package: '@deepseek-ai/dsh-hooks-claude',
              config: { configPath: './hooks.json' } satisfies ClaudeHooksConfig,
            },
            { kind: 'owned-file', path: 'hooks.json', text: '{}' },
          ],
        },
        {
          id: 'codex',
          label: 'Codex hooks',
          resources: [
            {
              kind: 'npm-cordis-config-entry',
              id: 'hooks-codex',
              package: '@deepseek-ai/dsh-hooks-codex',
              config: { configPath: './codex-hooks.json' } satisfies CodexHooksConfig,
            },
            { kind: 'owned-file', path: 'codex-hooks.json', text: '{}' },
          ],
        },
      ],
    },
    {
      id: 'guard',
      summary: 'Loop-hygiene reminders',
      mode: 'single',
      options: [{
        id: 'repeat-tool',
        label: 'Repeat-tool reminders',
        default: true,
        resources: [{
          kind: 'npm-cordis-config-entry',
          id: 'repeat-tool-guard',
          package: '@deepseek-ai/dsh-repeat-tool-guard',
        }],
      }],
    },
    {
      id: 'timeout-policy',
      summary: 'Tool timeout policy',
      mode: 'single',
      options: [{
        id: 'default',
        label: 'Timeout policy',
        default: true,
        resources: [{
          kind: 'npm-cordis-config-entry',
          id: 'timeout-policy',
          package: '@deepseek-ai/dsh-timeout-policy',
        }],
      }],
    },
  ]), profile)
}
