'use client'

/**
 * 访客身份关联（OPT-067）
 *
 * 咨询提交**成功之后**，把服务端返回的 `visitorRef` 告诉 Umami
 * （`umami.identify`），使这条线索能关联到该访客提交前的匿名浏览路径。
 *
 * ## 一条不能违反的时序约束（spec D5）
 *
 * **提交成功之前的任何时点都不得调用 identify。** 匿名浏览阶段一旦 identify，
 * 就等于在用户还没同意留资时把他的浏览行为挂到一个持久身份上——那是
 * 「先关联、后征得同意」，与隐私声明相悖。
 *
 * 这个约束靠三层守：本模块只导出 `identifyAfterSubmitSuccess`（名字即契约）、
 * 调用点只在 InquiryModal 的成功分支、E2E 断言匿名浏览全程无 identify 调用。
 *
 * ## 为什么要存 sessionStorage
 *
 * 同一会话提交第二条线索时要把首个 ID 回传给服务端复用。不复用的话，
 * `umami.identify` 的会话级后写覆盖会让第一条线索的深链失效——
 * 服务端的 `idempotencyKey` 含 targetSlug，咨询两套房源必然派生出两个不同值。
 */

import { isVisitorRef } from '@/domain/inquiry/visitor-ref-shape'

/** sessionStorage 键名。用 sessionStorage 而非 localStorage：跨会话不保留身份。 */
export const VISITOR_REF_STORAGE_KEY = 'sbh.visitorRef'

type UmamiIdentify = { identify?: (id: string) => void }

function readUmami(): UmamiIdentify | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { umami?: unknown }).umami
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as UmamiIdentify)
    : null
}

/**
 * 读回本会话已有的 visitorRef。
 *
 * 读出来的值**同样要校验**——sessionStorage 是用户可改的，
 * 塞一个畸形值进来不该让请求体带上垃圾（服务端会拒，但没必要发出去）。
 *
 * 任何异常都返回 null：隐私模式、存储被禁用、配额满，都不该让咨询流程出错。
 */
export function readStoredVisitorRef(): string | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)
    return isVisitorRef(raw) ? raw : null
  } catch {
    return null
  }
}

/**
 * 记住本会话的 visitorRef，供后续提交回传。
 *
 * 非法值直接不写——宁可下次重新派生，也不让一个坏值一直传下去。
 */
export function rememberVisitorRef(ref: unknown): void {
  try {
    if (typeof window === 'undefined' || !isVisitorRef(ref)) return
    window.sessionStorage.setItem(VISITOR_REF_STORAGE_KEY, ref)
  } catch {
    // 存不进去只是下次要重新派生，不影响本次提交
  }
}

/**
 * 提交成功后关联身份。
 *
 * 名字里的 `AfterSubmitSuccess` 是契约的一部分：本模块**不导出**任何可以在
 * 提交前调用的 identify 入口，让「误用」需要先绕过命名才做得到。
 *
 * Umami 未加载（未接入统计 / 脚本被拦截）时静默跳过——关联不上只是少一份
 * 分析数据，绝不能影响用户已经成功的咨询提交。
 */
export function identifyAfterSubmitSuccess(ref: unknown): void {
  if (!isVisitorRef(ref)) return
  rememberVisitorRef(ref)
  try {
    const umami = readUmami()
    umami?.identify?.(ref)
  } catch {
    // 同上：分析侧的任何问题都不该冒泡到咨询流程
  }
}
