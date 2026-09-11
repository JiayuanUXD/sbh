'use client'

import React from 'react'
import PasswordResetForm from './PasswordResetForm'

export default function ResetClient() {
  return <PasswordResetForm submitLabel="设置密码并登录" onDone={() => { window.location.assign('/account') }} />
}
