import { describe, expect, it } from 'vitest'

import { classifyUserAgent, DENY_UA_RULES } from '@/lib/bot-guard/user-agent'

describe('classifyUserAgent', () => {
  it.each([null, '', '   '])('空 UA %j -> deny empty', (ua) => {
    expect(classifyUserAgent(ua)).toMatchObject({ deny: true, rule: 'empty' })
  })

  it.each([
    'python-requests/2.31',
    'curl/8.4.0',
    'Wget/1.21',
    'Go-http-client/1.1',
    'Java/17.0.1',
    'Scrapy/2.11',
    'node-fetch/1.0',
    'axios/1.6',
    'aiohttp/3.9',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  ])('脚本 UA %s 被拒', (ua) => {
    const v = classifyUserAgent(ua)
    expect(v.deny).toBe(true)
    expect(v.rule).not.toBeNull()
  })

  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/116.0 Mobile Safari/537.36 MicroMessenger/8.0.40',
    'Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ])('正常 UA 放行 %s', (ua) => {
    expect(classifyUserAgent(ua).deny).toBe(false)
  })

  it('大小写不敏感', () => {
    expect(classifyUserAgent('CURL/8.0').deny).toBe(true)
    expect(classifyUserAgent('PYTHON-REQUESTS/2').deny).toBe(true)
  })

  it('超长与控制字符 UA 不抛错，family 受限', () => {
    for (const ua of ['A'.repeat(10000), 'bad\u0000\u001b[31mUA/1.0\r\n', '中文浏览器/1.0']) {
      const v = classifyUserAgent(ua)
      expect(v.family).toMatch(/^[A-Za-z0-9._-]{1,24}$/)
    }
    expect(classifyUserAgent('中文/1.0').family).toBe('other')
    expect(classifyUserAgent('Mozilla/5.0 (Windows)').family).toBe('Mozilla')
  })

  it('规则表为导出常量', () => {
    expect(DENY_UA_RULES.length).toBeGreaterThan(10)
    for (const r of DENY_UA_RULES) {
      expect(typeof r.name).toBe('string')
      expect(r.pattern).toBeInstanceOf(RegExp)
    }
  })
})
