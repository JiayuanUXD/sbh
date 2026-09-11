'use client'

import React, { useState } from 'react'
import SmsCodeField from './SmsCodeField'
import { memberPost } from './member-api'

/** 设置 / 找回密码（OPT-088 §6.4）。initialPhone 给已登录的账户中心用；未登录时用户自填。 */
export default function PasswordResetForm({ initialPhone, phoneLocked, onDone, submitLabel }: Readonly<{
  initialPhone?: string
  phoneLocked?: boolean
  onDone: () => void
  submitLabel: string
}>) {
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(newPassword)) { setError('密码需 8 到 64 位，且同时包含字母和数字'); return }
    setBusy(true)
    const result = await memberPost('/api/member/password', { phone, code, newPassword })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    onDone()
  }

  return (
    <form className="mb-form" onSubmit={submit} noValidate>
      <label className="modal__label" htmlFor="reset-phone">
        手机号
        <input id="reset-phone" className="modal__input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} readOnly={phoneLocked} required />
      </label>
      <SmsCodeField phone={phone} purpose="set-password" code={code} onCodeChange={setCode} idPrefix="reset" />
      <label className="modal__label" htmlFor="reset-password">
        新密码
        <input id="reset-password" className="modal__input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" maxLength={64} required />
      </label>
      {error ? <p className="modal__error" role="alert" aria-live="polite">{error}</p> : null}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? '提交中…' : submitLabel}</button>
    </form>
  )
}
