/**
 * 出售功能开关的接线契约（源码级断言）
 *
 * 单测无法真正渲染 Next 路由或 Payload admin，但可以锁住「开关确实接到了每一处」——
 * 漏接一处的后果是功能在用户面前半可见：比如路由 404 了但 sitemap 还在推它，
 * 爬虫撞一堆死链；或者后台还能录出售房源，前台却查不到。
 *
 * 守护不变量：
 *   - 两条出售路由在开关关闭时 404（页面与 metadata 都要挡）
 *   - sitemap 不输出出售频道条目
 *   - 后台租售类型 / 出售信息字段受开关控制，且开关在服务端求值
 *   - mark_sold 动作在服务端被拒绝
 *   - 数据层的租售隔离**不受**开关影响
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (p: string) => readFile(resolve(ROOT, p), 'utf8')

describe('sale-channel-gating/C 端', () => {
  it.each([
    'src/app/(frontend)/[city]/sale/page.tsx',
    'src/app/(frontend)/sale/page.tsx',
  ])('%s 在开关关闭时 404', async (path) => {
    const src = await read(path)
    expect(src).toContain('getSaleChannelEnabled')
    // 页面本身必须 notFound，而不是渲染空列表——空列表会暴露频道已存在
    expect(src).toMatch(/if \(!getSaleChannelEnabled\(\)\) notFound\(\)/)
    // metadata 也要挡，否则标题/canonical 会泄露频道
    expect(src).toMatch(/getSaleChannelEnabled\(\)\) return \{ title: '页面未找到'/)
  })

  it('sitemap 不推出售频道条目', async () => {
    const src = await read('src/app/(frontend)/sitemap.ts')
    expect(src).toContain('getSaleChannelEnabled() && shouldListSaleChannelInSitemap')
  })
})

describe('sale-channel-gating/后台', () => {
  it('开关在服务端求值一次，不在 condition 内部读 env', async () => {
    const src = await read('src/collections/Listings.ts')
    expect(src).toContain('const saleChannelEnabled = getSaleChannelEnabled()')
    // admin.condition 在浏览器执行，读不到服务端 env；若在 condition 体内调用
    // 开关函数，线上会静默失效（永远拿到 undefined）
    expect(src).not.toMatch(/condition:\s*\([^)]*\)\s*=>[^\n]*getSaleChannelEnabled\(\)/)
  })

  it('租售类型与出售信息字段都接了开关', async () => {
    const src = await read('src/collections/Listings.ts')
    expect(src).toContain('admin: { condition: businessTypeCondition }')
    expect(src).toContain('condition: saleTermsCondition')
  })

  it('开关关闭时仍显示已是出售的记录（避免运营看不出类型）', async () => {
    const src = await read('src/collections/Listings.ts')
    expect(src).toMatch(/businessTypeCondition[\s\S]{0,400}data\?\.businessType === 'sale'/)
  })

  it('mark_sold 在服务端被拒绝', async () => {
    const src = await read('src/endpoints/listing-publish-endpoint.ts')
    expect(src).toMatch(/action === 'mark_sold' && !getSaleChannelEnabled\(\)/)
  })
})

describe('sale-channel-gating/数据层不受开关影响', () => {
  it('租赁列表排除 sale 与在租面积口径都不看开关', async () => {
    const [cached, facade] = await Promise.all([
      read('src/lib/frontend/cached-queries.ts'),
      read('src/domain/public-catalog/facade.ts'),
    ])
    // 这些是数据正确性，不是可见性。挂上开关反而会让出售房源混进租金列表
    expect(cached).not.toContain('getSaleChannelEnabled')
    expect(facade).not.toContain('getSaleChannelEnabled')
  })

  it('有效供给谓词不看开关', async () => {
    const src = await read('src/domain/review/effective-supply.ts')
    expect(src).not.toContain('getSaleChannelEnabled')
  })
})

describe('sale-channel-gating/文案泄露', () => {
  /**
   * 线上实测发现：字段藏干净了，tab 标题却还叫「价格与交易参数」，描述里写着
   * 「产权信息只在出售房源显示」——等于公告「出售功能存在，只是你看不到」。
   * 隐藏一个功能要连它的名字一起隐藏。
   */
  it('价格 tab 的标题与描述受开关控制，不是写死的', async () => {
    const src = await read('src/collections/Listings.ts')

    expect(src).toContain("const priceTabLabel = saleChannelEnabled ? '价格与交易参数' : '租赁参数'")
    expect(src).toContain('const priceTabDescription = saleChannelEnabled')
    // tab 定义处必须引用变量，而不是再写一遍字面量
    expect(src).toContain('label: priceTabLabel')
    expect(src).toContain('description: priceTabDescription')
  })

  it('关闭态的描述里不出现「产权」「出售」字样', async () => {
    const src = await read('src/collections/Listings.ts')
    const offBranch = /: '(集中维护结构化价格[^']*)'/.exec(src)?.[1] ?? ''

    expect(offBranch).not.toContain('产权')
    expect(offBranch).not.toContain('出售')
  })
})
