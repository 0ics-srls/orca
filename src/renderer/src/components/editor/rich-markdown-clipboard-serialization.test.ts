import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { encodeRawMarkdownHtmlForRichEditor } from './raw-markdown-html'
import { createRichMarkdownExtensions } from './rich-markdown-extensions'
import { serializeRichMarkdownSliceAsMarkdown } from './rich-markdown-clipboard-serialization'
import { createRichMarkdownEditorCodec } from './rich-markdown-source-transport'

describe('rich Markdown clipboard serialization', () => {
  it('serializes a selected slice as Markdown source', () => {
    const codec = createRichMarkdownEditorCodec()
    const editor = new Editor({
      element: null,
      extensions: createRichMarkdownExtensions({ codec }),
      content: encodeRawMarkdownHtmlForRichEditor(
        '# Heading\n\nA **bold** paragraph with a [link](https://example.com).\n',
        codec
      ),
      contentType: 'markdown'
    })
    try {
      const slice = editor.state.doc.slice(0, editor.state.doc.content.size)
      const markdown = serializeRichMarkdownSliceAsMarkdown(slice, (content) =>
        editor.markdown!.serialize(content)
      )
      expect(markdown).toContain('# Heading')
      expect(markdown).toContain('**bold**')
      expect(markdown).toContain('[link](https://example.com)')
      expect(markdown).not.toContain('\n\n\n')
    } finally {
      editor.destroy()
    }
  })
})
