/**
 * migrate-home — copy the legacy default home (`~/.dsh`) to the isolated
 * default (`~/.dsh-tianshu`). The old home is kept (conservative): the user
 * decides when to clean it up. Idempotent: a present new home skips.
 *
 * The default home became `.dsh-tianshu` so this distribution coexists with
 * the official `dsh` CLI + plugins (`dsh-tianshu-tui`) without sharing user
 * data. One-time migration for installs that predate the change.
 *
 * @module @huiliyi37/oh-my-tianshu/migrate-home
 */

import { cpSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dshHomeDisplay, resolveDshHome } from '@huiliyi37/dsh-paths'

/** The legacy default home this distribution used before isolation. */
const LEGACY_HOME = join(homedir(), '.dsh')

/**
 * Copy the legacy home to the new default; prints the outcome. Never deletes
 * the legacy home. Exits 0 on success/skip, 1 when the legacy home is absent.
 * @returns the exit code.
 */
export function runMigrateHome(): number {
  const legacy = LEGACY_HOME
  const next = resolveDshHome()
  if (!existsSync(legacy)) {
    console.log(`旧 home 不存在（${dshHomeDisplay(legacy)}），无需迁移`)
    return 0
  }
  if (existsSync(next)) {
    console.log(`目标 home 已存在（${dshHomeDisplay(next)}），跳过（旧 home 保留：${legacy}）`)
    return 0
  }
  cpSync(legacy, next, { recursive: true })
  console.log(`已把 ${legacy} 复制到 ${next}`)
  console.log('旧 home 保留未删；确认新 home 正常后自行清理。')
  console.log(`本次启动生效需用新 home：oh-my-tianshu 现在默认读 ${dshHomeDisplay(next)}（$DSH_HOME 可覆盖）`)
  return 0
}
