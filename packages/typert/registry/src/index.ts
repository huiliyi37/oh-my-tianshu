/** Host entry for the shared TypeRT runtime registry. */

import type { z } from 'zod'
import type { TypeRTDisposer } from '@deepseek-ai/dsh-type-meta'
import type {
  TypertContribution,
  TypertFace,
  TypertPackageFilter,
  TypertPackageRecord,
  TypertSchemaFilter,
  TypertSchemaRecord,
} from './types.ts'

export { default, TypertRegistry, typertEndpoint, typertKey, typertPackageKey } from './service.ts'
export type * from './types.ts'

declare module '@deepseek-ai/dsh-type-meta' {
  interface TypeRTService {
    register(contribution: TypertContribution): TypeRTDisposer
    get(key: string): TypertSchemaRecord | undefined
    resolve(key: string): TypertSchemaRecord
    list(filter?: TypertSchemaFilter): TypertSchemaRecord[]
    getPackage(packageName: string, face?: TypertFace): TypertPackageRecord | undefined
    listPackages(filter?: TypertPackageFilter): TypertPackageRecord[]
    toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
  }
}
