/**
 * Normalizes URLs allowed in public media DTOs.
 *
 * Public media may be served from this origin (`/…`) or a regular HTTP(S)
 * CDN. Everything else is rejected before it reaches a browser-facing DTO.
 */
export function normalizePublicMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null

  if (value.startsWith('/')) {
    if (value.startsWith('//') || value.startsWith('/\\')) return null
    return value
  }

  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}
