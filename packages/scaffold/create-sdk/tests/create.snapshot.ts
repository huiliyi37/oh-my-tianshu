import { describe, expect, it } from 'vitest'
import {
  featureId,
  createPackageManager,
  type NestedMultiSelectValue,
  type PromptPort,
} from '@deepseek-ai/dsh-helper'
import type {
  ConfirmPromptRequest,
  MultiSelectPromptRequest,
  NestedMultiSelectRequest,
  PromptOutcome,
  SecretPromptRequest,
  SelectPromptRequest,
  TextPromptRequest,
} from '../../helper/src/questions/prompt-port.ts'
import { parseCreateArgs } from '../src/args.ts'
import { CreateWizard } from '../src/create-wizard.ts'
import { CREATE_TEMPLATES, packageManagerTemplateModel } from '../src/templates/create-templates.ts'

class RecordingPort implements PromptPort {
  readonly transcript: unknown[] = []
  readonly #answers: unknown[]

  constructor(answers: unknown[]) { this.#answers = [...answers] }

  answer<T>(record: unknown): Promise<PromptOutcome<T>> {
    this.transcript.push(record)
    return Promise.resolve({ status: 'answered', value: this.#answers.shift() as T })
  }

  text(request: TextPromptRequest): Promise<PromptOutcome<string>> {
    return this.answer({
      kind: 'text',
      message: request.message,
      defaultValue: request.defaultValue,
      initialValue: request.initialValue,
    })
  }
  secret(request: SecretPromptRequest): Promise<PromptOutcome<string>> {
    return this.answer({ kind: 'secret', message: request.message })
  }
  select<T>(request: SelectPromptRequest<T>): Promise<PromptOutcome<T>> {
    return this.answer({
      kind: 'select', message: request.message, options: request.options.map(option => option.label),
      initialValue: request.initialValue,
    })
  }
  multiselect<T>(request: MultiSelectPromptRequest<T>): Promise<PromptOutcome<readonly T[]>> {
    return this.answer({
      kind: 'multiselect', message: request.message, options: request.options.map(option => option.label),
      initialValues: request.initialValues,
    })
  }
  confirm(request: ConfirmPromptRequest): Promise<PromptOutcome<boolean>> {
    return this.answer({ kind: 'confirm', message: request.message, initialValue: request.initialValue })
  }
  nestedMultiselect<TValue, TChoice>(
    request: NestedMultiSelectRequest<TValue, TChoice>,
  ): Promise<PromptOutcome<readonly NestedMultiSelectValue<TValue, TChoice>[]>> {
    return this.answer({
      kind: 'nested-multiselect',
      message: request.message,
      options: request.options.map(option => ({
        label: option.label,
        required: option.required,
        default: option.default,
        choices: option.choices?.map(choice => choice.label),
      })),
    })
  }
}

describe.skipIf(process.platform === 'win32')('create-sdk terminal contract', () => {
  it('renders package-manager-specific setup commands', () => {
    const model = packageManagerTemplateModel(createPackageManager('yarn', '4.0.0'))
    expect(CREATE_TEMPLATES.installQuestion.render(model)).toBe('Run yarn install and then build the project?\n')
    expect(CREATE_TEMPLATES.setupFailure.render({
      directory: '/workspace/agent',
      error: 'offline',
      ...model,
    })).toContain('yarn install && yarn build')
  })

  it('pins the full unresolved question order and completion messages', async () => {
    const port = new RecordingPort([
      'my-agent',
      'my-agent',
      'Snapshot agent',
      'deepseek-official',
      'secret-key',
      'acp',
      [
        { value: featureId('persistence'), choices: ['jsonl'] },
        { value: featureId('hmr'), choices: [] },
        { value: featureId('web'), choices: ['exa'] },
        { value: featureId('workflow'), choices: [] },
      ],
      true,
      'exa-key',
      'none',
      'npm',
      false,
    ])
    const resolved = await new CreateWizard({
      args: parseCreateArgs([]),
      port,
      cwd: '/workspace',
      releaseVersion: '0.0.1',
      userAgent: '',
      versionProbe: async () => '10.0.0',
    }).run()
    expect({
      prompts: port.transcript,
      result: {
        directory: resolved.directory,
        name: resolved.request.name,
        manager: resolved.request.packageManager.name,
        install: resolved.install,
        features: resolved.request.features.map(item => ({ id: item.id, options: item.options })),
      },
      messages: {
        created: CREATE_TEMPLATES.created.render({
          name: resolved.request.name,
          directory: resolved.directory,
        }),
        next: CREATE_TEMPLATES.nextSteps.render({
          directory: resolved.directory,
          setupRequired: false,
          ...packageManagerTemplateModel(resolved.request.packageManager),
        }),
        failure: CREATE_TEMPLATES.setupFailure.render({
          directory: resolved.directory,
          error: String(new Error('offline')),
          ...packageManagerTemplateModel(resolved.request.packageManager),
        }),
      },
    }).toMatchInlineSnapshot(`
      {
        "messages": {
          "created": "Created my-agent in /workspace/my-agent
      ",
          "failure": "Project files are ready, but setup failed: Error: offline
      Retry: cd /workspace/my-agent && npm install && npm run build
      ",
          "next": "Next: cd /workspace/my-agent && npm start
      ",
        },
        "prompts": [
          {
            "defaultValue": "my-agent",
            "initialValue": undefined,
            "kind": "text",
            "message": "Where should the project be created?",
          },
          {
            "defaultValue": "my-agent",
            "initialValue": undefined,
            "kind": "text",
            "message": "Package name",
          },
          {
            "defaultValue": "A DeepSeek Harness agent named my-agent",
            "initialValue": undefined,
            "kind": "text",
            "message": "Project description",
          },
          {
            "initialValue": "deepseek-official",
            "kind": "select",
            "message": "Model provider",
            "options": [
              "DeepSeek",
              "Custom endpoint (pi-ai)",
            ],
          },
          {
            "kind": "secret",
            "message": "DeepSeek API key",
          },
          {
            "initialValue": "acp",
            "kind": "select",
            "message": "Run interface",
            "options": [
              "ACP automation server",
              "Embedded context",
            ],
          },
          {
            "kind": "nested-multiselect",
            "message": "Select features",
            "options": [
              {
                "choices": [
                  "Local executor",
                  "Sandboxed executor",
                ],
                "default": true,
                "label": "Command execution",
                "required": true,
              },
              {
                "choices": [
                  "JSONL files",
                  "SQLite database",
                ],
                "default": true,
                "label": "Durable session storage",
                "required": true,
              },
              {
                "choices": undefined,
                "default": true,
                "label": "Hot-module reload",
                "required": false,
              },
              {
                "choices": undefined,
                "default": true,
                "label": "Read, write, and edit local files",
                "required": false,
              },
              {
                "choices": undefined,
                "default": true,
                "label": "Model-facing task tracking",
                "required": false,
              },
              {
                "choices": undefined,
                "default": true,
                "label": "Local skill discovery",
                "required": false,
              },
              {
                "choices": [
                  "DeepSeek search",
                  "Exa search",
                  "Perplexity search",
                  "Fetch only",
                ],
                "default": false,
                "label": "Web search and fetch tools",
                "required": false,
              },
              {
                "choices": [
                  "Fresh child agent",
                  "Fork parent history",
                ],
                "default": false,
                "label": "Delegate work to child agents",
                "required": false,
              },
              {
                "choices": undefined,
                "default": false,
                "label": "Scripted multi-agent workflows",
                "required": false,
              },
              {
                "choices": undefined,
                "default": false,
                "label": "Automatic context compaction",
                "required": false,
              },
              {
                "choices": [
                  "Claude Code hooks",
                  "Codex hooks",
                ],
                "default": false,
                "label": "Run Claude Code or Codex hooks",
                "required": false,
              },
              {
                "choices": undefined,
                "default": false,
                "label": "Loop-hygiene reminders",
                "required": false,
              },
              {
                "choices": undefined,
                "default": false,
                "label": "Tool timeout policy",
                "required": false,
              },
            ],
          },
          {
            "initialValue": true,
            "kind": "confirm",
            "message": "Add the recommended tool timeout policy for web search and fetch tools?",
          },
          {
            "kind": "secret",
            "message": "Exa API key",
          },
          {
            "initialValue": "none",
            "kind": "select",
            "message": "Local plugin",
            "options": [
              "No local plugin",
              "Cordis plugin",
              "Model-facing tool",
            ],
          },
          {
            "initialValue": "npm",
            "kind": "select",
            "message": "Package manager",
            "options": [
              "npm",
              "pnpm",
              "Yarn",
            ],
          },
          {
            "initialValue": true,
            "kind": "confirm",
            "message": "Run npm install and then build the project?",
          },
        ],
        "result": {
          "directory": "/workspace/my-agent",
          "features": [
            {
              "id": "provider",
              "options": [
                "deepseek-official",
              ],
            },
            {
              "id": "spine",
              "options": [
                "default",
              ],
            },
            {
              "id": "app",
              "options": [
                "acp",
              ],
            },
            {
              "id": "bash",
              "options": [
                "local",
              ],
            },
            {
              "id": "persistence",
              "options": [
                "jsonl",
              ],
            },
            {
              "id": "hmr",
              "options": [
                "default",
              ],
            },
            {
              "id": "web",
              "options": [
                "exa",
              ],
            },
            {
              "id": "workflow",
              "options": [
                "workerthread",
              ],
            },
            {
              "id": "timeout-policy",
              "options": [
                "default",
              ],
            },
          ],
          "install": false,
          "manager": "npm",
          "name": "my-agent",
        },
      }
    `)
  })
})
