'use client'

/**
 * 后台「未保存改动」全局状态桥（OPT-030 P0-2）
 *
 * Payload 编辑表单的修改态（useFormModified）活在表单 React context 内，
 * 而路由守卫必须挂在 admin 根部（payload.config 的 providers），两者隔着
 * 组件树。这里用一个模块级极简 store 做单向桥：
 *
 *   FormModifiedBridge（表单内，读 useFormModified）-> setAdminFormModified
 *   UnsavedChangesGuardProvider（根部，拦截站内 <a> 跳转）<- getAdminFormModified
 *
 * 走模块单例而非 React context，是因为守卫在 document 捕获阶段的事件回调里
 * 读值，context 读不到。
 */

let adminFormModified = false

/** 跳过一次守卫（用户已在确认弹窗里选择离开）。 */
let skipNextGuard = false

export function setAdminFormModified(modified: boolean): void {
  adminFormModified = modified
}

export function getAdminFormModified(): boolean {
  return adminFormModified
}

/** 允许下一次站内跳转放行（确认弹窗点「离开」后、真正执行跳转前调用）。 */
export function allowNextNavigation(): void {
  skipNextGuard = true
}

export function consumeNavigationAllowance(): boolean {
  if (!skipNextGuard) return false
  skipNextGuard = false
  return true
}
