import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import PagerCapNote from '@/components/frontend/listing/PagerCapNote'
import { MAX_PUBLIC_PAGE } from '@/domain/public-catalog/page-cap'

/**
 * OPT-128 §5.7：页码封顶时分页处如实提示，不伪装成「总共只有这么多」。
 */

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

describe('PagerCapNote', () => {
  it('capped=false 不渲染任何东西', () => {
    expect(renderToStaticMarkup(createElement(PagerCapNote, { capped: false }))).toBe('')
  })

  it('capped=true 如实说明仅显示前 50 页并引导增加筛选条件', () => {
    const html = renderToStaticMarkup(createElement(PagerCapNote, { capped: true }))
    expect(html).toContain(`仅显示前 ${MAX_PUBLIC_PAGE} 页`)
    expect(html).toContain('增加筛选条件')
    expect(html).not.toContain('没有结果')
  })
})

describe('两个列表视图接线', () => {
  const views = [
    'src/components/frontend/city/CityListingsView.tsx',
    'src/components/frontend/city/CityBuildingsView.tsx',
  ]

  it.each(views)('%s 把 capped 传给 EmptyOutOfRange 并在 ListPager 后渲染 PagerCapNote', (file) => {
    const src = read(file)
    expect(src).toMatch(/<EmptyOutOfRange[^>]*\bcapped=\{/s)
    expect(src).toContain('<PagerCapNote capped={capped} />')
    expect(src.indexOf('<PagerCapNote')).toBeGreaterThan(src.indexOf('<ListPager'))
  })

  it('房源视图读 pagination.capped，楼盘视图读 result.capped', () => {
    expect(read(views[0])).toMatch(/capped[^\n]*\} = pagination|capped\b[\s\S]{0,40}pagination/)
    expect(read(views[1])).toMatch(/\bcapped,[\s\S]{0,200}\} = result/)
  })
})
