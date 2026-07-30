'use client'

import { Account, useAuth, useConfig } from '@payloadcms/ui'
import { IconExport, IconSettings } from '@arco-design/web-react/icon'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useRef, useState } from 'react'

/**
 * 右上角账号下拉菜单：将 Payload 默认的左下角"退出"按钮和右上角
 * 账号头像链接合并为一个头像下拉菜单（账号设置 + 退出登录）。
 *
 * 头像复用 Payload 内置的 GravatarAccountIcon（与默认头像一致）。
 * 配合 custom.scss 中隐藏 `.nav__controls` 与 `.app-header__account` 使用。
 */
export default function AccountMenu() {
  const { config } = useConfig()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const adminRoute = config.routes.admin
  const accountHref = `${adminRoute}/account`
  const logoutHref = formatAdminURL({
    adminRoute,
    path: config.admin.routes.logout,
  })

  const name =
    typeof user?.name === 'string' && user.name.trim()
      ? user.name.trim()
      : null
  const email = user?.email
  const initial = (name || email || '?').charAt(0).toUpperCase()

  return (
    <div className="arco-admin-account" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="账号菜单"
        className="arco-admin-account__trigger"
        onClick={() => setOpen((value) => !value)}
        title={name || email || '账号'}
        type="button"
      >
        {email ? (
          <Account />
        ) : (
          <span className="arco-admin-account__avatar">{initial}</span>
        )}
      </button>
      {open && (
        <div className="arco-admin-account__menu" role="menu">
          <div className="arco-admin-account__header">
            <div className="arco-admin-account__name">
              {name || '未命名用户'}
            </div>
            {email ? (
              <div className="arco-admin-account__email">{email}</div>
            ) : null}
          </div>
          <a
            className="arco-admin-account__item"
            href={accountHref}
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <IconSettings aria-hidden />
            <span>账号设置</span>
          </a>
          <a
            className="arco-admin-account__item arco-admin-account__item--danger"
            href={logoutHref}
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <IconExport aria-hidden />
            <span>退出登录</span>
          </a>
        </div>
      )}
    </div>
  )
}
