'use client'

import React, { useEffect, useState } from 'react'
import { memberPost } from './member-api'

/** 验证码输入 + 60 秒倒计时发送按钮。发送恒返回 200，不据此判断号码是否已注册。 */
export default function SmsCodeField({ phone, purpose, code, onCodeChange, idPrefix }: Readonly<{
  phone: string
  purpose: 'login' | 'set-password' | 'bind-wechat'
  code: string
  onCodeChange: (v: string) => void
  idPrefix: string
}>) {
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (seconds <= 0) return
    const t = window.setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [seconds])

  const send = async () => {
    setError(null)
    const result = await memberPost('/api/member/sms/send', { phone, purpose })
    if (!result.ok) { setError(result.message); return }
    setSeconds(60)
  }

  const phoneReady = /^1[3-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''))

  return (
    <div className="mb-row">
      <label className="modal__label" htmlFor={`${idPrefix}-code`}>
        验证码
        <input id={`${idPrefix}-code`} className="modal__input" value={code} onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      </label>
      <button type="button" className="btn btn--ghost" onClick={send} disabled={!phoneReady || seconds > 0}>
        {seconds > 0 ? `${seconds} 秒后重发` : '获取验证码'}
      </button>
      {error ? <p className="modal__error" role="alert">{error}</p> : null}
    </div>
  )
}
