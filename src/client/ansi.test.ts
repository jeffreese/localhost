import { describe, expect, it } from 'vitest'
import { stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('removes color escape sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text')
  })

  it('removes multi-code sequences', () => {
    expect(stripAnsi('\x1b[1;33;40mbold yellow\x1b[0m')).toBe('bold yellow')
  })

  it('returns plain text unchanged', () => {
    expect(stripAnsi('no escapes here')).toBe('no escapes here')
  })
})
