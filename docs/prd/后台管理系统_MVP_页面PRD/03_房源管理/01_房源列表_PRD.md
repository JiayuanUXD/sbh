# 房源列表 PRD

## 1. 文档信息
编号：03-01；版本：MVP v1.0；状态：可评审；所属模块：房源管理；负责人角色：运营人员；更新时间：2026-07-17。房源是挂靠楼盘的具体可出租或可出售单元，不得用房源替代楼盘主数据。

## 2. 页面概述
本页负责录入、查询、编辑、送审、发布和批量维护可在前台展示的办公房源。成功标准是用户能按区域、地铁、面积、价格、装修、标签及状态找到真实单元；审核只产出审核结论，审核通过且经具发布权限者显式上架的完整房源才按排序和发布条件输出至前台，且租赁与出售口径不混用。MVP 覆盖内部发布管理，不覆盖合同、收款、带看和成交结算。本页 UI 由中性线框或自有设计稿承接；参考截图仅用于竞品能力研究与需求追溯，不是产品界面、交付素材或视觉参考。

## 3. 用户与权限
平台管理员拥有全部城市的查看、新增、编辑、送审、上下架、标记已出租、批量、导入、导出和审计权限。运营人员仅可在获授权城市内操作，并须分别取得新增编辑、送审、发布、导入、导出权限；仅持有独立的“覆盖楼盘默认供给商户”权限者可把 `merchant_id` 改为同服务城市的其他有效商户。销售主管可只读查看所属团队经纪人负责的房源；经纪人可查看本人负责及获授权城市的已上架房源，只能编辑本人创建且 `publication_status=草稿`、`review_status` 为未提交或已驳回的记录；客服只读查询获授权城市的已上架房源。联系人手机号仅平台管理员、该经纪人本人及其销售主管在字段权限允许时显示全量，其余脱敏；所有接口同时校验数据、操作和字段权限。

## 4. 页面入口与关联
从“房源管理/房源列表”进入；可由楼盘详情“查看房源”、审核详情、举报详情或线索推荐选择器带入 `building_id`/`listing_id`。新建前须选定 Building、其所属城市和区域均启用的楼盘，城市、区、商圈和地铁信息只读继承楼盘；`merchant_id` 必填且默认继承该楼盘在 Listing 关系起点有效的 `default_merchant_id`，无覆盖权限不得编辑，有覆盖权限仅可选择服务城市已启用、覆盖该楼盘城市且业务状态启用、资质已通过未过期的商户。提交后进入房源审核；审核通过不自动上架，满足有效供给谓词且经具发布权限者显式上架后才可被前台、楼盘聚合与线索推荐消费。返回保留筛选、页码、列排序及已勾选行。

## 5. 页面结构
顶部为新增、导入、导出、前台预览；下方依次为筛选区、统计条、批量操作栏和固定操作列的分页表格，默认每页 20 条。详情抽屉包含基本单元、价格与可用性、媒体、标签与描述、联系人和归属、审核记录、举报风险、操作日志；编辑表单按相同分组展示。筛选区默认展开，宽度不足时表格横向滚动，批量栏只在选中可操作对象后出现。

## 6. 查询与筛选
支持城市、区、商圈、地铁站、楼盘名称、房源标题/编号、供给商户、`listing_type`、楼盘类型、房源类型、`area_sqm` 区间、租赁单价/总月租区间、出售单价/总价区间、装修、工位数/容量、楼盘可注册、固定直租/直售声明、楼盘认证/实勘、可用日期、`review_status`、`publication_status`、是否有图片、是否推荐、维护陈旧状态、创建人、顾问、风险标识及更新时间。租赁与出售价格控件按类型隔离；价格筛选必须同时指定币种，租赁单价还须指定计价单位与周期，不同口径不得比较。默认显示数据权限内非逻辑删除记录，按推荐权重升序、`last_effective_maintained_at` 降序；重置恢复默认，筛选及排序写入 URL。

## 7. 列表或内容展示
展示封面、标题/`listing_id`、所属楼盘及城市区商圈、供给商户及有效性、`supply_visibility_hold`、`listing_type`、`area_sqm`、`floor_number`/`unit_identifier`、装修、容量、租赁单价及总月租或出售单价及总价、楼盘可注册/楼盘认证标签、Listing 固定直租/直售声明、可用日期、顾问、`review_status`、`publication_status`、信息完整度、`last_effective_maintained_at`、维护陈旧状态、举报风险、推荐权重、更新时间和操作。面积显示一位小数；租赁单价必须显示 `currency+rental_billing_unit+rental_billing_period`，出售显示币种、每平方米单价及总价；无对应类型的字段显示“-”。仅在相同租售类型、币种、单位和周期内排序比较价格。点击标题进入详情，点击楼盘进入楼盘详情，风险标识进入举报筛选。

## 8. 详情及表单
通用持久化字段：`listing_id`（不可变，系统生成，必填）、`building_id`（所属城市和区域启用的楼盘，必填）、`merchant_id`（必填，默认继承楼盘默认商户；覆盖须有权限且商户服务城市已启用并覆盖该楼盘城市）、`supply_visibility_hold`（固定为正常/待复核，默认正常）、`listing_type`（租赁/出售，必填且创建后不可改）、标题（必填）、`area_sqm`（DECIMAL(12,1)，大于 0，必填）、`floor_number`（整数，0 禁止、地下层为负数，必填）、`unit_identifier`（楼盘内稳定单元标识，VARCHAR(64)，必填）、`currency`（ISO 4217 三字码，必填）、装修、可用日期、联系人、归属顾问及至少 3 张图片（送审必填）。Listing 供给关系必须记录 `[effective_from,effective_to)` 和不可变商户 ID/名称/资质/服务城市快照，`effective_to` 可空且非空时 `effective_from < effective_to`；数据库以 `listing_id` 的区间排斥约束禁止重叠，空结束视为无穷，任一时点仅一条有效关系。变更 `merchant_id` 关闭旧关系、新建关系并送审；边界 `t=effective_to` 不属于旧关系。新建 Listing 在自身 `effective_from` 继承该时刻有效的 Building 默认商户及快照，后续 Building 关系变更不得回写该 Listing 关系。租赁记录还必须持久化 `rental_unit_price`（DECIMAL(18,4)，正数）、`rental_billing_unit`（固定“平方米”）、`rental_billing_period`（“天”或“月”）、`rental_monthly_total`（DECIMAL(18,2)，正数）和 `rental_price_source`（`unit_price`/`monthly_total`）；出售记录还必须持久化 `sale_unit_price`（DECIMAL(18,2)，正数）、`sale_total_price`（DECIMAL(18,2)，正数）和 `sale_price_source`（`unit_price`/`total_price`）。不适用另一租售类型的价格字段必须为 NULL，禁止同一记录同时保存两套价格。`unit_identifier_normalized` 由 NFKC、去首尾空格、英文字母转大写和连续空白合一生成并持久化。楼盘可注册与楼盘认证为只读固定 Building 字段；`is_direct_listing` 为 Listing 必填布尔值，`listing_type+is_direct_listing` 计算固定声明 `NONE`/`DIRECT_RENT`/`DIRECT_SALE`，不得由字典标签写入。`last_effective_maintained_at` 为 Listing 权威时间戳，按 `Asia/Shanghai` 保存；图片最多 20 张，户型图最多 5 张，首图为封面且哈希不得重复。

## 9. 核心操作与流程
创建时生成不可变 `listing_id`，`publication_status=草稿`、`review_status=未提交`、`supply_visibility_hold=正常`。提交审核创建包含供给关系及商户有效性快照的不可变快照，并仅将 `review_status` 改为待审核；撤回则回到未提交，`publication_status` 保持原值。审核通过默认只写 `review_status=审核通过`，不得隐式写 `publication_status`：新建房源保持草稿、已下架房源保持已下架，已上架核心字段变更的旧发布版本继续展示且状态不被工作版本覆盖。仅审核人同时具备审核和发布权限、在提交结论时明确勾选“通过后上架”、并通过有效供给谓词校验时，才可在同一原子事务上架；其他情形由具发布权限者另行显式上架。下架需原因；标记已出租设 `publication_status=已出租` 并撤销推荐。商户停用批次将所有关联 Listing 持久化为 `supply_visibility_hold=待复核`；商户恢复不自动清除，运营人员仅在商户、Building 所属城市/区域、商户服务城市、当前关系及审核结论均有效后显式解除为正常，再由具发布权限者显式上架。仅成功保存会影响前台的有效业务字段（位置继承、单元、面积、租售、价格、可用性、媒体、描述、联系人/顾问、`merchant_id`、固定声明、推荐等）或审核通过新版本时，更新 `last_effective_maintained_at`；浏览、查询、导出、无效/失败保存重试、仅日志/埋点/审计写入及不影响前台的后台字段变更均不得更新。批量操作逐条校验资格并返回原因；复制生成新的 `listing_id`、草稿和未提交状态，不复制审核、举报和日志。

## 10. 状态与业务规则
`publication_status` 枚举固定且仅为草稿/已上架/已下架/已出租；`review_status` 枚举固定且仅为未提交/待审核/审核通过/已驳回，`supply_visibility_hold` 仅为正常/待复核，三者独立、禁止组合持久化。前台、楼盘聚合、咨询/顾问候选和看板有效供给仅在当前发布版本 `publication_status=已上架`、`review_status=审核通过`、`supply_visibility_hold=正常`、所属 Building及其城市和区域启用、当前 `merchant_id` 关系在该时点有效、商户启用且资质已通过未过期、商户服务城市已启用并覆盖楼盘城市、未被举报暂停且至少 3 张有效图片时可见；商户停用、资质失效、服务城市不启用/不再覆盖、Building 城市/区域停用或冻结为待复核时立即撤销上述可见性和计数，不改写房源状态或历史快照。陈旧判定唯一使用 `last_effective_maintained_at`：以 `Asia/Shanghai` 的日历日计算，当 `DATE(last_effective_maintained_at AT TIME ZONE 'Asia/Shanghai') <= as_of_date - 30 日` 时为陈旧；空值按陈旧并阻止前台发布，`updated_at` 不得替代该字段。价格换算以已持久化的一位小数 `area_sqm` 为面积，统一十进制 ROUND_HALF_UP：租赁 `unit_price` 为源时，周期“天”的 `rental_monthly_total=round(rental_unit_price*area_sqm*30,2)`，周期“月”为 `round(rental_unit_price*area_sqm,2)`；`monthly_total` 为源时，周期“天”的 `rental_unit_price=round(rental_monthly_total/(area_sqm*30),4)`，周期“月”为 `round(rental_monthly_total/area_sqm,4)`。出售 `unit_price` 为源时 `sale_total_price=round(sale_unit_price*area_sqm,2)`；`total_price` 为源时 `sale_unit_price=round(sale_total_price/area_sqm,2)`。源字段保留输入值且只允许编辑源字段；面积、单位、周期或源值变化时重算派生字段，禁止反复双向换算。币种不自动换算，变更币种必须重新确认源价格。

## 11. 异常与边界
未选楼盘、楼盘/所属城市/区域停用、默认或覆盖商户无效、商户服务城市不启用/不覆盖、关系有效期重叠、顾问停用、楼层为 0、单元标识为空、币种非法、租售必需价格缺失、派生价格不等于公式结果或非适用价格不为 NULL 时，保存/导入明确指出字段并拒绝。`supply_visibility_hold=待复核` 时拒绝上架，只有满足复核前提的运营人员可显式解除；商户恢复不得自动解除。停用楼盘或商户下的已上架房源撤出前台但保留状态记录。版本号不一致时拒绝覆盖；无效保存或失败重试不得改变 `last_effective_maintained_at`。上传失败不写入媒体排序；导入逐行校验全部持久化字段、商户有效性、关系区间、公式和去重键，失败报告包含行号/字段/原因，其他成功行保存为草稿、未提交。跨租售类型批量改价、`review_status=待审核` 时编辑和已出租重新上架均被拒绝。

## 12. 数据与指标
核心数据为 Listing、Building、Merchant、供给关系历史、Broker、媒体、审核快照、举报风险和操作日志，主键为不可变 `listing_id`。去重强键为 `building_id+listing_type+floor_number+unit_identifier_normalized`；命中即阻止同租售类型新建，面积差不超过 1%或图片哈希相同作为补充风险证据。相同物理单元同时出租和出售时必须创建两条不同 `listing_id`，可共享 `building_id+floor_number+unit_identifier_normalized`，但 `merchant_id`、`listing_type`、价格、`publication_status`、`review_status` 和版本完全独立。供给关系与审核快照均记录有效期和商户资格快照；看板中的有效供给、前台、咨询路由和楼盘聚合均复用第 10 节谓词。租赁聚合读取 `rental_unit_price` 与 `rental_monthly_total`，出售聚合读取 `sale_unit_price` 与 `sale_total_price`，均按币种及租赁单位/周期分组；任何指标不得现场重新解释源字段。前台同权重按 `listing_id` 稳定排序，缓存最长 5 分钟。

## 13. 埋点、通知与审计
埋点包括 `listing_search`、`listing_create`、`listing_edit`、`listing_submit_review`、`listing_withdraw_review`、`listing_publish`、`listing_unpublish`、`listing_mark_rented`、`listing_batch_action`、`listing_preview`、`listing_export`。送审、退回、驳回和审核通过均向提交人发送站内提醒；商户失效或停用同步通知主顾问及归属人；下架、已出租和举报暂停同步通知主顾问及归属人。审计保存房源 ID、版本、动作、供给商户关系有效期、边界继承及不可变资格快照、`supply_visibility_hold` 前后值和解除复核依据、价格源字段与派生字段前后值、`last_effective_maintained_at` 更新原因或“不更新”原因、`publication_status`、`review_status`、审核与发布权限校验、审核结论提交时“通过后上架”勾选值、原因、操作者、数据范围、IP、时间和请求 ID；图片排序、批量逐条结果和导出条件同样记录。

## 14. 验收标准
正常：运营人员分别创建租赁和出售房源，`merchant_id` 默认继承关系起点有效的楼盘商户，获覆盖权限者仅能改为服务城市已启用且覆盖楼盘城市的有效商户；系统按价格源、30 天月折算和 ROUND_HALF_UP 生成另一价格。仅具审核权限者审核通过后只写 `review_status`，新建/已下架房源保持草稿/已下架；同一操作人同时具审核和发布权限、提交结论时明确勾选“通过后上架”且满足谓词，才原子上架；其他审核通过房源须由具发布权限者显式上架，楼盘聚合 5 分钟内更新。权限：无覆盖权限者不能编辑继承商户，经纪人不能编辑非本人草稿，运营人员不能导出未授权城市，未获发布权限者调用上下架接口返回 403，销售主管和客服只读。异常：待审核无法编辑，楼盘/城市/区域或商户/服务城市无效、复核冻结、旧版本、重叠有效期、0 楼层、空单元标识、非法币种、公式不一致、非适用价格非 NULL 和重复强键均拒绝保存或上架，批量操作返回逐条原因。数据：逐项断言第 8 节字段的必填/NULL 规则及单一有效供给商户关系；构造相邻关系验证边界继承并验证 Listing/Building 的数据库排斥约束拒绝重叠；构造商户停用验证所有关联 Listing 持久化为 `supply_visibility_hold=待复核`，前台、顾问候选和看板均排除但状态和快照不改写，恢复商户不自动解除，复核有效后须显式解除并由具发布权限者上架；构造城市/区域或服务城市停用也验证三处排除；构造 `Asia/Shanghai` 日期，断言 `<= as_of_date-30` 为陈旧，且浏览、导出、无效重试、仅日志不更新 `last_effective_maintained_at`，有效字段成功保存和审核通过新版本更新；用日租、月租、出售单价源和出售总价源各一组边界小数验证公式及舍入；同一物理单元租售生成两个不同 `listing_id`，同类型重复被拦截；四个发布状态与四个审核状态之外的值数据库约束拒绝。

## 15. 依赖与风险
依赖楼盘与位置字典、经纪人资料、审核、举报、媒体存储、前台发布缓存、权限及审计。市场价格波动会使阈值校验需要字典化配置；媒体真实性无法由系统完全判定，须由审核与举报闭环补强。MVP 不接受客户自助发布、在线合同或出售交易撮合，也不新增任何资金相关字段或流程。

## 16. 截图参考

截图能力编号与证据路径以 [README 第 6 节](../README.md#6-截图能力追溯矩阵) 为准。
完整截图仅用于竞品能力研究与需求追溯，不是产品界面、交付素材或视觉参考。实施仅采用下表列出的抽象能力，不采用截图中的品牌、导航、广告、咨询入口、联系方式或视觉样式；UI 以中性线框或自有设计稿承接。

| 参考截图 | 抽象能力 |
| --- | --- |
| 参考截图1 | 区域、面积、单价、装修、排序、图片、地址、房源数与租金信息。 |
| 参考截图2 | 图集、价格、面积、可用房源、注册标签和顾问信息。 |
| 参考截图3 | 板块/地铁、租售类型、楼盘类型、认证/直租、面积价格和可选数量。 |
| 参考截图4 | 在租/在售、面积/单价/总价排序、直租/直售与房源参数。 |
