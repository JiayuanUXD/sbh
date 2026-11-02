/**
 * 运营维护的搜索别名：录入规则。
 *
 * 别名只影响「词项 → 实体」的解析（见 expand / segment / typo / suggestions）。规则挡的是
 * 会把检索搞坏的录入：单字别名会命中一大片；与规范名相同没有意义；纯标点 / 空白归一化后为空。
 * 返回值是可直接展示给运营的中文原因，通过则为 `true`（与 Payload 字段 `validate` 同形）。
 */

import { nameKey } from './vocabulary'

export const ALIAS_MIN_LENGTH = 2
export const ALIAS_MAX_LENGTH = 40

export function validateSearchAlias(canonicalName: string, alias: string): true | string {
  const key = nameKey(alias ?? '')
  // 至少要有一个字母 / 数字 / 汉字：nameKey 只去空白不去标点，「——」不能算别名
  if (!/[\p{L}\p{N}]/u.test(key)) return '别名不能为空，也不能只有标点'
  const length = Array.from(key).length
  if (length < ALIAS_MIN_LENGTH) return `别名至少 ${ALIAS_MIN_LENGTH} 个字，单字会命中一大片结果`
  if (length > ALIAS_MAX_LENGTH) return `别名最多 ${ALIAS_MAX_LENGTH} 个字，应当是简称或口语写法，不是句子`
  if (key === nameKey(canonicalName ?? '')) return '别名与规范名称相同，没有意义'
  return true
}
