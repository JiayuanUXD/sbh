# 后台任务：M1 账号、角色与四层权限

> 返回：[任务索引](../tasks.md)

## M1 账号、角色与四层权限

- [x] 1.1 扩展用户账号模型
  - 增加姓名、规范化手机号、登录账号、状态、城市范围、团队和会话版本。
  - 实现手机号及登录账号唯一校验。
  - 迁移现有管理员账号并保留登录能力。
  - _Requirement: R1_

- [x] 1.2 创建角色和权限注册表
  - 创建 `roles` Collection。
  - 初始化且仅初始化 `ADM / OPS / MGR / BRK / CSR` 五个内置角色。
  - 注册菜单、操作、数据和字段权限编码。
  - 阻止内置角色删除、改码或改变内置身份。
  - _Requirement: R1_

- [x] 1.3 实现服务端权限上下文
  - 从登录用户、角色、城市和团队生成 `PermissionContext`。
  - 实现允许并集和账号城市最终上限。
  - 为 Payload access hooks 和自定义 endpoints 提供统一守卫。
  - _Requirement: R1_

- [x] 1.4 实现字段脱敏和导出权限
  - 手机号默认返回脱敏值。
  - 完整手机号、坐标、审计前后值和敏感导出使用独立字段权限。
  - 禁止仅靠前端隐藏保护敏感字段。
  - _Requirement: R1, R8_

- [x] 1.5 完成账号与角色后台页面
  - 账号列表、创建、编辑、启停、角色绑定和权限预览。
  - 角色列表、复制、自定义角色编辑和风险提示。
  - 最后一个全局管理员保护。
  - _Requirement: R1_

- [x] 1.6 完成权限 E2E
  - 五类角色分别验证菜单、数据范围、按钮、直接 API 和字段脱敏。
  - 验证 URL 参数不能扩大城市或团队范围。
  - _Requirement: R1_

### M1 验收门

- ✅ 停用账号无法登录且旧会话失效（`status='disabled'` → `buildPermissionContext` 返回 null；sessionVersion 递增机制已在 Users.beforeChange 落地）。
- ✅ 五个内置角色基线准确（`tests/permission-matrix.test.ts` 36 项断言覆盖菜单 / 操作 / 字段 / 数据范围）。
- ✅ 经纪人不能读取其他经纪人的线索或完整手机号（BRK `dataScope=self` + 城市上限；缺 `phone:full` 时 `maskDocFields` 返回 `138****5678`）。
- ✅ 越权接口返回 403，不产生业务写入（`requireOperationPermission` 抛 `ForbiddenError`；Playwright spec 验证 POST /api/users 在 CSR/BRK 角色下被拒绝）。
- ✅ 全量 TypeScript 通过（`pnpm typecheck`）。
- ✅ 单元测试 333 项通过（M0 101 + M1 新增 232，`pnpm test`）。
- ✅ 生产构建通过（`pnpm build`）。
- ✅ 迁移 dry-run 不写入数据（`pnpm migrate:dry-run`）。
