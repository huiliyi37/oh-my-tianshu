import { describe, expect, it } from 'vitest'
import { findInternalRepositoryReferences } from './verify-public-repository-links.ts'

describe('public repository link policy', () => {
  it('rejects encoded and case-varied internal identities without blocking public repositories', () => {
    const internalOwner = ['deepseek', 'harness'].join('-')
    const internalRepository = [internalOwner, internalOwner].join('/')
    const encodedRepository = internalRepository.replaceAll('-', '%2D').replace('/', '%2F')
    const htmlEncodedRepository = internalRepository.replace('/', '&#x2f;')
    const jsonEscapedRepository = internalRepository.replace('/', '\\/')
    const unicodeEscapedRepository = internalRepository.replace('/', String.raw`\u002f`)
    const source = [
      'https://github.com/deepseek-ai/deepseek-harness-sdk',
      `https://github.com/${internalOwner}/cordis`,
      `https://github.com/${internalRepository.toUpperCase()}/issues/1`,
      `https://github.com/${encodedRepository}/issues/2`,
      `https://github.com/${htmlEncodedRepository}/issues/3`,
      `"https:\\/\\/github.com\\/${jsonEscapedRepository}\\/issues\\/4"`,
      `"https:\\/\\/github.com\\/${unicodeEscapedRepository}\\/issues\\/5"`,
      `${internalOwner.toUpperCase()}#6`,
    ].join('\n')

    expect(findInternalRepositoryReferences('subject.md', source)).toEqual([
      { file: 'subject.md', line: 3 },
      { file: 'subject.md', line: 4 },
      { file: 'subject.md', line: 5 },
      { file: 'subject.md', line: 6 },
      { file: 'subject.md', line: 7 },
      { file: 'subject.md', line: 8 },
    ])
  })

  it('allows only the exact audited trusted-publishing repository declarations', () => {
    const internalOwner = ['deepseek', 'harness'].join('-')
    const internalRepository = [internalOwner, internalOwner].join('/')
    const repositoryUrl = `git+https://github.com/${internalRepository}.git`
    const manifestLine = `  "url": "${repositoryUrl}",`
    const constraintLine = `const repositoryUrl = '${repositoryUrl}'`
    const allowedDeclarations = [
      ['native/landlock-run/packages/entry/package.json', manifestLine],
      ['native/landlock-run/packages/linux-arm64/package.json', manifestLine],
      ['native/landlock-run/packages/linux-x64/package.json', manifestLine],
      ['scripts/check-workspace-constraints.ts', constraintLine],
    ] as const

    for (const [file, source] of allowedDeclarations) {
      expect(findInternalRepositoryReferences(file, source)).toEqual([])
    }

    const wrongFile = 'native/landlock-run/package.json'
    expect(findInternalRepositoryReferences(wrongFile, manifestLine)).toEqual([{ file: wrongFile, line: 1 }])

    const manifestFile = 'native/landlock-run/packages/entry/package.json'
    const wrongField = `  "homepage": "${repositoryUrl}",`
    expect(findInternalRepositoryReferences(manifestFile, wrongField)).toEqual([{ file: manifestFile, line: 1 }])

    const encodedLine = manifestLine.replace('github.com/', 'github.com\\/')
    expect(findInternalRepositoryReferences(manifestFile, encodedLine)).toEqual([{ file: manifestFile, line: 1 }])
  })
})
