'use client'
import React, { useState } from 'react'

type Props = { listingTitle: string }

export default function InquiryModal({ listingTitle }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'ok' | 'error'>('idle')
  const [errors, setErrors] = useState<string[]>([])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrors([])
    const slug = window.location.pathname.split('/').filter(Boolean).pop() || ''
    const res = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, message, listingSlug: slug }),
    })
    if (res.ok) {
      setStatus('ok')
      setName('')
      setPhone('')
      setMessage('')
    } else {
      const data = await res.json().catch(() => ({}))
      setStatus('error')
      setErrors(Array.isArray(data.errors) ? data.errors : ['server_error'])
    }
  }

  return (
    <>
      <button className="btn btn--primary" onClick={() => setOpen(true)}>
        在线询价 / 留电
      </button>
      {open && (
        <div className="modal__overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal__close" onClick={() => setOpen(false)} type="button">
              ×
            </button>
            <h3 className="modal__title">询价 / 预约看房</h3>
            <p className="modal__subtitle">{listingTitle}</p>
            {status === 'ok' ? (
              <div className="modal__success">
                <p>已收到，顾问将在 1 工作日内联系你。</p>
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setOpen(false)
                    setStatus('idle')
                  }}
                >
                  关闭
                </button>
              </div>
            ) : (
              <form className="modal__form" onSubmit={submit}>
                <label className="modal__label">
                  姓名
                  <input
                    className="filter-bar__input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <label className="modal__label">
                  手机
                  <input
                    className="filter-bar__input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    inputMode="tel"
                  />
                </label>
                <label className="modal__label">
                  留言
                  <textarea
                    className="filter-bar__input"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                  />
                </label>
                {errors.length > 0 && <p className="modal__error">请检查：{errors.join('、')}</p>}
                <button type="submit" className="btn btn--primary" disabled={status === 'submitting'}>
                  {status === 'submitting' ? '提交中…' : '提交'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
