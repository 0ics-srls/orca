import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NativeChatNoticeRow } from './NativeChatNoticeRow'

describe('NativeChatNoticeRow command output', () => {
  it('keeps the column layout of command output', () => {
    const text =
      'Context Usage\n⛁ ⛁ ⛶   gpt-4o · 16.6k/128k tokens (13%)\n      ⛁ Skills: 304 tokens'
    const html = renderToStaticMarkup(
      <NativeChatNoticeRow block={{ type: 'text', text, presentation: 'command-output' }} />
    )
    expect(html).toMatch(/^<pre class="[^"]*font-mono[^"]*">/)
    expect(html).toContain(text)
  })
})
