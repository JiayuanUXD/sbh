# 统一有效供给规则

## 唯一性

前台、后台预览、楼盘聚合、线索推荐、咨询候选、看板和 sitemap 只调用同一服务端有效供给查询。页面、组件、统计和内容引用不得复制简化谓词。

## 完整谓词

查询时点必须同时满足：

1. Listing 未逻辑删除。
2. 当前发布版本 `publication_status=已上架`。
3. `review_status=审核通过`。
4. `supply_visibility_hold=正常`。
5. 未被有效举报暂停。
6. 媒体完整且可读，MVP 至少 3 张有效图片。
7. Building、所属城市和区域启用。
8. 当前 Listing—Merchant 半开区间关系有效且唯一。
9. Merchant 启用、资质有效且未过期。
10. 已启用服务城市覆盖 Building 城市。
11. 租赁还需可租、可用日期未结束。
12. `last_effective_maintained_at` 不命中 `src/domain/supply` 中实现的陈旧排除规则。

任一条件失效即从全部消费者撤销，但不得因此改写审核状态、发布状态或历史快照。

## 关系与边界

- Building 默认商户和 Listing 商户关系使用 `[effective_from,effective_to)`。
- `effective_to` 空表示无穷；非空必须 start < end。
- 数据库按对象使用排斥约束禁止重叠。
- `t=effective_to` 属于从该时点开始的新关系，不属于旧关系。
- Listing 在关系开始时继承当时的 Building 默认商户快照；后续 Building 关系变化不回写历史。

## 房源投放申请（SupplySubmissions）

C 端 `/publish` 投放房源的落库对象。以下是定稿约束，改动前先确认，别在实现时放宽。

**独立集合，不复用 `Leads`。** 供给侧字段与需求侧零重叠；`Leads` 挂着归属 / 公海回收 / 首次跟进 SLA / 日领取上限一整套销售机制，把"业主来找我们"的反向线索塞进去会污染转化率与 SLA 统计。审单（审核 → 转 Listing 草稿）本来就是另一条工作流。

字段分四组，**外部只能写 A 组**，B/C/D 一律拒绝外部写入：

| 组 | 内容 | 可写性 |
|---|---|---|
| A 前台提交 | `buildingName` `address` `areaSqm` `rentAmount` `rentUnit` `commissionMonths` `contactPhone` | 外部可写，白名单严格 |
| B 后台补录 | 联系人 / 公司 / 提交人角色 / 城市 / 区域 / 租赁方式 / 装修 / 可用日期 / 描述 | 仅后台 |
| C 流程 | `status`(`pending\|contacted\|converted\|rejected\|duplicate`) `assignee` `reviewNote` `matchedBuilding` `convertedListing` `handledAt` | 仅后台 |
| D 溯源合规 | `sourcePath` `sourceUrl` `requestId` `idempotencyKey`(唯一索引) `consentAccepted` `consentPolicyVersion` `campaign` | readOnly，服务端写 |

D 组与 `Leads.inquiryContext` **同构**，字段定义直接照搬，保证两条链路合规口径一致。

提交链路 `POST /api/supply-submissions` 与 `/api/inquiries` 同构：

- schema 白名单收窄在 `src/domain/supply-submission/schema.ts`，纯函数 + Vitest，严格 TDD；
- **幂等键 = `sha256(requestId | phoneNormalized | buildingName | address)`**，四段顺序固定，DB 唯一索引兜底。**`address` 必须参与计算**——商办里"同一业主同一楼盘多套在租"是常态，只取手机号 + 楼盘名会把第二套判为重放并静默丢弃（该缺陷已在审查中发现并修正，原 PRD 的三段式口径作废）；
- `sourcePath` 只接受同源 pathname，剥离 query/hash，拒绝绝对 URL 与控制字符；
- 服务端走 Local API 写入；成功后向供给运营角色发 `Notifications`；
- 图片 / 平面图上传不在 MVP——照片由平台派人实勘拍摄，不靠业主上传。

后台：导航分组「供给投放」，默认 `status=pending` + 创建时间倒序；佣金列可排序/筛选（有悬赏的优先处理）；详情页两个动作是「转为房源草稿」与「标记拒绝」（必填原因）；供给运营/管理员读写，销售只读。

**导航里删掉「服务式办公」只是删入口，不动数据**：`Listings.listingType` 的 `serviced-office` 枚举、移动端筛选抽屉选项、详情页文案映射全部保留。别当成死代码清理掉。

## 测试

至少覆盖草稿、未审核、冻结、举报、媒体不足、位置停用、商户停用/过期、服务城市不覆盖、关系重叠、陈旧、已出租和逻辑删除，并断言所有消费者解析出的 Listing ID 集合一致。

