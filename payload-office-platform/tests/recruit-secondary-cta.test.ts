import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import RecruitSecondaryCta from '@/components/frontend/city-partner/RecruitSecondaryCta'

const entry = (title: string) => ({
  title,
  body: `${title} 的一句话说明。`,
  action: React.createElement('a', { className: 'btn btn--ghost rc-secondary-btn', href: '/entrust' }, '登记找房需求'),
})

const render = (props: Parameters<typeof RecruitSecondaryCta>[0]) =>
  renderToStaticMarkup(React.createElement(RecruitSecondaryCta, props))

describe('RecruitSecondaryCta', () => {
  it('renders nothing at all when there is neither an entry nor a footer', () => {
    // 空态整段不渲染：留一条只剩背景的尾注带 = 多一段无意义留白。
    expect(render({ entries: [] })).toBe('')
  })

  it('still renders the tail section when only a footer is provided', () => {
    // footer 承载的是城市路由的辅助跳转链接；没有入口卡时它仍然要出现，
    // 否则「委托找房 / 城市合伙人政策」两条既有入口会随空态一起消失。
    const markup = render({ entries: [], footer: React.createElement('nav', null, '辅助入口') })
    expect(markup).toContain('rc-section--tail')
    expect(markup).toContain('辅助入口')
    expect(markup).not.toContain('rc-cta-list')
  })

  it('renders one card per entry as h2 and never introduces a second h1 or a live region', () => {
    // h1 恰好 1 个由 tests/city-partner-page-seo.test.ts:37 与
    // tests/e2e/city-partner-flow.spec.ts:31 双锁；`getByRole('status')`
    // 在 city-partner-flow 里是**唯一**定位符，新增任何 live region 都会
    // 触发 strict mode violation。这两条都必须由本组件自己守住。
    const markup = render({
      label: '客户与业主专项服务',
      entries: [entry('您是需要在杭州寻租办公室的企业？'), entry('手里有杭州空置房源需要出租？')],
    })
    expect(markup.match(/<h2\b/g)).toHaveLength(2)
    expect(markup).not.toMatch(/<h1\b/)
    expect(markup).not.toMatch(/role="status"|aria-live/)
    expect(markup).toContain('aria-label="客户与业主专项服务"')
    expect(markup.match(/class="rc-cta"/g)).toHaveLength(2)
  })

  it('omits aria-label instead of emitting an empty one', () => {
    const markup = render({ entries: [entry('您是需要寻租办公室的企业？')] })
    expect(markup).not.toContain('aria-label')
  })
})
