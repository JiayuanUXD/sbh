'use client'

import React, { useRef, useState } from 'react'
import { Field, Input, Modal, Textarea } from '@/components/frontend/ui'

/**
 * Modal 触发演示（仅 dev-story 使用）
 *
 * Modal 原语是受控组件，需要外部持有 open 状态与 triggerRef，
 * 此组件包裹一层最小状态机便于在 Story 页内交互验证：
 *   - 焦点锁定、Esc 关闭、焦点归还
 *   - 表单字段与 aria 关联
 */
export default function ModalDemo() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--primary"
        onClick={() => setOpen(true)}
      >
        打开询价弹层
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title="询价 / 预约看房"
        subtitle="仅用于 dev-story 演示，不会真实提交"
      >
        <form className="modal__form" onSubmit={(e) => e.preventDefault()}>
          <Field id="demo-name" label="姓名" required>
            <Input name="name" autoComplete="name" placeholder="请输入姓名…" />
          </Field>
          <Field id="demo-phone" label="手机" required>
            <Input
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="请输入手机号…"
            />
          </Field>
          <Field id="demo-message" label="留言">
            <Textarea name="message" rows={3} placeholder="可选，说明需求…" />
          </Field>
          <div className="modal__footer">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setOpen(false)}
            >
              关闭
            </button>
            <button type="submit" className="btn btn--primary">
              提交
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
