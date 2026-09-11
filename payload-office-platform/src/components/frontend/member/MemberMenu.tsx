'use client'

import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import { useMember } from './MemberProvider'

export function loginHref(pathname: string): string {
  return `/login?returnTo=${encodeURIComponent(pathname)}`
}

export function memberDisplayName(member: MemberDto): string {
  const nick = member.nickname?.trim()
  if (nick) return Array.from(nick)[0]
  return member.phoneMasked.slice(-2)
}

const ITEMS = [
  { href: '/account/favorites', label: '我的收藏' },
  { href: '/account', label: '账号设置' },
] as const

/**
 * 顶栏登录入口 / 会员菜单（OPT-088 §8.1）。
 * desktop：登录 pill 或头像触发器 + 下拉；drawer：抽屉顶部的平铺列表。
 * 下拉的 Esc / 外点关闭 / 焦点归还照 SiteNav 抽屉的做法。
 */
export default function MemberMenu({ member: initialMember, pathname, variant, onNavigate }: Readonly<{
  member: MemberDto | null
  pathname: string
  variant: 'desktop' | 'drawer'
  onNavigate?: () => void
}>) {
  const { logout, member: contextMember } = useMember()
  const member = contextMember ?? initialMember
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!member) {
    if (variant === 'drawer') {
      return (
        <div className="member-drawer">
          <Link href={loginHref(pathname)} className="mobile-drawer__link member-drawer__login" onClick={onNavigate}>登录 / 注册</Link>
        </div>
      )
    }
    return <Link href={loginHref(pathname)} className="btn btn--ghost btn--sm member-login">登录</Link>
  }

  const items = ITEMS.map((item) => (
    <Link key={item.href} href={item.href} className={variant === 'drawer' ? 'mobile-drawer__link' : 'member-menu__item'} role={variant === 'drawer' ? undefined : 'menuitem'} onClick={() => { setOpen(false); onNavigate?.() }}>
      {item.label}
    </Link>
  ))
  const logoutButton = (
    <button type="button" className={variant === 'drawer' ? 'mobile-drawer__link member-drawer__logout' : 'member-menu__item member-menu__item--danger'} role={variant === 'drawer' ? undefined : 'menuitem'} onClick={() => { void logout() }}>
      退出登录
    </button>
  )

  if (variant === 'drawer') {
    return (
      <div className="member-drawer" aria-label="账号">
        <p className="member-drawer__phone">{member.phoneMasked}</p>
        {items}
        {logoutButton}
      </div>
    )
  }

  return (
    <div className="member-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="member-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="账号菜单"
        title={member.phoneMasked}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="member-menu__avatar" aria-hidden="true">{memberDisplayName(member)}</span>
      </button>
      {open ? (
        <div className="member-menu__panel" role="menu">
          <p className="member-menu__phone">{member.phoneMasked}</p>
          {items}
          {logoutButton}
        </div>
      ) : null}
    </div>
  )
}
