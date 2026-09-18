// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { encodeRawMarkdownHtmlForRichEditor } from './raw-markdown-html'
import { createRichMarkdownExtensions } from './rich-markdown-extensions'
import {
  serializeRichMarkdownSliceAsMarkdown,
  serializeRichMarkdownSliceForClipboard
} from './rich-markdown-clipboard-serialization'
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
      const markdown = serializeRichMarkdownSliceAsMarkdown(
        slice,
        (content) => editor.markdown?.serialize(content) ?? ''
      )
      expect(markdown).toContain('# Heading')
      expect(markdown).toContain('**bold**')
      expect(markdown).toContain('[link](https://example.com)')
      expect(markdown).not.toContain('\n\n\n')
    } finally {
      editor.destroy()
    }
  })

  it('serializes mounted partial selections without flattening structure', () => {
    const codec = createRichMarkdownEditorCodec()
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichMarkdownExtensions({ codec }),
      content: encodeRawMarkdownHtmlForRichEditor(
        '- first item\n- second item\n\n```ts\nconst value = 1\n```\n',
        codec
      ),
      contentType: 'markdown',
      editorProps: {
        clipboardTextSerializer: (slice) => {
          const markdown = editor.markdown
          return markdown
            ? serializeRichMarkdownSliceAsMarkdown(slice, (content) => markdown.serialize(content))
            : ''
        }
      }
    })
    try {
      const { doc } = editor.state
      const list = doc.firstChild
      expect(list?.type.name).toBe('bulletList')
      if (!list?.firstChild) {
        throw new Error('expected a list item')
      }
      const firstItemStart = 2
      const firstItemEnd = firstItemStart + list.firstChild.nodeSize
      const listSlice = doc.slice(firstItemStart, firstItemEnd)
      const markdown = editor.view.someProp('clipboardTextSerializer', (serializer) =>
        serializer(listSlice, editor.view)
      )
      expect(markdown).toContain('- first item')
      expect(markdown).not.toContain('second item')

      const codeBlock = doc.lastChild
      if (!codeBlock) {
        throw new Error('expected a code block')
      }
      const codeStart = doc.content.size - codeBlock.nodeSize
      const codeSlice = doc.slice(codeStart, doc.content.size)
      const codeClipboard = serializeRichMarkdownSliceForClipboard(editor.view, codeSlice)
      expect(codeClipboard.html).toContain('<pre')
      expect(codeClipboard.html).toContain('const value = 1')
    } finally {
      editor.destroy()
    }
  })
})
