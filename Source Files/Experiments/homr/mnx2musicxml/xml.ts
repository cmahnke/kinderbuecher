/**
 * Minimal XML element tree used by the MNX -> MusicXML writer.
 */

export interface XmlElement {
  tag: string
  attrs: Record<string, string>
  children: Array<XmlElement | string>
}

export type XmlAttrs = Record<string, string | number | boolean | undefined>

export function el(
  tag: string,
  attrs: XmlAttrs = {},
  children: Array<XmlElement | string> = [],
): XmlElement {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) clean[key] = String(value)
  }
  return { tag, attrs: clean, children }
}

export function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function xmlEscapeAttr(text: string): string {
  return xmlEscape(text).replaceAll('"', '&quot;')
}

/** Pretty-prints an element tree with a 4-space indent (MusicXML convention). */
export function serializeXml(node: XmlElement, depth = 0): string {
  const pad = '    '.repeat(depth)
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${xmlEscapeAttr(value)}"`)
    .join('')
  if (node.children.length === 0) return `${pad}<${node.tag}${attrs}/>`
  const strings = node.children.filter((child): child is string => typeof child === 'string')
  if (strings.length === node.children.length) {
    return `${pad}<${node.tag}${attrs}>${xmlEscape(strings.join(''))}</${node.tag}>`
  }
  const lines = [`${pad}<${node.tag}${attrs}>`]
  for (const child of node.children) {
    if (typeof child === 'string') {
      lines.push(`${'    '.repeat(depth + 1)}${xmlEscape(child)}`)
    } else {
      lines.push(serializeXml(child, depth + 1))
    }
  }
  lines.push(`${pad}</${node.tag}>`)
  return lines.join('\n')
}
