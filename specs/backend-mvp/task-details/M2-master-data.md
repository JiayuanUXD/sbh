# 后台任务：M2 地理、商户与组织主数据

> 返回：[任务索引](../tasks.md)

## M2 地理、商户与组织主数据

- [x] 2.1 扩展统一地理节点
  - 为 Locations 增加不可变编码、启停、前台可见、中心坐标、版本号。
  - 支持城市、行政区、商圈、地铁线路和地铁站固定层级。
  - 迁移现有区域数据并生成不可变编码。
  - _Requirement: R2_

- [x] 2.2 建设城市区域 Custom View
  - 树形浏览、合法新增、移动、排序、启停和引用数量。
  - 上级停用、跨城市移动、代码重复和被引用节点保护。
  - _Requirement: R2_

- [x] 2.3 建设商圈扩展
  - 创建 `business_area_extensions`。
  - 支持边界、扩展中心、别名和同城站点关系。
  - 基础商圈字段只读同步，禁止在扩展页修改。
  - _Requirement: R2_

- [x] 2.4 创建商户模型
  - 创建商户类型、联系人、服务城市、状态、资质状态和有效期字段。
  - 实现服务城市和资质有效性校验。
  - 完成商户列表、详情、启停影响确认。
  - _Requirement: R2_

- [x] 2.5 创建团队和经纪人模型
  - 创建 Teams 与 Brokers。
  - 关联用户、主管、服务城市和服务商圈。
  - 停用前检查未完成线索并要求转派。
  - _Requirement: R1, R2, R6_

- [x] 2.6 创建固定与可维护字典
  - 核心状态、商户类型和强类型字段作为只读发布基线。
  - 展示型标签支持新增、改名、排序、可见性和停用。
  - 业务对象保存编码和历史显示快照。
  - _Requirement: R2_
  - 验证证据：
    - 只读枚举注册表: `payload-office-platform/src/domain/dictionary/enum-registry.ts`（10 个真源字典: merchant.type/status/qualification_status / team.status / employment.status / location.type / building.operational_status/type/verification_status/registration_capability；entries 由真源数组 .map 生成,新增值漏更新即测试转红）
    - 可维护展示标签: `payload-office-platform/src/collections/DisplayTags.ts`（code 创建后不可改 + name 可改 + sortOrder + visible + status + version 乐观锁；protectDisplayTag 守卫）
    - 标签纯函数: `payload-office-platform/src/domain/dictionary/display-tag.ts`（normalizeTagCode 格式校验 + snapshotTag 历史快照冻结 code+label）
    - 对外 endpoint: `payload-office-platform/src/endpoints/dictionaries-endpoint.ts`（GET /api/dictionaries 列出全部 + ?code=xxx 单查 + ?includeDisplayTags=true 附带可见展示标签；门禁: 已登录可读只读字典,展示标签按数据权限脱敏）
    - 测试: `payload-office-platform/tests/dictionary-enum-registry.test.ts`（注册表完整性 + 真源一致性 + 标签纯函数）/ `payload-office-platform/tests/display-tag-protect.test.ts`（protect hook）/ `payload-office-platform/tests/dictionaries-endpoint.test.ts`（endpoint 6 用例 + 与 enum-registry 一致性验证）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 全通过

### M2 验收门

- 停用区域不再出现在新增业务候选中，历史对象仍可展示。
- 商户资质过期或服务城市不匹配时不能建立新供给关系。
- 停用经纪人前必须完成有效线索转派。
