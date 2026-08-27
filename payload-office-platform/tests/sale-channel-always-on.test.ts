/**
 * 出售频道常开契约（源码级断言）
 *
 * 出售频道曾由 `NEXT_PUBLIC_SALE_CHANNEL_ENABLED` 控制可见性——代码先上线、功能后放开。
 * 功能稳定后开关整体移除，本文件取代原来的 `sale-channel-gating` / `sale-channel-flag`
 * 两份测试，守住**反向**不变量：开关不得以任何形式复活，出售能力恒定可用。
 *
 * 为什么值得留一份测试而不是删干净：
 * 这个开关的接线曾散落在 7 个文件（两条路由、sitemap、后台字段与文案、发布端点、
 * 导航目标池），任何一处漏改都会造成「半开」——比如前台 404 但 sitemap 还在推它。
 * 移除时同样容易只删一半，或者日后有人「顺手」再加一个 env 判断。源码级断言便宜，
 * 而半开状态在生产上很难被发现：出售页没人天天看，坏了可以挂很久。
 *
 * 注意断言的是**函数与 env 读取**，不是字符串出现：`Listings.ts` 里保留了一句说明
 * 沿革的注释（提到旧变量名），那是有价值的历史，不该被测试逼着删掉。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (p: string) => readFile(resolve(ROOT, p), 'utf8')

/** 曾接过开关的全部源码位置，逐个守住不得回流。 */
const FORMERLY_GATED = [
  'src/lib/frontend/site-config.ts',
  'src/lib/frontend/site-settings.ts',
  'src/lib/frontend/nav-targets.ts',
  'src/app/(frontend)/sale/page.tsx',
  'src/app/(frontend)/[city]/sale/page.tsx',
  'src/app/(frontend)/sitemap.ts',
  'src/collections/Listings.ts',
  'src/endpoints/listing-publish-endpoint.ts',
] as const

describe('sale-channel/开关不得复活', () => {
  it.each(FORMERLY_GATED)('%s 不再有开关函数', async (path) => {
    const src = await read(path)
    expect(src).not.toContain('getSaleChannelEnabled')
  })

  it.each(FORMERLY_GATED)('%s 不再读该 env', async (path) => {
    const src = await read(path)
    expect(src).not.toContain('process.env.NEXT_PUBLIC_SALE_CHANNEL_ENABLED')
  })

  it('构建与 CI 不再注入该变量', async () => {
    const [dockerfile, quality, envExample] = await Promise.all([
      read('Dockerfile'),
      readFile(resolve(ROOT, '..', '.github/workflows/quality.yml'), 'utf8'),
      read('.env.example'),
    ])
    // 断言的是「**设置**该变量」而不是「提到它」——与上面源码断言同一考量：
    // quality.yml 里保留了一段沿革说明（为何曾经必须设、为何现在刻意不设、
    // 以及「e2e 红了不要把它加回来」），那段文字本身就是防复活的护栏，
    // 不该被一个过钝的断言逼着删掉。这条测试第一版就是写成 not.toContain('SALE_CHANNEL')
    // 而把自己的 CI 说明判红的。
    //
    // 三种「设置」形态各自锚定：Dockerfile 的 ENV 赋值、YAML 的 env 键、dotenv 赋值
    //（.env.example 里连注释掉的赋值也不留——模板里留一行注释就是在邀请别人取消注释）。
    expect(dockerfile).not.toMatch(/NEXT_PUBLIC_SALE_CHANNEL_ENABLED\s*=/)
    expect(quality).not.toMatch(/NEXT_PUBLIC_SALE_CHANNEL_ENABLED\s*:/)
    expect(envExample).not.toContain('NEXT_PUBLIC_SALE_CHANNEL_ENABLED=')
  })
})

describe('sale-channel/出售能力恒定可用', () => {
  it('城市页残留的 404 是「城市不存在」，不是功能开关', async () => {
    const src = await read('src/app/(frontend)/[city]/sale/page.tsx')
    // 这两处 404 必须留着：访问不存在的城市理应 404。断言锚定判定条件是 city，
    // 免得日后有人看到「出售页还有 404」就误删，或反过来把开关伪装成城市判断。
    expect(src).toMatch(/if \(!city\) return \{ title: '页面未找到'/)
    expect(src).toMatch(/if \(!city\) notFound\(\)/)
  })

  it('全站出售页不因功能开关 404', async () => {
    const src = await read('src/app/(frontend)/sale/page.tsx')
    // 该页只按「默认城市是否已开城」与多城市路由做重定向，没有功能开关分支
    expect(src).not.toContain("title: '页面未找到'")
  })

  it('sitemap 只按有效出售房源数判定，不再叠加开关', async () => {
    const src = await read('src/app/(frontend)/sitemap.ts')
    expect(src).toContain('shouldListSaleChannelInSitemap(city.saleListings.length)')
    expect(src).not.toContain('getSaleChannelEnabled() && shouldListSaleChannelInSitemap')
  })

  it('导航目标池不再有功能开关机制', async () => {
    const [targets, settings] = await Promise.all([
      read('src/lib/frontend/nav-targets.ts'),
      read('src/lib/frontend/site-settings.ts'),
    ])
    // saleChannel 是 featureFlag 的唯一使用者，机制随开关一并移除；
    // 将来若真要再引入功能开关，应连同新的使用场景一起设计，而不是留一个空壳。
    expect(targets).not.toContain('featureFlag')
    expect(settings).not.toContain('featureFlag')
    // /sale 目标本身必须留着，否则后台导航配置会丢一个可选项
    expect(targets).toContain("id: 'sale'")
  })

  it('mark_sold 不再被功能开关拒绝', async () => {
    const src = await read('src/endpoints/listing-publish-endpoint.ts')
    expect(src).not.toContain('出售功能未开启')
  })
})

describe('sale-channel/按 businessType 分流仍在', () => {
  it('出售信息字段组只在出售房源显示', async () => {
    const src = await read('src/collections/Listings.ts')
    expect(src).toMatch(/saleTermsCondition[\s\S]{0,200}data\?\.businessType === 'sale'/)
    expect(src).toContain('condition: saleTermsCondition')
  })

  it('租售类型字段恒显示（开关移除后不再有条件）', async () => {
    const src = await read('src/collections/Listings.ts')
    expect(src).not.toContain('businessTypeCondition')
  })
})

describe('sale-channel/数据层始终不看可见性开关', () => {
  it('租赁列表排除 sale 与在租面积口径都不看开关', async () => {
    const [cached, facade] = await Promise.all([
      read('src/lib/frontend/cached-queries.ts'),
      read('src/domain/public-catalog/facade.ts'),
    ])
    // 这是数据正确性、不是可见性。当年若把开关挂到这里，关掉开关会让出售房源
    // 混进租金列表——比"少一个频道"严重得多。开关没了，这条约束依然成立。
    expect(cached).not.toContain('getSaleChannelEnabled')
    expect(facade).not.toContain('getSaleChannelEnabled')
  })

  it('有效供给谓词不看开关', async () => {
    const src = await read('src/domain/review/effective-supply.ts')
    expect(src).not.toContain('getSaleChannelEnabled')
  })
})
