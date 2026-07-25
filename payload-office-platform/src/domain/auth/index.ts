/**
 * 领域：身份、角色和权限上下文（domain/auth）
 *
 * 职责边界（AGENTS.md §4, §6）：
 *   - 内置角色定义：ADM / OPS / MGR / BRK / CSR（不可改码、不可删除）
 *   - 自定义角色注册：菜单 / 操作 / 数据 / 字段四层权限
 *   - PermissionContext：登录用户 + 角色 + 城市范围 + 团队范围 → 统一守卫
 *   - 字段脱敏：手机号 / IP / 坐标 / 审计前后值
 *   - 会话版本：账号停用 → 旧会话失效
 *   - 最后一个全局管理员保护
 *
 * 模块导出：
 *   - permission-codes：菜单 / 操作 / 字段权限编码注册表
 *   - permission-context：PermissionContext 派生与四层权限检查工具
 *   - access：Payload access 工厂、requireAdminContext 等统一守卫
 *   - field-mask：字段脱敏规则与工具
 *   - field-hooks：Payload Collection afterRead 脱敏 hook 工厂
 *   - user-protect：最后一个全局管理员保护 hook
 *   - org：团队 / 经纪人在职状态枚举与守卫
 *   - team-protect：团队保护 hook（城市范围 + 版本锁）
 *   - broker-protect：经纪人保护 hook（user 唯一 / 城市 / 商圈 / 团队 / 版本锁）
 *   - broker-references：经纪人未完成线索计数
 *   - broker-stop-guard：经纪人停用守卫（未完成线索须先转派）
 */
export const DOMAIN_TAG = 'auth' as const

export * from './permission-codes'
export * from './permission-context'
export * from './access'
export * from './field-mask'
export * from './field-hooks'
export * from './user-protect'
export * from './org'
export * from './team-protect'
export * from './broker-protect'
export * from './broker-references'
export * from './broker-stop-guard'
