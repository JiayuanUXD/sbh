'use client'

import React, { useEffect } from 'react'
import { useFormModified } from '@payloadcms/ui'

import { setAdminFormModified } from './form-modified-store'

/**
 * 表单修改态桥（OPT-030 P0-2）
 *
 * 必须渲染在 Payload 编辑表单的 context 内（beforeDocumentControls 或
 * type: 'ui' 字段均可），把 useFormModified 同步给根部的
 * UnsavedChangesGuardProvider。纯副作用组件，不渲染任何 DOM。
 */
export default function FormModifiedBridge() {
  const modified = useFormModified()

  useEffect(() => {
    setAdminFormModified(modified)
  }, [modified])

  // 卸载时必须清脏态，否则保存成功 / 离开编辑视图后守卫仍误拦。
  useEffect(
    () => () => {
      setAdminFormModified(false)
    },
    [],
  )

  return null
}
