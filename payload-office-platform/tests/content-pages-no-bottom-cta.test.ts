import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 内容页（/pages/[slug]）与资讯详情页（/news/[slug]）底部不挂咨询模块。
 *
 * 产品裁定（2026-10-16）：除楼盘、房源详情页外，其它页面去掉底部「需要专业选址建议？/ 提交需求」模块。
 * 这里读源码做契约，防止后来者把它加回去；样式块一并删掉，不留死 CSS。
 */
const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe.each([
  'src/app/(frontend)/pages/[slug]/page.tsx',
  'src/app/(frontend)/news/[slug]/page.tsx',
])('%s', (file) => {
  const source = read(file)

  it('不渲染底部咨询模块，也不再引入 InquiryModal', () => {
    expect(source).not.toContain('page-detail__cta')
    expect(source).not.toContain('InquiryModal')
    expect(source).not.toContain('需要专业选址建议')
  })
})

it('底部咨询模块的样式已一并移除', () => {
  expect(read('src/app/(frontend)/styles.css')).not.toContain('page-detail__cta')
})

it('楼盘 / 房源详情页的咨询入口不受影响', () => {
  expect(read('src/components/frontend/city/CityListingDetailView.tsx')).toContain('InquiryModal')
  expect(read('src/components/frontend/building-detail/BuildingDetailLayout.tsx')).toMatch(/InquiryModal|DetailSideRail|StickyInquiryBar/)
})
