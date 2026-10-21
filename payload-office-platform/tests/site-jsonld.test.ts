import { describe, expect, it } from 'vitest'

import { serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { buildSiteJsonLd } from '@/lib/frontend/site-jsonld'

const ORIGIN = 'https://shangban.cc'

describe('buildSiteJsonLd', () => {
  it('输出 Organization 与 WebSite，WebSite 的 publisher 指向 Organization', () => {
    const ld = buildSiteJsonLd(ORIGIN, '商办租赁', '/api/media/file/logo.png')
    const [org, site] = ld['@graph']
    expect(ld['@context']).toBe('https://schema.org')
    expect(org).toMatchObject({
      '@type': 'Organization',
      '@id': 'https://shangban.cc/#organization',
      name: '商办租赁',
      url: 'https://shangban.cc/',
      logo: 'https://shangban.cc/api/media/file/logo.png',
    })
    expect(site).toMatchObject({
      '@type': 'WebSite',
      '@id': 'https://shangban.cc/#website',
      name: '商办租赁',
      inLanguage: 'zh-CN',
      publisher: { '@id': 'https://shangban.cc/#organization' },
    })
  })

  it('没有 logo 时不输出 logo 字段，也不虚构地址、电话或 sameAs', () => {
    const [org, site] = buildSiteJsonLd(ORIGIN, '商办租赁', null)['@graph']
    expect(org).not.toHaveProperty('logo')
    for (const node of [org, site]) {
      expect(node).not.toHaveProperty('address')
      expect(node).not.toHaveProperty('telephone')
      expect(node).not.toHaveProperty('sameAs')
      expect(node).not.toHaveProperty('potentialAction')
    }
  })

  it('站点名里的 </script> 经 serializeJsonLd 转义，不会提前关闭 script 标签', () => {
    const html = serializeJsonLd(buildSiteJsonLd(ORIGIN, '</script><b>x', null))
    expect(html).not.toContain('</script>')
    expect(html).toContain('\\u003c/script>')
  })
})
