import { describe, expect, it } from 'vitest'
import { findDetailsBlockStart } from './details-markdown-html'
import { markdownCodeSpanRanges, markdownFenceRanges } from './markdown-scan-ranges'

describe('markdownCodeSpanRanges', () => {
  it('reports a span whose backtick run closes on an equal run', () => {
    expect(markdownCodeSpanRanges('a `<details>` b')).toEqual([[2, 13]])
  })

  it('keeps a span that contains a blank line', () => {
    expect(markdownCodeSpanRanges('text `a\n\nb` tail')).toEqual([[5, 11]])
  })

  it('reports no span for backticks inside a fenced block', () => {
    expect(markdownCodeSpanRanges(['```', 'a `b` c', '```'].join('\n'))).toEqual([])
  })

  it('does not pair a fence backtick with a later prose backtick', () => {
    const content = ['~~~', 'x = `abc', '~~~', '', 'prose with `code` here'].join('\n')
    const spans = markdownCodeSpanRanges(content)

    expect(spans).toEqual([[29, 35]])
    expect(content.slice(29, 35)).toBe('`code`')
  })

  it('does not run a span through a four-backtick fence closer', () => {
    const content = ['```', 'code', '````', '', 'tail', '', '```', 'more', '```'].join('\n')

    expect(markdownCodeSpanRanges(content)).toEqual([])
  })
})

describe('findDetailsBlockStart with fenced content', () => {
  it('finds a details block after a fence whose content holds an unpaired backtick', () => {
    const content = [
      '~~~',
      'x = `abc',
      '~~~',
      '',
      '<details>',
      '<summary>S</summary>',
      '',
      'body',
      '',
      '</details>',
      '',
      'prose with `code` here'
    ].join('\n')

    expect(findDetailsBlockStart(content)).toBe(content.indexOf('<details>'))
  })

  it('finds a details block between a four-backtick closer and a later fence', () => {
    const content = [
      '```',
      'code',
      '````',
      '',
      '<details>',
      '<summary>S</summary>',
      '',
      'x',
      '',
      '</details>',
      '',
      '```',
      'more',
      '```'
    ].join('\n')

    expect(findDetailsBlockStart(content)).toBe(content.indexOf('<details>'))
  })

  it('skips a details mention inside a code span that spans a blank line', () => {
    expect(findDetailsBlockStart('text `a\n\n<details>b` tail')).toBe(-1)
  })
})

describe('markdownFenceRanges', () => {
  it('covers the opening delimiter, content, and closing delimiter', () => {
    const content = ['```', 'x', '```', ''].join('\n')

    expect(markdownFenceRanges(content)).toEqual([[0, 10]])
  })

  it('runs an unterminated fence to the end of the content', () => {
    const content = ['```', 'x', 'y'].join('\n')

    expect(markdownFenceRanges(content)).toEqual([[0, content.length]])
  })
})
