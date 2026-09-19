/** WCAG 2.x 相对亮度与对比度（sRGB）。 */
export function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** 解析 `#rrggbb` 或 `rgb(a)(r, g, b[, a])` 为 [r, g, b]；其它格式抛错，不猜。 */
export function parseCssColor(input) {
  const s = input.trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  throw new Error(`unsupported color: ${input}`)
}
