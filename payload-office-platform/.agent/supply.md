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
12. `last_effective_maintained_at` 不命中 PRD 的陈旧排除规则。

任一条件失效即从全部消费者撤销，但不得因此改写审核状态、发布状态或历史快照。

## 关系与边界

- Building 默认商户和 Listing 商户关系使用 `[effective_from,effective_to)`。
- `effective_to` 空表示无穷；非空必须 start < end。
- 数据库按对象使用排斥约束禁止重叠。
- `t=effective_to` 属于从该时点开始的新关系，不属于旧关系。
- Listing 在关系开始时继承当时的 Building 默认商户快照；后续 Building 关系变化不回写历史。

## 测试

至少覆盖草稿、未审核、冻结、举报、媒体不足、位置停用、商户停用/过期、服务城市不覆盖、关系重叠、陈旧、已出租和逻辑删除，并断言所有消费者解析出的 Listing ID 集合一致。

