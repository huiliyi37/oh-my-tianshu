export { buildFtsMatch, ftsNormalize, ftsTerms } from './fts.ts'
export { createHttpEmbedder } from './embedder.ts'
export type { HttpEmbedderOptions } from './embedder.ts'
export { apply, Config, name } from './plugin.ts'
export type { MemorySqliteConfig } from './plugin.ts'
export {
  MEMORY_SQLITE_APPLICATION_ID,
  MEMORY_SQLITE_SCHEMA_VERSION,
  openMemoryDatabase,
} from './schema.ts'
export type { JournalMode } from './schema.ts'
export { SqliteMemoryStore } from './store.ts'
export type { SqliteMemoryStoreOptions } from './store.ts'
export type { MemoryEventKind, MemoryEventRow, MemoryFactRow, MemoryFactStatus } from './types.ts'
