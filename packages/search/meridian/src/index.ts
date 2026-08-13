// @deepseek-ai/dsh-meridian —— MeridianDB 代码库索引核心库（天枢 meridian 移植）。
// 数据层：SQLite（node:sqlite DatabaseSync）files/symbols/edges/module_summaries/access_log/co_edits；
// 解析层：web-tree-sitter（ts/tsx/js/jsx/py/go）；索引层：增量 + 删除复活 + 跨文件边匹配。

export { MeridianDb, MERIDIAN_SCHEMA_VERSION } from './db.ts'
export { MeridianIndexer, isMeridianIndexablePath, queryFlow, isUnnamedSymbolId, reviveDeletedFile } from './indexer.ts'
export type { FlowQueryOptions, FlowHit } from './indexer.ts'
export { MeridianBehavior } from './behavior.ts'
export { spreadingActivation, buildRepoMap } from './graph.ts'
export type { ActivationOptions, RepoMapOptions } from './graph.ts'
export { analyzeImpact, inferTestedByTargets } from './impact.ts'
export type { ImpactResult } from './impact.ts'
export { scheduleMeridianBackfill, DEFAULT_MERIDIAN_BACKFILL_MAX } from './backfill.ts'
export type { MeridianBackfillHandle, MeridianBackfillReason, MeridianBackfillOptions } from './backfill.ts'
export { stripComments, extractExpressRoutes, extractJsxChildren } from './framework.ts'
export { parseFile, initParser, detectLang, parseTypeScriptFile, parsePythonFile, parseGoFile } from './parser.ts'
export type { SupportedLang } from './parser.ts'
export * from './types.ts'
