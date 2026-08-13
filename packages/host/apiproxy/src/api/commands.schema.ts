/**
 * commands domain zod schemas (names derived from map keys: commandListRequestSchema /
 * commandListValueSchema / commandExecuteRequestSchema / commandExecuteValueSchema).
 */

import { z } from 'zod'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { CommandDescriptor } from './commands.ts'

/** CommandDescriptor row of command.list. */
export const commandDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  input: z.object({ hint: z.string() }).optional(),
}) satisfies z.ZodType<Wire<CommandDescriptor>>

/** command.list request payload. */
export const commandListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'command.list'>>>

/** command.list response value. */
export const commandListValueSchema = z.object({
  commands: z.array(commandDescriptorSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'command.list'>>>

/** command.execute request payload. */
export const commandExecuteRequestSchema = z.object({
  sessionId: sessionIdSchema,
  line: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'command.execute'>>>

/** CommandId: one brand cast after shape validation (the only cast point in this domain). */
export const commandIdSchema = z.string().min(1) as unknown as z.ZodType<CommandId>

/** command.execute response value: pure admission — outcomes ride the logged
 * lifecycle events; commandId (present exactly when matched) correlates with them. */
export const commandExecuteValueSchema = z.object({
  matched: z.boolean(),
  commandId: commandIdSchema.optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'command.execute'>>>
