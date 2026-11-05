import QRCode from 'qrcode'

/**
 * 将电话号码或 `tel:` 链接规范化为标准拨号 URI（如 `tel:13162247666`）。
 * 若无有效数字则返回 null。
 */
export function normalizeTelUri(input: string): string | null {
  if (!input) return null
  const stripped = input.trim().replace(/^tel:/i, '').trim()
  if (!stripped) return null

  const hasLeadingPlus = stripped.startsWith('+')
  const digits = stripped.replace(/\D/g, '')
  if (!digits) return null

  return `tel:${hasLeadingPlus ? '+' : ''}${digits}`
}

/**
 * 在服务端生成电话拨号二维码的紧凑矢量 SVG 字符串。
 * 手机原生相机、微信扫一扫等识别 `tel:` URI 后可直接呼起系统拨号。
 */
export async function generatePhoneQrSvg(phoneOrHref: string): Promise<string | null> {
  const telUri = normalizeTelUri(phoneOrHref)
  if (!telUri) return null

  try {
    const svg = await QRCode.toString(telUri, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#1d1d1f',
        light: '#ffffff',
      },
    })
    return svg.trim()
  } catch {
    return null
  }
}

/**
 * 将 SVG 转换为可直接嵌入 `<img src={...} />` 的安全 Data URI。
 */
export function toSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`
}
