'use client'

import Link from 'next/link'
import React, { useState } from 'react'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import SmsCodeField from './SmsCodeField'
import { memberPost } from './member-api'

type Tab = 'sms' | 'password'

/** /login 的两个 tab（OPT-088 §8.3）。成功后整页跳转 returnTo，让服务端重新渲染登录态。 */
export default function LoginForm({ returnTo }: Readonly<{ returnTo: string }>) {
  const [tab, setTab] = useState<Tab>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const result = tab === 'sms'
      ? await memberPost('/api/member/login/sms', { phone, code, consent: consent ? { accepted: true, policyVersion: PRIVACY_POLICY_VERSION } : null })
      : await memberPost('/api/member/login/password', { phone, password })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    window.location.assign(returnTo)
  }

  return (
    <div className="mb-card">
      <h1 className="mb-title">登录</h1>
      <div className="mb-tabs" role="tablist" aria-label="登录方式">
        <button type="button" role="tab" className="mb-tab" aria-selected={tab === 'sms'} onClick={() => setTab('sms')}>验证码登录</button>
        <button type="button" role="tab" className="mb-tab" aria-selected={tab === 'password'} onClick={() => setTab('password')}>密码登录</button>
      </div>
      <form className="mb-form" onSubmit={submit} noValidate>
        <label className="modal__label" htmlFor="login-phone">
          手机号
          <input id="login-phone" className="modal__input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} required />
        </label>
        {tab === 'sms' ? (
          <>
            <SmsCodeField phone={phone} purpose="login" code={code} onCodeChange={setCode} idPrefix="login" />
            <label className="mb-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>我已阅读并同意<Link href="/pages/privacy" target="_blank" rel="noopener">隐私政策</Link>；首次登录即注册</span>
            </label>
          </>
        ) : (
          <label className="modal__label" htmlFor="login-password">
            密码
            <input id="login-password" className="modal__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={64} required />
          </label>
        )}
        {error ? <p className="modal__error" role="alert" aria-live="polite">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
      </form>
      {tab === 'password' ? <p className="mb-note"><Link href="/login/reset">忘记密码</Link></p> : null}
      <p className="mb-note">员工请从<a href="/admin/login" rel="nofollow">员工入口</a>登录</p>
    </div>
  )
}
