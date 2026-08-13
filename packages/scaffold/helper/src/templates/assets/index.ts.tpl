{{#if isAcp}}
import { startSDK, type SdkBootContext } from '@deepseek-ai/dsh-scripts'
{{else}}
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { startSDK, type SdkBootContext } from '@deepseek-ai/dsh-scripts'
{{/if}}

/** Boot this project's cordis.yml when invoked by dsh-scripts. */
export async function main(boot: SdkBootContext) {
  const ctx = await startSDK(new URL('./cordis.yml', import.meta.url))
{{#if isEmbed}}
  await ctx.agents.create({
    sessionId: SessionId(`main-session-${randomUUID()}`),
    meta: { cwd: boot.cwd },
    agentOptions: { model: {{modelLiteral}} },
  })
{{/if}}
  return ctx
}
