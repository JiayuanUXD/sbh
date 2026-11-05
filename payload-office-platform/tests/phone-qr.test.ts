import { describe, expect, it } from 'vitest'
import { generatePhoneQrSvg, toSvgDataUri } from '@/lib/frontend/phone-qr'

describe('phone-qr 扫码拨号 SVG 生成工具', () => {
  it('传入 tel: 链接或格式化电话号码时，生成有效且紧凑的 SVG 二维码', async () => {
    const svg1 = await generatePhoneQrSvg('tel:13162247666')
    const svg2 = await generatePhoneQrSvg('131-6224-7666')

    expect(svg1).toBeTruthy()
    expect(svg1).toContain('<svg')
    expect(svg1).toContain('viewBox=')
    expect(svg1).toContain('<path')
    // 两种输入格式规范化为同一个 tel:13162247666，生成的 SVG 完全一致
    expect(svg1).toBe(svg2)
  })

  it('支持 400 号码与带国际区号 +86 的号码', async () => {
    const svg400 = await generatePhoneQrSvg('400-820-1234')
    const svgPlus = await generatePhoneQrSvg('+86 21 6888 8888')

    expect(svg400).toContain('<svg')
    expect(svgPlus).toContain('<svg')
  })

  it('传入空字符串或无有效数字时返回 null', async () => {
    expect(await generatePhoneQrSvg('')).toBeNull()
    expect(await generatePhoneQrSvg('   ')).toBeNull()
    expect(await generatePhoneQrSvg('tel:---')).toBeNull()
  })

  it('toSvgDataUri 生成可直接用于 <img src> 的 data URI', async () => {
    const svg = await generatePhoneQrSvg('tel:13162247666')
    const uri = toSvgDataUri(svg!)

    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    expect(decodeURIComponent(uri.replace('data:image/svg+xml;utf8,', ''))).toContain('<svg')
  })
})
