/** Pure template-rendering algebra for file-backed commands. */

import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../src/template.ts'

describe('renderTemplate', () => {
  it('substitutes $ARGUMENTS with the exact raw input (untrimmed)', () => {
    expect(renderTemplate('you said: $ARGUMENTS', '  hello world  ')).toBe('you said:   hello world  ')
  })

  it('substitutes $1..$9 with whitespace-split positional arguments', () => {
    expect(renderTemplate('$1 $2 $3', 'alpha beta gamma')).toBe('alpha beta gamma')
  })

  it('collapses repeated whitespace between positional arguments', () => {
    expect(renderTemplate('$1|$2', '  alpha   beta  ')).toBe('alpha|beta')
  })

  it('leaves an undefined $n placeholder in place', () => {
    expect(renderTemplate('only $1 and $3', 'one')).toBe('only one and $3')
  })

  it('passes through unknown $-prefixed sequences verbatim', () => {
    // `$10` must not truncate to `$1` + `0`; `$0` and `$foo` are undefined.
    expect(renderTemplate('$10 $0 $foo', 'a b c d e f g h i j')).toBe('$10 $0 $foo')
  })

  it('treats $ARGUMENTS as the whole input even when positionals exist', () => {
    expect(renderTemplate('[$ARGUMENTS]', 'x y z')).toBe('[x y z]')
  })

  it('returns the body unchanged when no placeholder is present', () => {
    expect(renderTemplate('literal text', 'ignored')).toBe('literal text')
  })

  it('renders an empty body to an empty string (the handler rejects it separately)', () => {
    expect(renderTemplate('', 'input')).toBe('')
  })
})
