/**
 * 可维护展示标签纯函数（tasks.md M2.6 Part B / Requirement R2）
 *
 * 与只读枚举基线（enum-registry.ts）正交：展示标签支持后台新增/改名/
 * 排序/可见性/停用。业务对象引用标签时保存**编码 + 历史显示快照**，
 * 改名不影响历史记录展示（快照冻结当时的 code + name）。
 *
 * 无 payload / React 依赖，可独立单测。需要读库的校验（禁改 code、
 * 版本乐观锁）在 display-tag-protect.ts。
 */
import { InvalidOperationError } from '../shared/errors'

/** 展示标签启停状态（沿用领域枚举单源范式）。 */
export const DISPLAY_TAG_STATUSES = ['active', 'disabled'] as const
export type DisplayTagStatus = (typeof DISPLAY_TAG_STATUSES)[number]

export const DISPLAY_TAG_STATUS_LABELS: Record<DisplayTagStatus, string> = {
  active: '启用',
  disabled: '停用',
}

export function isDisplayTagStatus(value: unknown): value is DisplayTagStatus {
  return typeof value === 'string' && (DISPLAY_TAG_STATUSES as readonly string[]).includes(value)
}

/**
 * 标签编码格式：字母开头，允许大小写字母 / 数字 / 下划线 / 连字符，2–64 位。
 * 展示标签由业务人员维护，比区域编码略宽（允许小写），但仍需稳定可引用。
 */
const TAG_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/

/**
 * 规范化并校验标签编码：去首尾空白后按格式校验，非法抛 InvalidOperationError。
 * 返回规范化后的 code（当前仅 trim，不改大小写以保留业务原意）。
 */
export function normalizeTagCode(code: unknown): string {
  if (typeof code !== 'string') {
    throw new InvalidOperationError({
      domain: 'dictionary',
      code: 'INVALID_TAG_CODE',
      message: '标签编码必须为字符串',
      details: { code },
    })
  }
  const trimmed = code.trim()
  if (!TAG_CODE_PATTERN.test(trimmed)) {
    throw new InvalidOperationError({
      domain: 'dictionary',
      code: 'INVALID_TAG_CODE',
      message: '标签编码需以字母开头，仅含字母/数字/下划线/连字符，长度 2–64',
      details: { code: trimmed },
    })
  }
  return trimmed
}

/** 业务对象引用标签时的历史显示快照。 */
export interface DisplayTagSnapshot {
  code: string
  label: string
}

/**
 * 冻结标签的当时 code + 显示名，供业务对象写入。
 * 后续标签改名不回写已保存快照，历史记录展示保持不变。
 */
export function snapshotTag(tag: { code: string; name: string }): DisplayTagSnapshot {
  return { code: tag.code, label: tag.name }
}
