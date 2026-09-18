import { describe, expect, it } from 'vitest'
import { markdownCodeSpanRanges, markdownFenceRanges } from './markdown-scan-ranges'
import { createMarkdownCodeSpanScanner } from './markdown-code-span-scanner'

describe('standalone Markdown boundaries', () => {
  it('rejects backticks in a backtick fence info string', () => {
    expect(markdownFenceRanges('```bad`info\ntext')).toEqual([])
    expect(markdownFenceRanges('~~~bad`info\ntext\n~~~')).toEqual([[0, 20]])
  })

  it('does not open a code span on an escaped backtick', () => {
    expect(markdownCodeSpanRanges('\\`literal\\`')).toEqual([])
    const scanner = createMarkdownCodeSpanScanner('\\`literal\\`')
    expect(scanner.findSpanEnd(1)).toBeNull()
  })

  it('accepts CR-only fence lines', () => {
    const source = '```\rcode\r```\rafter'
    expect(markdownFenceRanges(source)).toEqual([[0, 13]])
  })
})
