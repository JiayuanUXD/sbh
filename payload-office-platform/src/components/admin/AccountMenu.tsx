'use client'

import { Account, useAuth, useConfig } from '@payloadcms/ui'
import { IconExport, IconSettings } from '@arco-design/web-react/icon'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useRef, useState } from 'react'

type AvatarRef =
  | number
  | string
  | { id?: number | string; url?: string; sizes?: { thumb?: { url?: string } } }
  | null
  | undefined

function inlineAvatarUrl(avatar: AvatarRef): string | null {
  if (!avatar || typeof avatar !== 'object') return null
  const thumb = avatar.sizes?.thumb?.url
  if (typeof thumb === 'string' && thumb.length > 0) return thumb
  if (typeof avatar.url === 'string' && avatar.url.length > 0) return avatar.url
  return null
}

function avatarId(avatar: AvatarRef): number | string | null {
  if (typeof avatar === 'number' || typeof avatar === 'string') return avatar
  if (avatar && typeof avatar === 'object' && (typeof avatar.id === 'number' || typeof avatar.id === 'string')) {
    return avatar.id
  }
  return null
}

/**
 * 右上角账号下拉菜单：将 Payload 默认的左下角"退出"按钮和右上角
 * 账号头像链接合并为一个头像下拉菜单（账号设置 + 退出登录）。
 *
 * 优先展示用户自定义上传的头像（Users.avatar），未设置或加载失败时
 * 回退 Payload 内置的 GravatarAccountIcon / 首字母头像。
 */
export default function AccountMenu() {
  const { config } = useConfig()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const rawAvatar = (user as { avatar?: AvatarRef } | null | undefined)?.avatar
  const resolvedInline = inlineAvatarUrl(rawAvatar)
  const rawAvatarId = avatarId(rawAvatar)
  const rawAvatarIdKey = rawAvatarId !== null ? String(rawAvatarId) : null
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null)
  const [erroredUrl, setErroredUrl] = useState<string | null>(null)

  useEffect(() => {
    if (resolvedInline || !rawAvatarIdKey) return
    const controller = new AbortController()
    fetch(`/api/media/${encodeURIComponent(rawAvatarIdKey)}?depth=0`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((doc: { url?: string; sizes?: { thumb?: { url?: string } } } | null) => {
        if (controller.signal.aborted) return
        setFetched({
          id: rawAvatarIdKey,
          url: doc ? doc.sizes?.thumb?.url || doc.url || null : null,
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ id: rawAvatarIdKey, url: null })
      })
    return () => {
      controller.abort()
    }
  }, [rawAvatarIdKey, resolvedInline])

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
  const fetchedUrl =
    rawAvatarIdKey && fetched?.id === rawAvatarIdKey ? fetched.url : null
  const candidateUrl = resolvedInline ?? fetchedUrl
  const avatarUrl = candidateUrl && erroredUrl !== candidateUrl ? candidateUrl : null

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
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 后台顶栏头像直接渲染媒体缩略图
          <img
            alt=""
            className="arco-admin-account__img"
            onError={() => setErroredUrl(avatarUrl)}
            src={avatarUrl}
          />
        ) : email ? (
          <Account />
        ) : (
          <span className="arco-admin-account__avatar">{initial}</span>
        )}
      </button>
      {open && (
        <div className="arco-admin-account__menu" role="menu">
          <div className="arco-admin-account__header">
            <div className="arco-admin-account__header-row">
              <span className="arco-admin-account__header-avatar" aria-hidden="true">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 菜单头部头像预览
                  <img
                    alt=""
                    className="arco-admin-account__img"
                    onError={() => setErroredUrl(avatarUrl)}
                    src={avatarUrl}
                  />
                ) : (
                  initial
                )}
              </span>
              <div className="arco-admin-account__header-meta">
                <div className="arco-admin-account__name">
                  {name || '未命名用户'}
                </div>
                {email ? (
                  <div className="arco-admin-account__email">{email}</div>
                ) : null}
              </div>
            </div>
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
