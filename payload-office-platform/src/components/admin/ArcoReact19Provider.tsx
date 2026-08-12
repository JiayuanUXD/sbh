'use client'

import { setCreateRoot } from '@arco-design/web-react/es/_util/react-dom'
import { createRoot } from 'react-dom/client'

/**
 * Arco Design × React 19 兼容补丁（provider）
 *
 * Arco 的 portal 组件（Message / Modal / Tooltip 等）走 `_util/react-dom` 的
 * `render`，其内部 `setCopyRender` 从 `react-dom` 顶层读 `createRoot`。React 19
 * 已把 `createRoot` 移到 `react-dom/client`，并从顶层移除 `ReactDOM.render`，于是
 * `createRoot` 读到 undefined → 回退到 `ReactDOM.render`（不存在）→ 抛
 * `CopyReactDOM.render is not a function`，Message 等 toast 静默不渲染。
 *
 * Arco 预留了 `setCreateRoot` 补丁入口：从 `react-dom/client` 取 `createRoot`
 * 注入即可。须在任意 Arco portal 组件渲染前执行，故在 provider 模块顶层调用
 * （`render` 调用时读 `copyRender`，晚于此处赋值，与 import 顺序无关）。
 */
setCreateRoot(createRoot)

export default function ArcoReact19Provider({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}