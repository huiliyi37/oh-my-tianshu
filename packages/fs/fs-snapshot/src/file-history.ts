import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
 * File snapshot / rewind — ported from opencode-tui `FileHistory`
 * (Apache-2.0, opencode-tui/src/agent/file-history.ts), adapted for DSH:
 * - tool-name set is injected by the caller (`str_replace_editor`/`write`/`edit`)
 * - `getDiffStats` worker-pool dependency stripped; stats are coarse counts
 * - snapshot key is a session-relative boundary id (e.g. tool callId), not an
 *   OAI message id
 *
 * 快照语义：`trackEdit` 在每次写工具执行**前**读文件全文写入
 * `<backupDir>/<sessionId>/<sha256(path)[:16]>@v<N>`（按内容寻址，同一路径
 * 每次编辑递增版本）。`rewindToBoundary` 恢复边界后每个文件**最早**的快照
 * （= 边界前状态；backupFileName === null 表示文件当时不存在 → unlink）。
 * 上限 {@link MAX_SNAPSHOTS} 条，溢出淘汰最旧并删除其磁盘备份。
 */

const MAX_SNAPSHOTS = 100

/** 单个文件在某一边界前的备份句柄。 */
export interface FileBackup {
  /** `<backupDir>/<sessionId>/` 下的备份文件名；null 表示编辑前文件不存在（回退即 unlink）。 */
  backupFileName: string | null
  /** 该路径的备份版本号，从 1 起按每次编辑递增。 */
  version: number
  /** 备份写入时刻（epoch 毫秒）。 */
  timestamp: number
}

/** 一个边界内所有被编辑文件的备份集合。 */
export interface FileSnapshot {
  /** 边界 id（DSH：tool/call 的 callId；天枢：messageId）。 */
  boundaryId: string
  /** 文件绝对路径 → 该边界内首次编辑前的备份。 */
  trackedFileBackups: Record<string, FileBackup>
  /** 该边界首个备份的写入时刻（epoch 毫秒）。 */
  timestamp: number
}

/** 回退预览用的粗粒度变更统计（无 worker pool 的行数近似，非 git diff 语义）。 */
export interface DiffStats {
  /** 内容与备份不同的文件路径。 */
  filesChanged: string[]
  /** 各变更文件当前内容的总行数。 */
  insertions: number
  /** 各变更文件备份内容的总行数。 */
  deletions: number
}

/**
 * 一个会话的文件快照索引：内容寻址备份写盘，按边界 id 组织，支持单边界与
 * 跨边界回退。实例不自持久化——进程重启后索引丢失，磁盘备份由
 * {@link FileHistory.cleanupOrphans} 回收。
 */
export class FileHistory {
  private snapshots: FileSnapshot[] = []
  private trackedFiles = new Set<string>()

  constructor(
    private backupDir: string,
    private sessionId: string,
  ) {}

  /**
   * 记录一次写工具执行前的文件快照（调用方在工具执行前调用）。
   * 文件读取失败（不存在/无权限）→ backupFileName = null，回退时 unlink。
   * 同一 boundaryId 内同一文件重复编辑只保留首个快照（首个 = 该边界前状态）。
   * @param filePath - 即将被写工具修改的文件绝对路径。
   * @param boundaryId - 归属边界 id（DSH 用 tool/call 的 callId）。
   */
  async trackEdit(filePath: string, boundaryId: string): Promise<void> {
    this.trackedFiles.add(filePath)

    const lastSnapshot = this.snapshots.at(-1)
    if (lastSnapshot?.boundaryId === boundaryId && lastSnapshot.trackedFileBackups[filePath]) {
      return
    }

    let version = 1
    for (const s of this.snapshots) {
      const b = s.trackedFileBackups[filePath]
      if (b && b.version >= version) version = b.version + 1
    }

    let backup: FileBackup
    try {
      const content = await readFile(filePath, 'utf-8')
      const fileNameHash = createHash('sha256').update(filePath).digest('hex').slice(0, 16)
      const backupFileName = `${fileNameHash}@v${version}`
      const backupPath = join(this.backupDir, this.sessionId, backupFileName)
      await mkdir(dirname(backupPath), { recursive: true })
      await writeFile(backupPath, content, 'utf-8')
      backup = { backupFileName, version, timestamp: Date.now() }
    } catch {
      backup = { backupFileName: null, version, timestamp: Date.now() }
    }

    if (lastSnapshot && lastSnapshot.boundaryId === boundaryId) {
      lastSnapshot.trackedFileBackups[filePath] = backup
    } else {
      const snapshot: FileSnapshot = {
        boundaryId,
        trackedFileBackups: { [filePath]: backup },
        timestamp: Date.now(),
      }
      this.snapshots.push(snapshot)
      if (this.snapshots.length > MAX_SNAPSHOTS) {
        const evicted = this.snapshots.slice(0, this.snapshots.length - MAX_SNAPSHOTS)
        this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS)
        for (const s of evicted) {
          for (const b of Object.values(s.trackedFileBackups)) {
            if (b.backupFileName) {
              try { await unlink(join(this.backupDir, this.sessionId, b.backupFileName)) } catch { /* already gone */ }
            }
          }
        }
      }
    }
  }

  /**
   * 回退到指定边界 id：恢复该边界后所有被编辑文件到边界前状态。
   * @param boundaryId - 目标边界 id。
   * @returns 实际被恢复或删除的文件路径；备份缺失的文件静默跳过。
   * @throws 当该 boundaryId 没有对应快照时。
   */
  async rewind(boundaryId: string): Promise<string[]> {
    let targetSnapshot: FileSnapshot | undefined
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const snap = this.snapshots[i]
      if (snap !== undefined && snap.boundaryId === boundaryId) {
        targetSnapshot = snap
        break
      }
    }
    if (!targetSnapshot) {
      throw new Error(`Snapshot for ${boundaryId} not found`)
    }
    const filesChanged: string[] = []
    for (const filePath of this.trackedFiles) {
      const targetBackup = targetSnapshot.trackedFileBackups[filePath]
      if (targetBackup === undefined) continue

      if (targetBackup.backupFileName === null) {
        try {
          await unlink(filePath)
          filesChanged.push(filePath)
        } catch { /* already gone */ }
        continue
      }

      const backupPath = join(this.backupDir, this.sessionId, targetBackup.backupFileName)
      try {
        const content = await readFile(backupPath, 'utf-8')
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(filePath, content, 'utf-8')
        filesChanged.push(filePath)
      } catch { /* backup missing, skip */ }
    }
    return filesChanged
  }

  /**
   * 精确回退到会话边界：恢复边界**后**被编辑的每个文件到边界时状态，
   * 删除边界后新建的文件。`postBoundaryIds` = 边界后写工具调用的 id 集合
   * （调用方从会话事件流收集）。每个文件在边界后**最早**的快照 = 边界前
   * 状态（边界与该次编辑之间无其他编辑）。备份缺失（快照被驱逐/清理）的
   * 文件计入 `skipped`——回退缺口，调用方应提示用户。
   * @param postBoundaryIds - 边界后写工具调用的 id 集合。
   * @returns `changed` 实际被恢复或删除的文件路径；`skipped` 备份缺失未能回退的文件数。
   */
  async rewindToBoundary(postBoundaryIds: Set<string>): Promise<{ changed: string[]; skipped: number }> {
    const targets = this.firstBackupPerFile(postBoundaryIds)
    const filesChanged: string[] = []
    let skipped = 0
    for (const [filePath, backup] of targets) {
      if (backup.backupFileName === null) {
        try {
          await unlink(filePath)
          filesChanged.push(filePath)
        } catch { /* already gone: 目标状态即不存在，不算缺口 */ }
        continue
      }
      const backupPath = join(this.backupDir, this.sessionId, backup.backupFileName)
      try {
        const content = await readFile(backupPath, 'utf-8')
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(filePath, content, 'utf-8')
        filesChanged.push(filePath)
      } catch {
        skipped++ // 备份缺失（快照被驱逐/清理）——调用方应提示回退缺口
      }
    }
    return { changed: filesChanged, skipped }
  }

  /**
   * 边界回退会触及的文件（确认前预览用）。
   * @param postBoundaryIds - 边界后写工具调用的 id 集合。
   * @returns 每个文件及其回退动作：`restore` 覆写回备份，`delete` 删除边界后新建的文件。
   */
  getBoundaryFiles(postBoundaryIds: Set<string>): { path: string; action: 'restore' | 'delete' }[] {
    return [...this.firstBackupPerFile(postBoundaryIds)].map(([path, b]) => ({
      path,
      action: b.backupFileName === null ? 'delete' : 'restore',
    }))
  }

  /** 每个文件由其边界后最早一次编辑捕获的备份。 */
  private firstBackupPerFile(postBoundaryIds: Set<string>): Map<string, FileBackup> {
    const firstPer = new Map<string, FileBackup>()
    // snapshots 按时间顺序 push
    for (const snap of this.snapshots) {
      if (!postBoundaryIds.has(snap.boundaryId)) continue
      for (const [filePath, backup] of Object.entries(snap.trackedFileBackups)) {
        if (!firstPer.has(filePath)) firstPer.set(filePath, backup)
      }
    }
    return firstPer
  }

  /**
   * 回退到指定边界的变更统计（粗粒度行数；无 worker pool 的简化版）。
   * @param boundaryId - 目标边界 id。
   * @returns 变更统计；该边界无快照时为 undefined。
   */
  /* jscpd:ignore-start */
  async getDiffStats(boundaryId: string): Promise<DiffStats | undefined> {
    let targetSnapshot: FileSnapshot | undefined
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const snap = this.snapshots[i]
      if (snap !== undefined && snap.boundaryId === boundaryId) {
        targetSnapshot = snap
        break
      }
    }
    if (!targetSnapshot) return undefined
    /* jscpd:ignore-end */

    const filesChanged: string[] = []
    let insertions = 0
    let deletions = 0

    for (const filePath of this.trackedFiles) {
      const targetBackup = targetSnapshot.trackedFileBackups[filePath]
      if (targetBackup === undefined) continue

      let oldContent = ''
      if (targetBackup.backupFileName !== null) {
        try {
          oldContent = await readFile(join(this.backupDir, this.sessionId, targetBackup.backupFileName), 'utf-8')
        } catch { /* skip */ }
      }

      let newContent = ''
      try {
        newContent = await readFile(filePath, 'utf-8')
      } catch { /* file deleted */ }

      if (oldContent === newContent) continue
      filesChanged.push(filePath)
      insertions += newContent.length === 0 ? 0 : newContent.split('\n').length
      deletions += oldContent.length === 0 ? 0 : oldContent.split('\n').length
    }

    return { filesChanged, insertions, deletions }
  }

  /**
   * 该边界是否留有快照（回退入口的可用性判定）。
   * @param boundaryId - 待查边界 id。
   * @returns 存在对应快照时为 true。
   */
  hasSnapshot(boundaryId: string): boolean {
    return this.snapshots.some(s => s.boundaryId === boundaryId)
  }

  /**
   * 最近一次留下快照的边界 id。
   * @returns 最新边界 id；索引为空时为 undefined。
   */
  getLatestSnapshotId(): string | undefined {
    return this.snapshots.at(-1)?.boundaryId
  }

  /**
   * 按时间顺序的全部快照。返回内部数组本身而非副本——调用方只读，写入会破坏索引。
   * @returns 快照列表，最旧在前。
   */
  getAllSnapshots(): FileSnapshot[] {
    return this.snapshots
  }

  /**
   * 删除索引未引用的孤儿备份文件（磁盘清理）。
   * @returns 实际删除的备份文件数；会话目录不存在时为 0。
   */
  async cleanupOrphans(): Promise<number> {
    const sessionDir = join(this.backupDir, this.sessionId)
    let dirEntries: string[]
    try {
      dirEntries = await readdir(sessionDir)
    } catch {
      return 0
    }

    const referencedBackups = new Set<string>()
    for (const snapshot of this.snapshots) {
      for (const backup of Object.values(snapshot.trackedFileBackups)) {
        if (backup.backupFileName) {
          referencedBackups.add(backup.backupFileName)
        }
      }
    }

    let removed = 0
    for (const entry of dirEntries) {
      if (!referencedBackups.has(entry)) {
        try {
          await unlink(join(sessionDir, entry))
          removed++
        } catch {
          // File already gone or permission issue — skip
        }
      }
    }
    return removed
  }
}
