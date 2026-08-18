'use client'

import React, { useEffect } from 'react'
import { Modal } from '@arco-design/web-react'

import { consumeNavigationAllowance, getAdminFormModified } from './form-modified-store'

/**
 * 后台「未保存改动」站内跳转守卫（OPT-030 P0-2）
 *
 * 走查发现：Payload 编辑视图注册了 beforeunload，但后台绝大多数跳转是站内
 * <a>（导航 / 面包屑 / 列表链接），不触发 beforeunload，改动静默丢失。
 *
 * App Router 没有 shippable 的路由拦截事件，这里用 document 捕获阶段的
 * click 监听拦截站内 <a> 跳转：表单有未保存改动时 preventDefault，弹
 * Arco Modal.confirm；用户选「离开」后放行一次并整页跳转（location.assign，
 * 顺带把整棵 React 树和 store 一起重置，不留脏态）。浏览器刷新 / 关闭 /
 * 后退仍由 Payload 自带的 beforeunload 兜底。
 *
 * 注册于 payload.config 的 admin.components.providers，全后台生效。
 */
export default function UnsavedChangesGuardProvider({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // 只拦左键单击的普通跳转；中键/修饰键交给浏览器原生行为。
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return

      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      let url: URL | null = null
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      // 只管本站跳转；纯锚点（#xxx）与 mailto/tel 不算离开。
      if (url.origin !== window.location.origin) return
      if (url.protocol === 'mailto:' || url.protocol === 'tel:') return
      if (url.pathname === window.location.pathname && url.hash) return

      if (!getAdminFormModified()) return
      if (consumeNavigationAllowance()) return

      event.preventDefault()
      // 同为 document 捕获监听且本 provider 注册在编辑视图之前，用
      // stopImmediatePropagation 压掉 Payload 内置 LeaveWithoutSaving 的
      // 同型监听，避免同一跳转弹出两个确认框。
      event.stopImmediatePropagation()

      const target = url.href
      Modal.confirm({
        title: '有未保存的更改',
        content:
          '当前表单的改动尚未保存，离开页面将丢失这些更改。确认要离开吗？建议先回到页面底部点击「保存」。',
        okText: '直接离开',
        cancelText: '留下继续编辑',
        okButtonProps: { status: 'warning' },
        onOk: () => {
          // 整页跳转：React 树与模块 store 一并重置，无需手动清理脏态。
          window.location.assign(target)
        },
      })
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return <>{children}</>
}
