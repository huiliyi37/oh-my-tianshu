/** Reject tracked files that expose the internal repository identity outside audited publishing declarations. */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const internalOwner = ['deepseek', 'harness'].join('-')
const internalRepository = [internalOwner, internalOwner].join('/')
const internalIssueShorthand = `${internalOwner}#`
const trustedPublishingRepositoryUrl = `git+https://github.com/${internalRepository}.git`

/** Exact declarations that intentionally expose the source repository for trusted publishing. */
const allowedInternalRepositoryLineByFile: Readonly<Record<string, string>> = {
  'native/landlock-run/packages/entry/package.json': `"url": "${trustedPublishingRepositoryUrl}",`,
  'native/landlock-run/packages/linux-arm64/package.json': `"url": "${trustedPublishingRepositoryUrl}",`,
  'native/landlock-run/packages/linux-x64/package.json': `"url": "${trustedPublishingRepositoryUrl}",`,
  'scripts/check-workspace-constraints.ts': `const repositoryUrl = '${trustedPublishingRepositoryUrl}'`,
}

const namedReferenceCharacters: Readonly<Record<string, string>> = {
  hyphen: '-',
  num: '#',
  sol: '/',
}

/** Normalize source spellings that render or decode to repository separators. */
function canonicalReferenceText(source: string): string {
  return source
    .replaceAll('\\/', '/')
    .replace(/\\u(0023|002d|002f)/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/%(23|2d|2f)/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(?:(\d+)|x([\da-f]+));/gi, (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      const code = Number.parseInt(decimal ?? hexadecimal ?? '', decimal === undefined ? 16 : 10)
      return code === 35 || code === 45 || code === 47 ? String.fromCodePoint(code) : entity
    })
    .replace(/&(hyphen|num|sol);/gi, (entity, name: string) => namedReferenceCharacters[name.toLowerCase()] ?? entity)
    .normalize('NFKC')
    .toLowerCase()
}

/** One tracked reference to the internal repository. */
export interface InternalRepositoryReference {
  /** Repository-relative file path. */
  file: string
  /** One-based source line. */
  line: number
}

/**
 * Locate unaudited internal-repository references in one text file.
 * @param file - Repository-relative path used in diagnostics.
 * @param source - Text to inspect.
 * @returns every matching source line.
 */
export function findInternalRepositoryReferences(file: string, source: string): InternalRepositoryReference[] {
  const references: InternalRepositoryReference[] = []
  for (const [index, line] of source.split('\n').entries()) {
    const canonicalLine = canonicalReferenceText(line)
    const isAllowedPublishingDeclaration = line.trim() === allowedInternalRepositoryLineByFile[file]
    if (!isAllowedPublishingDeclaration
      && (canonicalLine.includes(internalRepository) || canonicalLine.includes(internalIssueShorthand))) {
      references.push({ file, line: index + 1 })
    }
  }
  return references
}

function trackedFiles(repoRoot: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '')
}

function scanRepository(repoRoot: string): InternalRepositoryReference[] {
  const references: Array<InternalRepositoryReference> = []
  for (const file of trackedFiles(repoRoot)) {
    const path = resolve(repoRoot, file)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isFile() && !stat.isSymbolicLink()) continue
    const source = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path, 'utf8')
    if (source.includes('\0')) continue
    references.push(...findInternalRepositoryReferences(file, source))
  }
  return references
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const references = scanRepository(root)
  if (references.length === 0) {
    console.log('verify-public-repository-links: tracked files expose no unexpected internal repository identity.')
  } else {
    console.error('verify-public-repository-links: unexpected internal repository references found:')
    for (const reference of references) console.error(`  ${reference.file}:${String(reference.line)}`)
    process.exitCode = 1
  }
}
