import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/shanghai',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}))

import SiteFooter from '@/components/frontend/SiteFooter'
import { ICP_RECORD_URL, isValidIcpRecordNumber, normalizeIcpRecordNumber } from '@/lib/frontend/icp-record'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'

/**
 * OPT-097：页脚 ICP 备案号。后台字段校验与前台映射共用 normalizeIcpRecordNumber，
 * 这里锁的是它的口径：三种常见形态放行，明显不是备案号的串拒绝。
 */
describe('normalizeIcpRecordNumber', () => {
  it('三种常见形态放行，首尾空白去掉', () => {
    expect(normalizeIcpRecordNumber('沪ICP备2026037944号')).toBe('沪ICP备2026037944号')
    expect(normalizeIcpRecordNumber('京ICP证030173号')).toBe('京ICP证030173号')
    expect(normalizeIcpRecordNumber('粤ICP备12345678号-1')).toBe('粤ICP备12345678号-1')
    expect(normalizeIcpRecordNumber('  沪ICP备2026037944号  ')).toBe('沪ICP备2026037944号')
  })

  it('空串 / null / undefined / 非字符串 → null', () => {
    expect(normalizeIcpRecordNumber('')).toBeNull()
    expect(normalizeIcpRecordNumber('   ')).toBeNull()
    expect(normalizeIcpRecordNumber(null)).toBeNull()
    expect(normalizeIcpRecordNumber(undefined)).toBeNull()
    expect(normalizeIcpRecordNumber(2026037944)).toBeNull()
  })

  it('缺省份 / 缺「号」/ 中间带空格 / 纯数字 / 英文 → null', () => {
    expect(normalizeIcpRecordNumber('ICP备2026037944号')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备2026037944')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备 2026037944号')).toBeNull()
    expect(normalizeIcpRecordNumber('2026037944')).toBeNull()
    expect(normalizeIcpRecordNumber('abc')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备2026037944号-abc')).toBeNull()
  })
})

describe('isValidIcpRecordNumber（后台字段 validate）', () => {
  it('留空合法', () => {
    expect(isValidIcpRecordNumber(undefined)).toBe(true)
    expect(isValidIcpRecordNumber(null)).toBe(true)
    expect(isValidIcpRecordNumber('')).toBe(true)
    expect(isValidIcpRecordNumber('  ')).toBe(true)
  })

  it('填了就必须能归一化', () => {
    expect(isValidIcpRecordNumber('沪ICP备2026037944号')).toBe(true)
    expect(isValidIcpRecordNumber('abc')).toBe(false)
  })
})

it('备案链接固定指向工信部备案系统', () => {
  expect(ICP_RECORD_URL).toBe('https://beian.miit.gov.cn/')
})

const CITIES = [{ slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 }]

function renderFooter(icpRecordNumber: string | null): string {
  return renderToStaticMarkup(
    React.createElement(SiteFooter, {
      cities: CITIES,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled: true,
      settings: { ...SITE_SETTINGS_FALLBACK, icpRecordNumber },
    }),
  )
}

describe('SiteFooter 备案号', () => {
  it('兜底配置里没有备案号：代码不得替运营编一个', () => {
    expect(SITE_SETTINGS_FALLBACK.icpRecordNumber).toBeNull()
  })

  it('有值：版权之后渲染指向工信部的新窗口链接', () => {
    const html = renderFooter('沪ICP备2026037944号')
    expect(html).toMatch(
      /<a class="site-footer__icp" href="https:\/\/beian\.miit\.gov\.cn\/" target="_blank" rel="noopener noreferrer">沪ICP备2026037944号<\/a>/,
    )
    // 顺序：© 版权 → 备案号 → 城市副标题
    expect(html.indexOf('©')).toBeLessThan(html.indexOf('site-footer__icp'))
    expect(html.indexOf('site-footer__icp')).toBeLessThan(html.indexOf('商务办公租赁'))
  })

  it('无值：整个节点不渲染', () => {
    const html = renderFooter(null)
    expect(html).not.toContain('site-footer__icp')
    expect(html).not.toContain('beian.miit.gov.cn')
  })
})

describe('toView 映射契约', () => {
  it('site-settings.ts 用 normalizeIcpRecordNumber 映射 icpRecordNumber（非法值不得原样透传）', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/frontend/site-settings.ts'), 'utf8')
    expect(src).toContain('icpRecordNumber: normalizeIcpRecordNumber(doc.icpRecordNumber)')
  })
})
