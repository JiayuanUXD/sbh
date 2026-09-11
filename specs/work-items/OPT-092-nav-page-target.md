# Task Packet：OPT-092 导航可链内容页 + 页脚栅格按分组数排列

> 状态：**待评审**
> 创建日期：2026-09-11
> 来源：用户在线上「页面内容」新建「加入我们」，页脚配置里选不到它；配了第 4 组后页脚掉行

---

## 1. 一句话

主导航 / 页脚链接的「跳转目标」多一个值「内容页」，同行加 `page` 关联字段指定具体页面，
前台解析成 `/pages/<slug>`；页脚栅格列数改为跟着「页脚分组」的行数走，不再写死 4 轨。

## 2. 两个根因

### 2.1 选不到页面

`nav-targets.ts` 的目标池是固定枚举（OPT-054 有意如此：只能链真实路由，防死链）。
`/pages/[slug]` 的 slug 由内容决定，进不了枚举，OPT-054 时被写进了豁免名单。
结果：运营新建的页面没有任何入口能配。线上「加入我们」用「城市合伙人」顶替，
实际链到 `/city-partner?city=shanghai`，是错链（2026-09-11 抓线上 HTML 证实）。

### 2.2 页脚掉行

`styles.css` 的 `.site-footer__inner` 写死 `grid-template-columns: 1.6fr 1fr 1fr 1fr`
（注释：按「品牌 + 浏览/按类型/服务」三组设计）。OPT-054 把「页脚分组」开放到
`maxRows: 5`。线上配了第 4 组「公司动态」，第 5 个格子放不下，溢出到第二行第一列——
就是截图里 logo 下面那块。「公司动态」是它的分组标题，不是没标题。

## 3. 做法

| 层 | 改动 |
|---|---|
| 目标池 `src/lib/frontend/nav-targets.ts` | `PAGE_TARGET_ID = 'page'` 只进 `NAV_TARGET_OPTIONS`，**不进** `NAV_TARGETS`（否则「池 → 路由」守卫拿不到固定 href）；新增纯函数 `resolveNavRow`，内容页判据与 `findPublishedPageBySlug` 一致：未发布 / 已删 / 未展开 / 未选 一律不渲染 |
| Global `src/globals/SiteSettings.ts` | `navPageField`（relationship → pages）挂在 `mainNav` 与 `footerColumns.links` 的 `target` 之后；`admin.condition` 只在 target=page 时显示；`validate` 选了内容页却没选页面 → 400。**故意不写 `filterOptions: {status: published}`**：它是保存时硬校验，已链接页转草稿会让整份设置改不动 |
| 读取层 `src/lib/frontend/site-settings.ts` | `mapNavLinks` 改调 `resolveNavRow`；`findGlobal` 的 `depth: 1` 恰好展开 `page` 一层 |
| 缓存 `src/collections/Pages.ts` | afterChange / afterDelete 同时失效站点设置缓存，页面转草稿后入口立刻消失，不等 60 秒 |
| 迁移 `20260911_031639_nav_page_target` | 两个枚举 `ADD VALUE 'page'`；两张表加 `page_id` + FK（`ON DELETE set null`）+ 索引。`down()` 完整 |
| 页脚 `styles.css` + `SiteFooter.tsx` | `grid-template-columns: minmax(0,1.6fr) repeat(var(--footer-cols,3), minmax(0,1fr))`，组件把 `footerColumns.length` 写进 `--footer-cols`；≤1024 / ≤767 的两档规则不变 |

护栏不变：仍然只能链到真实存在的页面，不开自由文本 URL（OPT-054 的判断没有被推翻）。

## 4. 验收

- [x] 后台「站点设置 → 导航 → 页脚分组」能选「内容页」，选中后旁边出现「内容页」页面选择器，
      只列「页面内容」里的记录
- [x] 保存 200，响应含 `{target:'page', page:<id>}`；PG `site_settings_footer_columns_links.page_id` 落库；
      强刷后台回显一致
- [x] 选了「内容页」不选页面 → 保存 400，字段级红字「跳转目标选了「内容页」，必须指定一个页面」
- [x] 前台页脚：1440 下品牌 + 4 组同一行（`grid = 343 + 4×214`）；1024 / 768 下品牌整行 + 2×2；375 单列无横向滚动
- [x] 点「加入我们」→ `/pages/about` 200，canonical 正确
- [x] 页面转草稿 → 刷新后整组消失（唯一链接不渲染，空组跳过），`--footer-cols` 回到 3；重新发布 → 恢复
- [x] 主导航同一套字段与解析：加一条 target=page → 页头出现「关于我们 → /pages/about」
- [x] `typecheck` / `lint`（0 error）/ `test`（4871 passed）/ `migrate:dry-run`（本迁移无禁用模式）

证据：`artifacts/verification/OPT-092/`。

## 5. 上线后要做的一件事（运营侧）

线上「公司动态 → 加入我们」目前 target 是 `city-partner`。迁移跑完后，把它的跳转目标改成
「内容页」并选中「加入我们」页面，否则它继续链到城市合伙人页。代码不替运营改这条配置行。

## 6. 非目标

- 后台「页面内容」的「预览」按钮只对 `slug=home` 生效（`admin.preview`），其余页面没有预览入口——
  另开工作项。
- `/pages/<slug>` 没有城市前缀版本（`/shanghai/pages/x` 404）。内容页本来就不分城市，不改。
