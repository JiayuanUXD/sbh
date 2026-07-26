/**
 * 权限编码注册表（tasks.md M1.2/M1.3, design.md §3.1, §6.1）
 *
 * 业务不变量（AGENTS.md §6 强制规则）：
 *   - 所有可分配的权限编码必须在此注册；不允许 Collection 内散落字符串字面量
 *   - 菜单 / 操作 / 字段三层编码命名空间互不重叠
 *   - 通配符 * 在 PermissionContext 内单独处理，不作为编码注册
 *   - 内置角色 fixture（src/test/factory/roles.ts）必须使用此注册表的编码
 *
 * 三类编码：
 *   1. MENU：菜单可见性（dashboard / listings / leads ...）
 *   2. OPERATION：业务动作权限（listing:review / lead:assign ...）
 *   3. FIELD：字段级权限（phone:full / phone:masked / audit:before_after ...）
 *
 * 命名约定：
 *   - MENU：snake_case 单词或 kebab-case（与 Payload admin 路由一致）
 *   - OPERATION/FIELD：domain:action 格式（小写）
 */

/** 菜单权限编码（控制后台导航可见性） */
export const MENU_CODES = [
  // 工作台
  'dashboard',
  // 业务对象
  'buildings',
  'listings',
  'listing-reviews',
  'leads',
  'customers',
  'follow-ups',
  // 组织与商户
  'merchants',
  'brokers',
  'teams',
  // 地理
  'locations',
  'business-areas',
  // 字典
  'dictionaries',
  // 举报与待办
  'reports',
  'todos',
  // 数据看板
  'analytics',
  // 系统管理
  'users',
  'roles',
  'audit-logs',
  // 个人区
  'my-leads',
  'my-customers',
] as const

export type MenuCode = (typeof MENU_CODES)[number]

/** 操作权限编码（控制业务动作） */
export const OPERATION_CODES = [
  // 房源审核与发布
  'listing:create',
  'listing:update',
  'listing:delete',
  'listing:review', // 提交审核 / 通过 / 驳回
  'listing:publish', // 显式发布
  'listing:unpublish', // 下架
  // 楼盘管理
  'building:create',
  'building:update',
  'building:delete',
  'building:freeze', // 停用
  // 线索与客户
  'lead:create',
  'lead:assign', // 分配
  'lead:transfer', // 转派
  'lead:claim', // 认领
  'lead:reclaim', // 回收（公海回收）
  'lead:follow_up', // 跟进
  'lead:recommend', // 推荐房源
  // 商户
  'merchant:create',
  'merchant:update',
  'merchant:freeze', // 冻结
  'merchant:restore', // 恢复
  // 经纪人
  'broker:manage',
  // 举报
  'report:read', // 读取举报列表 / 详情
  'report:manage', // 编辑 / 删除举报记录
  'report:triage', // 分诊 / 领取
  'report:resolve', // 核实 / 关闭
  // 区域与字典
  'location:manage',
  'dictionary:manage',
  // 系统管理
  'user:manage', // 创建/启停账号
  'role:manage', // 创建/复制/编辑角色
  'audit:view', // 查看审计日志详情
  'audit:export', // 导出审计日志
  // 通用导入导出
  'data:import',
  'data:export',
] as const

export type OperationCode = (typeof OPERATION_CODES)[number]

/** 字段权限编码（控制敏感字段可见性） */
export const FIELD_CODES = [
  // 手机号
  'phone:full', // 看完整手机号
  'phone:masked', // 仅看脱敏值（138****1111）
  // 审计前后值
  'audit:before_after', // 查看 before/after 字段值
  // 楼盘坐标
  'building:coordinate', // 看完整经纬度
  // 设备与 IP
  'client:ip', // 看客户端 IP（举报、登录历史等）
  // 客户扩展信息
  'customer:full_profile',
] as const

export type FieldCode = (typeof FIELD_CODES)[number]

/** 全部权限编码（用于校验内置角色 fixture） */
export const ALL_PERMISSION_CODES: readonly string[] = [
  ...MENU_CODES,
  ...OPERATION_CODES,
  ...FIELD_CODES,
]

/** 是否为已注册的菜单编码 */
export function isRegisteredMenuCode(code: string): boolean {
  return (MENU_CODES as readonly string[]).includes(code)
}

/** 是否为已注册的操作编码 */
export function isRegisteredOperationCode(code: string): boolean {
  return (OPERATION_CODES as readonly string[]).includes(code)
}

/** 是否为已注册的字段编码 */
export function isRegisteredFieldCode(code: string): boolean {
  return (FIELD_CODES as readonly string[]).includes(code)
}

/**
 * 校验权限编码数组：所有非通配符编码必须在注册表中。
 *
 * 用于内置角色 fixture 校验和角色 beforeChange hook 兜底校验，
 * 防止拼写错误导致权限静默失效。
 */
export function validatePermissionCodes(params: {
  codes: unknown
  type: 'menu' | 'operation' | 'field'
}): { ok: true } | { ok: false; invalid: string[] } {
  const { codes, type } = params
  if (!Array.isArray(codes)) return { ok: true }
  const isRegistered =
    type === 'menu'
      ? isRegisteredMenuCode
      : type === 'operation'
        ? isRegisteredOperationCode
        : isRegisteredFieldCode
  const invalid: string[] = []
  for (const c of codes) {
    if (typeof c !== 'string') continue
    if (c === '*') continue // 通配符
    if (!isRegistered(c)) invalid.push(c)
  }
  return invalid.length === 0 ? { ok: true } : { ok: false, invalid }
}
