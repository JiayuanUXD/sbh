import { describe, expect, it } from 'vitest'

import { classifyPath, readIsPrefetch, type GuardClass } from '@/lib/bot-guard/path-class'

const cases: ReadonlyArray<[string, string, GuardClass, boolean?]> = [
  ['GET', '/sitemap.xml', 'sitemap'],
  ['GET', '/sitemaps/shanghai/listings/1.xml', 'sitemap'],
  ['GET', '/api/media/file/a.jpg', 'media'],
  ['GET', '/api/mini/v1/listings', 'mini-read'],
  ['GET', '/api/mini/v1/buildings/xxx', 'mini-read'],
  ['GET', '/api/mini/v1/home', 'mini-read'],
  ['GET', '/api/mini/v1/session', 'exempt'],
  ['GET', '/api/mini/v1/favorites', 'exempt'],
  ['GET', '/api/health', 'exempt'],
  ['GET', '/api/inquiries', 'exempt'],
  ['GET', '/admin', 'exempt'],
  ['GET', '/admin/collections/listings', 'exempt'],
  ['GET', '/_next/static/a.js', 'exempt'],
  ['GET', '/robots.txt', 'exempt'],
  ['GET', '/favicon.ico', 'exempt'],
  ['GET', '/logo.png', 'exempt'],
  ['GET', '/', 'page'],
  ['GET', '/listings', 'page'],
  ['GET', '/shanghai/listings/abc', 'page'],
  ['GET', '/news/x', 'page'],
  ['GET', '/search', 'page'],
  ['POST', '/listings', 'exempt'],
  ['HEAD', '/listings', 'page'],
  ['OPTIONS', '/listings', 'exempt'],
  ['GET', '/listings', 'exempt', true],
]

describe('classifyPath', () => {
  it.each(cases)('%s %s -> %s', (method, pathname, expected, isPrefetch = false) => {
    expect(classifyPath({ method, pathname, isPrefetch })).toBe(expected)
  })
})

describe('readIsPrefetch', () => {
  const make = (h: Record<string, string>) => (name: string) => h[name] ?? null
  it('任一预取头为真', () => {
    expect(readIsPrefetch(make({ 'next-router-prefetch': '1' }))).toBe(true)
    expect(readIsPrefetch(make({ purpose: 'prefetch' }))).toBe(true)
    expect(readIsPrefetch(make({ 'sec-purpose': 'prefetch' }))).toBe(true)
    expect(readIsPrefetch(make({ 'sec-purpose': 'prefetch;prerender' }))).toBe(true)
  })
  it('其余为假', () => {
    expect(readIsPrefetch(make({}))).toBe(false)
    expect(readIsPrefetch(make({ purpose: 'navigate' }))).toBe(false)
    expect(readIsPrefetch(make({ 'next-router-prefetch': '0' }))).toBe(false)
  })
})
