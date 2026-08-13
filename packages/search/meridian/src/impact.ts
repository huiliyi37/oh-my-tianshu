// 影响半径分析 —— 天枢 src/repo/meridian-impact.ts 原样移植。

import type { MeridianDb } from './db.ts'

/** 影响半径结果：直接/传递依赖、应跑测试与总数。 */
export interface ImpactResult {
  /** Files that directly depend on the changed files */
  direct: string[]
  /** Files that transitively depend (2+ hops) */
  transitive: string[]
  /** Test files that should be run */
  tests: string[]
  /** Total unique impacted files */
  totalImpact: number
}

/** 从变更文件反向 BFS 求依赖方，并收集 tested_by/co-edit 测试。
 * @param db - 数据库。
 * @param changedFiles - 变更文件。
 * @param opts - 跳数上限。
 * @returns 影响结果。 */
export function analyzeImpact(
  db: MeridianDb,
  changedFiles: string[],
  opts?: { maxHops?: number },
): ImpactResult {
  const maxHops = opts?.maxHops ?? 3
  const direct = new Set<string>()
  const transitive = new Set<string>()
  const tests = new Set<string>()

  // Collect tests for changed files
  for (const file of changedFiles) {
    for (const t of db.getTestsFor(file)) {
      tests.add(t)
    }
  }

  // Reverse BFS
  let frontier = new Set(changedFiles)
  const visited = new Set(changedFiles)

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier = new Set<string>()

    for (const file of frontier) {
      const deps = db.getReverseDependents(file)
      for (const dep of deps) {
        if (visited.has(dep.file)) continue
        visited.add(dep.file)
        nextFrontier.add(dep.file)

        if (hop === 0) {
          direct.add(dep.file)
        } else {
          transitive.add(dep.file)
        }

        // Check if this dependent is a test file
        if (isTestFile(dep.file)) {
          tests.add(dep.file)
        }
      }
    }

    frontier = nextFrontier
    if (frontier.size === 0) break
  }

  // Also find tests via co-edit neighbors (behavioral signal)
  for (const file of changedFiles) {
    const coNeighbors = db.getCoEditNeighbors(file)
    for (const n of coNeighbors) {
      if (isTestFile(n.file) && !tests.has(n.file)) {
        tests.add(n.file)
      }
    }
  }

  return {
    direct: [...direct],
    transitive: [...transitive],
    tests: [...tests],
    totalImpact: direct.size + transitive.size,
  }
}

const TEST_PATTERNS = ['.test.', '.spec.', '__tests__/', 'test/']

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some(p => filePath.includes(p))
}

/** 按命名约定推断测试文件的目标源文件。
 * @param testFilePath - 测试文件路径。
 * @param allFiles - 全库文件。
 * @returns 目标文件列表。 */
export function inferTestedByTargets(testFilePath: string, allFiles: string[]): string[] {
  if (!isTestFile(testFilePath)) return []

  // Extract base name: src/__tests__/foo.test.ts → foo
  const baseName = testFilePath
    .replace(/.*[/\\]/, '')           // strip directory
    .replace(/\.(test|spec)\.[^.]+$/, '') // strip .test.ts
    .replace(/\.[^.]+$/, '')          // strip extension if no test suffix

  if (!baseName) return []

  // Find source files matching the base name
  return allFiles.filter((f) => {
    if (f === testFilePath) return false
    if (isTestFile(f)) return false
    const fileName = f.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '')
    return fileName === baseName
  })
}
