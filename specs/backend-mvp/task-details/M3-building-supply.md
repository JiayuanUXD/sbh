# 后台任务：M3 楼盘增强与供给关系

> 返回：[任务索引](../tasks.md)

## M3 楼盘增强与供给关系

- [x] 3.1 扩展楼盘字段
  - 增加城市、启停、类型、竣工时间、楼层、物业、停车位、注册能力、认证和版本号。
  - 图集限制为 20 张并支持排序。
  - _Requirement: R3_
  - 验证证据: `payload-office-platform/src/collections/Buildings.ts`（city/district/businessDistrict 关系 + operationalStatus 启停轴 + buildingType/grade/verificationStatus/registrationCapability + completionDate/totalFloors/propertyCompany/propertyFee/parkingSpaces + gallery.maxRows=20 + version 乐观锁）；protectBuilding hook 强制枚举校验 + 图集上限 + 版本乐观锁；测试 `building-protect.test.ts`

- [x] 3.2 实现楼盘重复检测
  - 保存前检查同城同名和 100 米内高相似记录。
  - 展示候选详情、差异说明和合并入口。
  - 合并保留目标不可变 ID，迁移关联和审计链。
  - _Requirement: R3, R8_
  - 验证证据: 纯函数 `building-dedup.ts`（名称归一化 + Haversine 距离 + DUPLICATE_REASONS）/ 服务 `building-dedup-service.ts`（findBuildingDuplicates 同城候选 + 候选详情快照 + mergeBuildings 保留目标 ID 迁移关联与房源外键 + 区间重叠预检 + 软删源）/ endpoint `building-dedup-check-endpoint.ts`（GET /api/buildings/dedup-check）+ `building-merge-endpoint.ts`（POST /api/buildings/:id/merge，要求 building:delete 权限）；测试 `building-dedup-check-endpoint.test.ts` / `building-merge-endpoint.test.ts` / `building-dedup-service.test.ts`

- [x] 3.3 创建 Building 商户有效期关系
  - 创建关系 Collection 和服务。
  - PostgreSQL 增加区间排斥约束。
  - SQLite 增加事务内等价重叠校验。
  - _Requirement: R2, R3_
  - 验证证据: Collection `BuildingMerchantRelations.ts` + 纯函数 `building-merchant-relation.ts`（toListingRelationPeriod + findRelationOverlap）/ protect hook `building-merchant-relation-protect.ts`（区间合法 + 同楼盘不重叠 + 商户准入门禁: 启用 + 资质有效 + 服务城市覆盖）；测试 `building-merchant-relation.test.ts` / `building-merchant-relation-protect.test.ts`

- [x] 3.4 完成楼盘列表和详情体验
  - 增加城市、区域、商圈、等级和状态筛选。
  - 展示有效房源套数、面积和租金聚合。
  - 完成预览、查看房源、启停和导出动作。
  - _Requirement: R3, R7_
  - 验证证据: `Buildings.ts` defaultColumns 含 city/grade/status/operationalStatus；admin.components.edit.beforeDocumentControls 挂 BuildingOperationalToggle + BuildingAggregateCard（有效房源套数/面积/租金聚合 + 查看房源入口）；endpoint `building-operational-toggle-endpoint.ts`（POST /api/buildings/:id/toggle-operational-status，要求 building:freeze 权限）；聚合服务 `building-aggregate.ts`；测试 `building-operational-toggle-endpoint.test.ts` / `building-deactivation-impact-endpoint.test.ts`

- [x] 3.5 实现楼盘停用语义
  - 停用前展示受影响房源数量并二次确认。
  - 停用只影响有效供给谓词，不改写 Listing 审核和发布状态。
  - _Requirement: R3, R4, R8_
  - 验证证据: endpoint `building-deactivation-impact-endpoint.ts`（GET /api/buildings/:id/deactivation-impact，只读预检不阻断；countBuildingDeactivationImpact 走 M4.7 统一有效供给口径）；toggle endpoint 切换 operationalStatus 后,有效供给谓词自动过滤,但 Listings.reviewStatus / publicationStatus 不变；测试 `building-deactivation-impact-endpoint.test.ts`

### M3 验收门

- 同城重复候选在保存前出现。
- 有效期关系在边界时刻正确切换，重叠关系被拒绝。
- 楼盘停用后前台不可见，房源状态值保持不变。
