/**
 * Ordered builtin feature catalog: behavior entities only where project
 * context changes the contribution, typed specs everywhere else.
 *
 * @module @huiliyi37/dsh-helper/features/builtin
 */

import type { Config as ClaudeHooksConfig } from '@huiliyi37/dsh-hooks-claude'
import type { Config as CodexHooksConfig } from '@huiliyi37/dsh-hooks-codex'
import type { Config as JsonlConfig } from '@huiliyi37/dsh-session-persistence-jsonl'
import type { Config as SqliteConfig } from '@huiliyi37/dsh-session-persistence-sqlite'
import type { Config as ToolSubagentConfig } from '@huiliyi37/dsh-tool-subagent'
import type { Config as ToolTodoConfig } from '@huiliyi37/dsh-tool-todo'
import type { Config as ToolWebConfig } from '@huiliyi37/dsh-tool-web'
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
        { kind: 'npm-cordis-config-entry', id: 'subprocess', package: '@huiliyi37/dsh-subprocess-local' },
        { kind: 'npm-cordis-config-entry', id: 'bash-env', package: '@huiliyi37/dsh-bash-env' },
        { kind: 'npm-cordis-config-entry', id: 'tool-bash', package: '@huiliyi37/dsh-tool-bash' },
      ],
      options: [
        {
          id: 'local',
          label: 'Local executor',
          default: true,
          resources: [{ kind: 'npm-cordis-config-entry', id: 'bash', package: '@huiliyi37/dsh-bash-local' }],
        },
        {
          id: 'sandbox',
          label: 'Sandboxed executor',
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'sandbox', package: '@huiliyi37/dsh-sandbox-local' },
            {
              kind: 'npm-cordis-config-entry',
              id: 'bash',
              package: '@huiliyi37/dsh-bash-sandbox',
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
            package: '@huiliyi37/dsh-session-persistence-jsonl',
            config: { root: './.sessions' } satisfies JsonlConfig,
          }],
        },
        {
          id: 'sqlite',
          label: 'SQLite database',
          resources: [{
            kind: 'npm-cordis-config-entry',
            id: 'session-persistence',
            package: '@huiliyi37/dsh-session-persistence-sqlite',
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
        resources: [{ kind: 'npm-cordis-config-entry', id: 'hmr', package: '@huiliyi37/cordis-plugin-hmr' }],
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
          { kind: 'npm-cordis-config-entry', id: 'fs-local', package: '@huiliyi37/dsh-fs-local' },
          { kind: 'npm-cordis-config-entry', id: 'fs-policy', package: '@huiliyi37/dsh-fs-policy' },
          { kind: 'npm-cordis-config-entry', id: 'tool-fs', package: '@huiliyi37/dsh-tool-fs' },
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
          package: '@huiliyi37/dsh-tool-todo',
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
          { kind: 'npm-cordis-config-entry', id: 'skill', package: '@huiliyi37/dsh-skill' },
          { kind: 'npm-cordis-config-entry', id: 'skill-local', package: '@huiliyi37/dsh-skill-local' },
          { kind: 'npm-cordis-config-entry', id: 'tool-skill', package: '@huiliyi37/dsh-tool-skill' },
        ],
      }],
    },
    {
      id: 'web',
      summary: 'Web search and fetch tools',
      mode: 'exclusive',
      suggests: ['timeout-policy'],
      baseResources: [
        { kind: 'npm-cordis-config-entry', id: 'web', package: '@huiliyi37/dsh-web' },
        { kind: 'npm-cordis-config-entry', id: 'web-fetch-local', package: '@huiliyi37/dsh-web-fetch-local' },
      ],
      options: [
        {
          id: 'deepseek-official',
          label: 'DeepSeek search',
          default: true,
          markers: [{ id: 'web-search-deepseek', name: '@huiliyi37/dsh-web-search-deepseek' }],
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'web-search-deepseek', package: '@huiliyi37/dsh-web-search-deepseek' },
            { kind: 'npm-cordis-config-entry', id: 'tool-web', package: '@huiliyi37/dsh-tool-web' },
          ],
        },
        {
          id: 'exa',
          label: 'Exa search',
          secrets: [{ id: 'apiKey', environment: 'EXA_API_KEY', message: 'Exa API key', required: true }],
          markers: [{ id: 'web-search-exa', name: '@huiliyi37/dsh-web-search-exa' }],
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'web-search-exa', package: '@huiliyi37/dsh-web-search-exa' },
            { kind: 'npm-cordis-config-entry', id: 'tool-web', package: '@huiliyi37/dsh-tool-web' },
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
          markers: [{ id: 'web-search-perplexity', name: '@huiliyi37/dsh-web-search-perplexity' }],
          resources: [
            {
              kind: 'npm-cordis-config-entry',
              id: 'web-search-perplexity',
              package: '@huiliyi37/dsh-web-search-perplexity',
            },
            { kind: 'npm-cordis-config-entry', id: 'tool-web', package: '@huiliyi37/dsh-tool-web' },
          ],
        },
        {
          id: 'fetch-only',
          label: 'Fetch only',
          markers: [{ id: 'tool-web', name: '@huiliyi37/dsh-tool-web', config: { search: false } }],
          resources: [{
            kind: 'npm-cordis-config-entry',
            id: 'tool-web',
            package: '@huiliyi37/dsh-tool-web',
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
        { kind: 'npm-cordis-config-entry', id: 'tasks', package: '@huiliyi37/dsh-tasks-local' },
        { kind: 'npm-cordis-config-entry', id: 'tool-tasks', package: '@huiliyi37/dsh-tool-tasks' },
        { kind: 'npm-cordis-config-entry', id: 'subagent', package: '@huiliyi37/dsh-subagent' },
        { kind: 'npm-cordis-config-entry', id: 'tool-subagent-control', package: '@huiliyi37/dsh-tool-subagent-control' },
      ],
      options: [
        {
          id: 'spawn',
          label: 'Fresh child agent',
          default: true,
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'subagent-spawn', package: '@huiliyi37/dsh-subagent-spawn' },
            {
              kind: 'npm-cordis-config-entry',
              id: 'tool-subagent',
              package: '@huiliyi37/dsh-tool-subagent',
              config: { provider: 'spawn', backgroundMode: 'continuable' } satisfies ToolSubagentConfig,
            },
          ],
        },
        {
          id: 'fork',
          label: 'Fork parent history',
          resources: [
            { kind: 'npm-cordis-config-entry', id: 'subagent-fork', package: '@huiliyi37/dsh-subagent-fork' },
            {
              kind: 'npm-cordis-config-entry',
              id: 'tool-subagent-fork',
              package: '@huiliyi37/dsh-tool-subagent',
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
            package: '@huiliyi37/dsh-workflow-workerthread',
          },
          { kind: 'npm-cordis-config-entry', id: 'tool-workflow', package: '@huiliyi37/dsh-tool-workflow' },
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
            package: '@huiliyi37/dsh-token-meter',
          },
          {
            kind: 'npm-cordis-config-entry',
            id: 'compact-basic',
            package: '@huiliyi37/dsh-compact-basic',
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
              package: '@huiliyi37/dsh-hooks-claude',
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
              package: '@huiliyi37/dsh-hooks-codex',
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
          package: '@huiliyi37/dsh-repeat-tool-guard',
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
          package: '@huiliyi37/dsh-timeout-policy',
        }],
      }],
    },
  ]), profile)
}
