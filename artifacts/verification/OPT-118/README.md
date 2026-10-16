# OPT-118 验证证据：资讯数据口径与脚本

8 篇资讯里所有数字的来源。数据取自 2026-10-16 线上公开 API（匿名可读），**只读、不写**。

## 复现

```bash
python3 -I fetch_data.py                    # 拉 locations / buildings / listings 到 /tmp/opt118-data/（约 73 次请求，每次 500 条，间隔 0.4s）
python3 -I analyze_overview.py              # 各区 / 商圈 / 面积段 / 小面积 统计
python3 -I analyze_terms_and_areas.py       # 商圈排行（≥150 条）、押付与租期占比、共享办公、预算反推
```

`output_*.txt` 是 2026-10-16 当天的运行结果，文章里的数字都能在这里对上。

## 筛选条件（与前台「有效供给」口径对齐）

`publicationStatus=published` 且 `reviewStatus=approved` 且 `businessType=lease`，共 36,471 条，与前台列表页「共 36471 套」一致；
其中 36,427 条按「元/㎡/天」报价（统计价格用），44 条共享办公按「元/工位/月」报价（单独统计）。

## 已知口径限制（文章里已向读者说明）

1. **挂牌价，不是成交价。**
2. **按房源条目统计**，同一楼盘条目多则权重大（例：南京西路 2,310 条里，仲益大厦一栋就有 764 条）。
3. **月租按日单价 × 30 折算。**
4. **`seats` 字段不可用**：36,424 条里面积 ÷ 工位数恒等于 5，是按面积推算出来的，不是真实工位数，文章没有使用。
5. **`spaceDetails.efficiencyRate`（得房率）高度集中在 70%**（p10=65、p90=75），可能带默认值，文章只说「大致 65%–75%」，没有当数据结论用。
6. **`costTerms.propertyFeeInclusion` / `invoiceStatus` 全部为空**：文章据此提醒读者「站内报价均未标明是否含物业费、能否开票」。
7. 共享办公只有 44 条（静安 14 / 黄浦 10 / 浦东 7 / 长宁 5 / 普陀 4 / 徐汇 3 / 虹口 1），文章已标注样本小。

## 公开 API 暴露面（顺带发现，未处理）

匿名访问 `/api/listings` 能拿到完整房源文档，包含 `merchant`、`contactBroker`、`reviewStatus`、`dataSource.sourceUrl`（外部来源 URL）、`verificationInfo` 等内部字段；
`/api/buildings` 同样带 `dataSource`。未发布 / 未审核的文档没有暴露（`publicationStatus != published` 查询返回 0 条）。
这不在本工作项范围内，已在交付说明里单独提示，是否收窄字段读权限由用户决定。
