import { Mark, type JSONContent } from '@tiptap/core'

// marked's GFM inline escape rule: a backslash before ASCII punctuation.
const ESCAPABLE_CHARACTER_PATTERN = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/
const ESCAPED_CHARACTER_PATTERN = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/
// Why: the serializer entity-encodes these itself; a backslash in front would survive as literal text.
const ENTITY_ENCODED_CHARACTERS = new Set(['&', '<', '>'])
const MARK_NAME = 'richMarkdownEscapedCharacter'
const MARKER_ATTRIBUTE = 'data-rich-markdown-escaped-character'

/**
 * Text that was backslash-escaped in the source. Tiptap's markdown parser has no
 * handler for marked's `escape` token (the character was deleted on load) and its
 * text serializer never re-escapes, so the mark carries the escape through the
 * document and `getMarkdown` writes it back per character (see below).
 */
export const RichMarkdownEscapedCharacter = Mark.create({
  name: MARK_NAME,
  inclusive: false,
  keepOnSplit: false,

  markdownTokenName: MARK_NAME,
  markdownTokenizer: {
    name: MARK_NAME,
    level: 'inline',
    start: (src: string) => src.indexOf('\\'),
    tokenize(src: string) {
      const match = src.match(ESCAPED_CHARACTER_PATTERN)
      if (!match) {
        return undefined
      }
      return { type: MARK_NAME, raw: match[0], character: match[1] }
    }
  },
  parseMarkdown: (token, helpers) => {
    const character = (token as { character?: string }).character
    if (token.type !== MARK_NAME || !character) {
      return []
    }
    return helpers.applyMark(MARK_NAME, [{ type: 'text', text: character }])
  },
  // Why: a mark's markdown is one prefix for the whole run, so `\*\*` would come out as `\**`;
  // this is only the fallback for a serializer that bypasses getMarkdown.
  renderMarkdown: (node, helpers) => `\\${helpers.renderChildren(node)}`,

  parseHTML() {
    return [{ tag: `span[${MARKER_ATTRIBUTE}]` }]
  },
  renderHTML() {
    return ['span', { [MARKER_ATTRIBUTE]: '' }, 0]
  },

  onBeforeCreate() {
    // Why: must be registered after `Markdown`, whose onBeforeCreate installs the
    // getMarkdown this replaces; the manager itself is what serializes.
    const editor = this.editor
    editor.getMarkdown = () => {
      const manager = editor.markdown
      if (!manager) {
        throw new Error('RichMarkdownEscapedCharacter requires the Markdown extension')
      }
      return manager.serialize(escapeMarkedCharacters(editor.getJSON()) as JSONContent)
    }
  }
})

/** Turns escaped-mark text back into `\X` per character so mark runs around it stay continuous. */
function escapeMarkedCharacters(node: JSONContent): JSONContent {
  if (node.type === 'text' && node.marks?.some((mark) => mark.type === MARK_NAME)) {
    const marks = node.marks.filter((mark) => mark.type !== MARK_NAME)
    const insideCode = marks.some((mark) => mark.type === 'code')
    const text = insideCode
      ? (node.text ?? '')
      : Array.from(node.text ?? '')
          .map((character) =>
            ESCAPABLE_CHARACTER_PATTERN.test(character) && !ENTITY_ENCODED_CHARACTERS.has(character)
              ? `\\${character}`
              : character
          )
          .join('')
    return marks.length > 0 ? { ...node, text, marks } : { type: 'text', text }
  }
  if (!node.content) {
    return node
  }
  return { ...node, content: node.content.map(escapeMarkedCharacters) }
}
