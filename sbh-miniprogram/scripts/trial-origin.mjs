import { isIP } from 'node:net'

export const productionHost = new URL('https://sbh-286300-10-1253925058.sh.run.tcloudbase.com').hostname
const numericIpPartPattern = /^(?:0x[0-9a-f]+|0[0-7]*|[0-9]+)$/i

function isNumericIpLike(host) {
  if (/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(host)) return true
  const parts = host.split('.')
  return parts.length > 1 && parts.every((part) => numericIpPartPattern.test(part))
}

export function normalizeTrialOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('trial API origin 必须是有效 HTTPS origin') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('trial API origin 必须是无路径的 HTTPS origin')
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1] ?? ''
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (/:\d+$/.test(authority) || /%2e/i.test(authority) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.') || isIP(hostname) || isNumericIpLike(hostname) || hostname === productionHost) throw new Error('trial API origin 不能是生产、本机或显式端口')
  return { origin: url.origin, host: url.hostname }
}
