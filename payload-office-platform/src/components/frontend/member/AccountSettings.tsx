'use client'

import React, { useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import PasswordResetForm from './PasswordResetForm'
import { memberPost } from './member-api'
import { useMember } from './MemberProvider'

export default function AccountSettings({ member: initialMember }: Readonly<{ member: MemberDto }>) {
  const { logout, setMember } = useMember()
  const [nickname, setNickname] = useState(initialMember.nickname ?? '')
  const [nickMsg, setNickMsg] = useState<string | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwDone, setPwDone] = useState(false)

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

  return (
    <div className="mb-card">
      <h1 className="mb-title">账号设置</h1>
      <p className="mb-item__meta">手机号 {initialMember.phoneMasked}</p>
      <form className="mb-form" onSubmit={saveNickname} noValidate>
        <label className="modal__label" htmlFor="acct-nickname">
          昵称
          <input id="acct-nickname" className="modal__input" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} />
        </label>
        {nickMsg ? <p className="mb-item__meta" role="status" aria-live="polite">{nickMsg}</p> : null}
        <button type="submit" className="btn btn--ghost">保存昵称</button>
      </form>
      <hr />
      <h2 className="mb-title">{initialMember.hasPassword ? '修改密码' : '设置密码'}</h2>
      {pwDone ? <p className="mb-item__meta" role="status">密码已更新，其它设备已下线</p> : null}
      {pwOpen ? (
        <PasswordResetForm submitLabel={initialMember.hasPassword ? '修改密码' : '设置密码'} onDone={() => { setPwOpen(false); setPwDone(true) }} />
      ) : (
        <button type="button" className="btn btn--ghost" onClick={() => setPwOpen(true)}>{initialMember.hasPassword ? '修改密码' : '设置密码'}</button>
      )}
      <hr />
      <button type="button" className="btn btn--ghost btn--block" onClick={() => { void logout() }}>退出登录</button>
    </div>
  )
}
