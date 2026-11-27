'use client'

import React, { useRef, useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import { memberDisplayName } from './MemberMenu'
import PasswordResetForm from './PasswordResetForm'
import { memberPost, memberUpload } from './member-api'
import { useMember } from './MemberProvider'

export default function AccountSettings({ member: initialMember }: Readonly<{ member: MemberDto }>) {
  const { logout, member: contextMember, setMember } = useMember()
  const member = contextMember ?? initialMember
  const [nickname, setNickname] = useState(member.nickname ?? '')
  const [nickMsg, setNickMsg] = useState<string | null>(null)
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [erroredUrl, setErroredUrl] = useState<string | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwDone, setPwDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setAvatarMsg(null)
    setAvatarBusy(true)
    const formData = new FormData()
    formData.append('file', file)
    const result = await memberUpload<{ member: MemberDto }>('/api/member/avatar', formData)
    setAvatarBusy(false)
    if (result.ok) {
      setMember(result.data.member)
      setErroredUrl(null)
      setAvatarMsg('头像已更新')
    } else {
      setAvatarMsg(result.message)
    }
  }

  const handleClearAvatar = async () => {
    setAvatarMsg(null)
    setAvatarBusy(true)
    const result = await memberPost<{ member: MemberDto }>('/api/member/avatar', {}, 'DELETE')
    setAvatarBusy(false)
    if (result.ok) {
      setMember(result.data.member)
      setErroredUrl(null)
      setAvatarMsg('已恢复默认头像')
    } else {
      setAvatarMsg(result.message)
    }
  }

  const saveNickname = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await memberPost<{ member: MemberDto }>('/api/member/profile', { nickname }, 'PATCH')
    if (result.ok) {
      setMember(result.data.member)
      setNickMsg('已保存')
    } else {
      setNickMsg(result.message)
    }
  }

  const showImage = Boolean(member.avatarUrl) && erroredUrl !== member.avatarUrl

  return (
    <div className="mb-card">
      <h1 className="mb-title">账号设置</h1>
      <p className="mb-item__meta">手机号 {member.phoneMasked}</p>

      <div className="mb-avatar">
        <div className="mb-avatar__preview" aria-hidden="true">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- 会员头像直接渲染上传后的媒体 URL
            <img
              src={member.avatarUrl ?? ''}
              alt=""
              className="mb-avatar__img"
              onError={() => setErroredUrl(member.avatarUrl)}
            />
          ) : (
            <span className="mb-avatar__fallback">{memberDisplayName(member)}</span>
          )}
        </div>
        <div className="mb-avatar__controls">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="mb-avatar__input"
            aria-label="选择头像图片"
            disabled={avatarBusy}
            onChange={(e) => { void handleAvatarChange(e) }}
          />
          <div className="mb-avatar__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={avatarBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarBusy ? '上传中...' : member.avatarUrl ? '更换头像' : '上传头像'}
            </button>
            {member.avatarUrl ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={avatarBusy}
                onClick={() => { void handleClearAvatar() }}
              >
                恢复默认
              </button>
            ) : null}
          </div>
          <p className="mb-item__meta mb-avatar__hint">支持 JPG / PNG / WebP / GIF，大小不超过 2MB</p>
          {avatarMsg ? <p className="mb-item__meta" role="status" aria-live="polite">{avatarMsg}</p> : null}
        </div>
      </div>

      <form className="mb-form" onSubmit={saveNickname} noValidate>
        <label className="modal__label" htmlFor="acct-nickname">
          昵称
          <input id="acct-nickname" className="modal__input" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} />
        </label>
        {nickMsg ? <p className="mb-item__meta" role="status" aria-live="polite">{nickMsg}</p> : null}
        <button type="submit" className="btn btn--ghost">保存昵称</button>
      </form>
      <hr />
      <h2 className="mb-title">{member.hasPassword ? '修改密码' : '设置密码'}</h2>
      {pwDone ? <p className="mb-item__meta" role="status">密码已更新，其它设备已下线</p> : null}
      {pwOpen ? (
        <PasswordResetForm submitLabel={member.hasPassword ? '修改密码' : '设置密码'} onDone={() => { setPwOpen(false); setPwDone(true) }} />
      ) : (
        <button type="button" className="btn btn--ghost" onClick={() => setPwOpen(true)}>{member.hasPassword ? '修改密码' : '设置密码'}</button>
      )}
      <hr />
      <button type="button" className="btn btn--ghost btn--block" onClick={() => { void logout() }}>退出登录</button>
    </div>
  )
}
