import { Node } from '@tiptap/core'

// marked's GFM inline escape rule: a backslash before ASCII punctuation.
const ESCAPED_CHARACTER_PATTERN = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/
const NODE_NAME = 'richMarkdownEscapedCharacter'
const MARKER_ATTRIBUTE = 'data-rich-markdown-escaped-character'

/**
 * One inline atom per backslash-escaped character. Tiptap's markdown parser has
 * no handler for marked's `escape` token (the character was deleted on load),
 * and its text serializer never re-escapes, so a text node could not carry the
 * backslash back to disk. An atom that owns the token round-trips `\$` as `\$`.
 */
export const RichMarkdownEscapedCharacter = Node.create({
  name: NODE_NAME,
  inline: true,
  group: 'inline',
  atom: true,
  // Why: reads as one character of text; a node selection on click would be noise.
  selectable: false,

  addAttributes() {
    return {
      character: { default: '', rendered: false }
    }
  },

  markdownTokenName: NODE_NAME,
  markdownTokenizer: {
    name: NODE_NAME,
    level: 'inline',
    start: (src: string) => src.indexOf('\\'),
    tokenize(src: string) {
      const match = src.match(ESCAPED_CHARACTER_PATTERN)
      if (!match) {
        return undefined
      }
      return { type: NODE_NAME, raw: match[0], character: match[1] }
    }
  },
  parseMarkdown: (token, helpers) => {
    const character = (token as { character?: string }).character
    if (token.type !== NODE_NAME || !character) {
      return []
    }
    return helpers.createNode(NODE_NAME, { character })
  },
  renderMarkdown: (node) => `\\${String(node.attrs?.character ?? '')}`,
  renderText: ({ node }) => String(node.attrs.character ?? ''),

  parseHTML() {
    return [
      {
        tag: `span[${MARKER_ATTRIBUTE}]`,
        getAttrs: (element: HTMLElement) => {
          const character = element.getAttribute(MARKER_ATTRIBUTE) ?? ''
          return ESCAPED_CHARACTER_PATTERN.test(`\\${character}`) ? { character } : false
        }
      }
    ]
  },

  renderHTML({ node }) {
    const character = String(node.attrs.character ?? '')
    return ['span', { [MARKER_ATTRIBUTE]: character }, character]
  }
})
