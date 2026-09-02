import { marked } from 'marked'

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const safeExternalHref = (href: string): string | null => {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' || url.protocol === 'http:' ? href : null
  } catch {
    return null
  }
}

export const renderMarkdown = (content: string): string => {
  const renderer = new marked.Renderer()

  renderer.html = ({ text }) => escapeHtml(text)
  renderer.image = ({ text }) => escapeHtml(text)
  renderer.link = function ({ href, tokens }) {
    const label = this.parser.parseInline(tokens)
    const safeHref = safeExternalHref(href)
    if (!safeHref) {
      return `<a>${label}</a>`
    }

    return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  }

  return marked.parse(content, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  })
}
