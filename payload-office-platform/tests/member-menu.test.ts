import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }))

import MemberMenu, { loginHref, memberDisplayName } from '@/components/frontend/member/MemberMenu'

const member = { id: 1, phoneMasked: '138****1234', nickname: null, hasPassword: false, wechatBound: false, createdAt: '' }

describe('MemberMenu', () => {
  it('loginHref 带 returnTo', () => {
    expect(loginHref('/listings?type=coworking')).toBe('/login?returnTo=%2Flistings%3Ftype%3Dcoworking')
  })
  it('显示名：昵称首字 / 尾号', () => {
    expect(memberDisplayName({ ...member, nickname: '小王' })).toBe('小')
    expect(memberDisplayName(member)).toBe('尾号 1234')
  })
  it('未登录桌面态渲染登录链接', () => {
    const html = renderToStaticMarkup(React.createElement(MemberMenu, { member: null, pathname: '/buildings', variant: 'desktop' }))
    expect(html).toContain('href="/login?returnTo=%2Fbuildings"')
    expect(html).toContain('登录')
  })
  it('已登录抽屉态渲染四项', () => {
    const html = renderToStaticMarkup(React.createElement(MemberMenu, { member, pathname: '/', variant: 'drawer' }))
    for (const text of ['我的收藏', '我的咨询与委托', '账号设置', '退出登录']) expect(html).toContain(text)
    expect(html).toContain('/account/favorites')
    expect(html).toContain('/account/inquiries')
  })
})
