/**
 * Node module customization hook for project-local plugin package names.
 *
 * @module @deepseek-ai/dsh-scripts/local-plugin-loader-hooks
 */

import type { ResolveHookContext, ResolveFnOutput } from 'node:module'

interface HookData {
  mappings: Readonly<Record<string, string>>
}

let mappings: Readonly<Record<string, string>> = {}

/** Receive the package-name to source-URL map from the launcher thread. */
export function initialize(data: HookData): void {
  mappings = { ...data.mappings }
}

/** Resolve exact local workspace package names to their TypeScript entry source. */
export async function resolve(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (specifier: string, context: ResolveHookContext) => Promise<ResolveFnOutput>,
): Promise<ResolveFnOutput> {
  return nextResolve(mappings[specifier] ?? specifier, context)
}
