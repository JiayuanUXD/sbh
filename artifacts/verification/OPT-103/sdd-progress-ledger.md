# SDD ledger — plan: specs/work-items/OPT-103-plan.md
Task 1: minor (deferred): facade.ts:195 dimensionHits 注释仍写「六个维度恒有值」，实际已七个
Task 1: minor (deferred): parseDedupedStringArray 现在 trim 掉空白值，房源侧 parseStringArray 未同步（低影响，可后续对齐）
Task 1: complete (commits a1faf90..3276106, review clean)
Task 2: minor (deferred): tests/filter-unknown-vocabulary-values.test.ts:14-16 文件头仍说地铁/商圈「没有任何词表可查」，OPT-099 起商圈已有词表
Task 2: complete (commits 3276106..6e22385, review clean)
Task 3: fix round 1/5 (1 addressed, 0 open — 悬空 FilterFormC.countNoun 注释引用五处清理; commits 9ab8edb..7809049)
Task 3: complete (commits 6e22385..7809049, review clean)
Task 4: minor (deferred): 移动端（<768px）走 ?onlyWithStock=1 老链接看不到清除 chip（extraPicks 只在桌面筛选条；既有模式的取舍，可加一行注释说明）
Task 4: complete (commits 7809049..faa18db, review clean)
Task 5: minor (deferred): CityListingsView.tsx:54 头注释仍列「各计价单位的套数」（该 facet 已不取）
Task 5: minor (deferred): CityListingsView.tsx:346 注释「换单位由分段控件与提示条负责」指向已删控件
Task 5: minor (deferred): CityListingsView.tsx:369-371 extraPicks 注释理由不通——priceUnit 可见是因为页头副题「按 X 报价的…」，不是因为它不再是控件
Task 5: minor (deferred): CityListingsView.tsx:71-74 CHANNEL_COPY JSDoc 仍提「统一租金单位」与 FilterFormC.countNoun；字段级 JSDoc（countNoun/totalNoun/priceDimensionLabel）被计划的整块替换抹掉，可恢复
Task 5: minor (deferred): tests/opt036-listings-view-wiring.test.ts:9-23 文件头（ExcludedUnitsBar return null / 三次剥离 priceUnit / 不做渲染）与 :181 用例标题「退回即让单位提示条静默消失」已过期
Task 5: minor (deferred): coworking 用例「剥离查询不剥类型」只覆盖空态①，clearAllFacets（?district=jingan 用例）的 omit 列表未断言 not.toContain('listingType')
Task 5: complete (commits faa18db..bdf410d, review clean)
Task 6: minor (deferred): tests/city-route-pages.test.ts 里 buildCanonicalSearchParams 的桩只序列化 district/type 两个字段，扩用例时要注意
Task 6: fix round 1/5 (1 addressed, 0 open — legacy /coworking generateMetadata 补默认城市 live 守卫; commits 8d16ded..d4f28f0)
Task 6: complete (commits bdf410d..d4f28f0, review clean)
Task 7: minor (deferred): nav-targets.ts:12 文件头注释举例仍用 /listings?type=coworking，该入口已不经此机制，换成 full-floor 例子
Task 7: minor (deferred): sitemap 的 coworking 条目放在 buildings 之后而非 brief 说的 listings 之后（无功能影响）
Task 7: complete (commits d4f28f0..735610d, review clean)
Task 8: plan-mandated (待用户裁定): coworking-channel.spec.ts 第二个用例里 .ls-unitband / .ls-filterc__count / 「符合条件」三条断言在任何页面都成立（这三样已全站移除），不是 coworking 独有——保留作页面契约守卫 vs 删掉，交最终报告请用户定
Task 8: complete (commits 735610d..161aa6d, review clean)
Task 9: complete (commits 161aa6d..273e8d8, review clean)
Final review (opus): With fixes — Important: ①coworking wiring 用例未锁定 input 断言空转；②README 2b 行「375 底栏 chip 正常」与截图矛盾（.ls-filterc 移动端 display:none，老链接 onlyWithStock 在移动端不可见不可清）；③analytics/landing.ts CITY_PAGE_TYPES 缺 coworking（与 sale）→ 频道 page_view 被丢。Minor：E2E 正向断言、spec 文本漂移（unitFacets/301→307）、注释清理一批。裁定：mobile 抽屉 chip 作后续工作项（不扩 UI 范围），README 与 spec 如实记录。
Final fix wave: 4 commits 273e8d8..40bb798，scoped re-review：5/5 addressed，无新破坏。E2E 第二用例的全站断言按最终审查裁定保留并改标题。
DONE — 分支就绪，待 finishing-a-development-branch
