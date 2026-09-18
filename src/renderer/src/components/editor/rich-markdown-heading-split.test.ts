import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { splitRichMarkdownHeading } from './rich-markdown-heading-split'

function createEditor(): Editor {
  return new Editor({
    element: null,
    extensions: [StarterKit],
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section Two' }] }
      ]
    }
  })
}

describe('splitRichMarkdownHeading', () => {
  it('turns the trailing split block into a paragraph', () => {
    const editor = createEditor()
    try {
      editor.commands.setTextSelection(9)
      expect(splitRichMarkdownHeading(editor)).toBe(true)
      expect(editor.state.doc.toJSON()).toEqual({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section ' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }
        ]
      })
    } finally {
      editor.destroy()
    }
  })

  it('leaves heading boundaries to the default Enter behavior', () => {
    const editor = createEditor()
    try {
      editor.commands.setTextSelection(12)
      expect(splitRichMarkdownHeading(editor)).toBe(false)
    } finally {
      editor.destroy()
    }
  })
})
