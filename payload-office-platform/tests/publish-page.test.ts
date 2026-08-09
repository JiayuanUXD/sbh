import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PublishPage, { metadata } from '@/app/(frontend)/publish/page'

describe('/publish page', () => {
  it('uses canonical metadata for the static publishing route', () => {
    expect(metadata.alternates?.canonical).toBe('/publish')
    expect(metadata.title).toBe('投放房源｜免费委托出租')
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('renders one h1, one submission form, four process steps, and Service JSON-LD', () => {
    const markup = renderToStaticMarkup(React.createElement(PublishPage))

    expect(markup.match(/<h1\b/g)).toHaveLength(1)
    expect(markup.match(/class="process-steps__item"/g)).toHaveLength(4)
    expect(markup.match(/<form\b/g)).toHaveLength(1)
    expect(markup).toContain('房源委托 商办租赁 帮您出租')
    expect(markup).toContain('"@type":"Service"')
    expect(markup).not.toContain('"@type":"FAQPage"')
  })
})
