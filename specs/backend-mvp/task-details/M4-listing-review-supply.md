# 后台任务：M4 房源审核、发布与可信供给

> 返回：[任务索引](../tasks.md)

## M4 房源审核、发布与可信供给

- [x] 4.1 扩展房源业务字段
  - 增加独立发布状态、审核状态、供给冻结、租售类型、装修、楼层、租期、付款、联系人、媒体和版本号。
  - 将价格迁移为金额、币种、周期和单位结构。
  - 保留旧 `status` 进入过渡期，不立即删除。
  - _Requirement: R4_

- [x] 4.2 创建 Listing 商户有效期关系
  - 创建房源供给关系和继承 Building 默认商户的快照规则。
  - 后续 Building 默认关系变化不得回写既有 Listing 关系。
  - _Requirement: R2, R4_

- [x] 4.3 实现房源完整度与草稿校验
  - 草稿保存执行最小字段校验。
  - 提交审核执行完整字段、价格、有效商户和至少 3 张图片校验。
  - 展示完整度和缺失项定位。
  - _Requirement: R4_

- [x] 4.4 创建审核模型与状态机
  - 创建 `listing_reviews` 和不可变提交快照。
  - 实现提交、撤回、通过、驳回和重新提交。
  - 审核中核心工作版本锁定，使用版本号防并发覆盖。
  - _Requirement: R4, R8_

- [x] 4.5 建设房源审核 Custom View
  - 审核队列、领取、详情对比、历史记录、通过和驳回。
  - 驳回必须填写原因。
  - 可选“通过后上架”仅对同时具备审核和发布权限者开放。
  - _Requirement: R1, R4_

- [x] 4.6 实现显式发布动作
  - 发布前检查审核通过和有效供给谓词。
  - 下架必须填写原因。
  - 已出租自动取消推荐并撤销前台可见性。
  - _Requirement: R4, R8_

- [x] 4.7 建立统一有效供给查询
  - 实现共享查询服务并替换前台、预览、楼盘聚合、Dashboard 和关系候选查询。
  - 提供每个不合格原因的诊断结果。
  - _Requirement: R3, R4, R7_

- [x] 4.8 实现商户停用冻结
  - 商户停用时批量设置关联 Listing 为待复核。
  - 商户恢复不自动解除。
  - 运营显式解除后仍需发布权限重新上架。
  - _Requirement: R2, R4, R8_
  - 验证证据:
    - 服务: `payload-office-platform/src/domain/supply/merchant-stop-listings.ts`（listActiveListingIdsForMerchant 按 listing-merchant-relations 当前有效供给关系去重收集房源 id + markListingsPendingReview 批量置 reviewStatus=pending,已 pending 跳过 + markListingsPendingReviewOnMerchantStop 一站式汇总 affectedListingIds / succeeded / skipped / failed / failures）
    - 状态语义: 标记为 pending 而非 publicationStatus=offline,保持 draft/published/offline 现值;绕过状态机属合规冻结,与 design §3.5 一致;商户恢复不自动解除,运营需逐条显式重新发布（M4.6 listing-publish-endpoint 仍要求 reviewStatus=approved + 有效供给谓词）
    - afterChange hook: `payload-office-platform/src/collections/Merchants.ts` handleMerchantStopBatchListings 仅在 update + active→disabled 时触发,失败不阻断商户停用（合规止损）,report 挂到 req.context.__merchantStopBatchReport 供 M8.2 审计接入读取
    - 测试: `payload-office-platform/tests/merchant-stop-listings.test.ts`（10 用例: listActiveListingIdsForMerchant 去重 + null 跳过 / markListingsPendingReview 已 pending 跳过 + 不存在 ok=false + update 抛错捕获 + publicationStatus 不改 / markListingsPendingReviewOnMerchantStop 一站式 + 空商户 + 部分失败汇总）

### M4 验收门

- 未审核、资料不足或关系无效的房源无法上架。
- 审核通过不会自动改变发布状态。
- 前台、预览、楼盘聚合和看板对同一房源可见性结论一致。
- 旧版本编辑返回 409，不覆盖新数据。
