# OPT-095 详情页三处展示修正 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修三处 C 端展示缺陷——房源详情「所在楼盘」恒占位图（含顺带恢复概况表的空调/网络/停车费三行）、顶栏客服号码前加「客服」、楼盘详情桌面供给表加房源缩略图。规格：`specs/work-items/OPT-095-detail-display-fixes.md`。

**Architecture:** 三个互不依赖的小改动，每个自带测试与提交。① 域层 `mapListingDetail` 用未收窄的 `mapBuildingSummary` 覆盖 `building`（详情不受 OPT-047 卡片缓存 2MB 红线约束）；② `ServicePhoneLink` header 形态加前缀 span，CSS 与号码同显隐；③ `BuildingSupplyBrowser` 桌面表「房源」单元格改为「缩略图 + 标题/副行」横向布局，缺图用共享 `CardMediaPlaceholder`。

**Tech Stack:** Next.js 16 App Router / React 19 / Payload 3.86 / Vitest 4 / pnpm。工作树 `E:\wt-095`，分支 `feat/opt-095-detail-display-fixes-8e61`。

## Global Constraints

- 所有命令在 `E:\wt-095\payload-office-platform` 下用 **pnpm** 执行；不得 `npm` / `yarn`。
- 禁止 `any` / `as any` / `@ts-ignore` / `@ts-nocheck`；外部输入用 `unknown` 收窄。
- 提交只用**显式** `git add <路径>`，禁用 `git add -A` / `git add .` / `-am`。提交信息简体中文，类型前缀与分支类型一致（`fix` / `feat`），**不加署名行**。
- `src/payload-types.ts` 是生成物、不入库；本树已跑过 `pnpm generate:types`。
- **不改** `mapListingCard` 的收窄策略（OPT-047）；**不改**移动端供给卡片（`ListingCard variant="building-supply"`，被 E2E 锁定）；**不改**抽屉行「客服电话 …」文案。
- 每个任务完成后跑 `pnpm typecheck` 与该任务的单测文件；全部任务完成后再跑 `pnpm lint`、`pnpm test:changed`、浏览器走查（Task 4）。
- 中文文案一律简体。

---

### Task 0: 工作树环境（已完成，只需核对）

**Files:**
- Modify: `E:\wt-095\payload-office-platform\.env.local`（本树私有，不入库）

已做：`git worktree add -b feat/opt-095-detail-display-fixes-8e61 E:/wt-095 origin/master`、`pnpm install --frozen-lockfile`、`pnpm generate:types`、复制主树 `.env.local`。

- [ ] **Step 1: 给本树独立端口**

把 `.env.local` 里 `NEXT_PUBLIC_SITE_URL=http://localhost:3717` 改为 `http://localhost:3727`。本项无迁移、只读展示，沿用 `postgres` 本地库（与 OPT-094 树同做法）；只隔离端口。

```bash
cd /e/wt-095/payload-office-platform && sed -i 's#NEXT_PUBLIC_SITE_URL=http://localhost:3717#NEXT_PUBLIC_SITE_URL=http://localhost:3727#' .env.local && grep NEXT_PUBLIC_SITE_URL .env.local
```
Expected: `NEXT_PUBLIC_SITE_URL=http://localhost:3727`

- [ ] **Step 2: 核对基线绿**

```bash
cd /e/wt-095/payload-office-platform && pnpm typecheck && pnpm vitest run tests/frontend-mappers.test.ts tests/listing-card-payload-size.test.ts tests/site-header-features.test.ts tests/detail-components-contract.test.ts
```
Expected: typecheck 无输出（exit 0）；4 个测试文件全部 passed。

---

### Task 1: `mapListingDetail` 用未收窄的楼盘摘要（修「所在楼盘」占位图根因）

**Files:**
- Modify: `src/domain/public-catalog/mappers.ts:1034-1063`（`mapListingDetail`）
- Test: `tests/frontend-mappers.test.ts`（`describe('mapListingDetail')` 块内追加）

**Interfaces:**
- Consumes: `mapBuildingSummary(raw: unknown): BuildingSummaryViewModel | null`（同文件 464 行，已存在）；夹具 `LISTING_MONTHLY_STANDARD` / `BUILDING_JINGAN_CENTER`（`src/test/frontend/payload-documents.ts`，`BUILDING_JINGAN_CENTER.coverImage = MEDIA_COVER_A`，`summary = '南京西路核心地段甲级写字楼'`）。
- Produces: `ListingDetailViewModel.building` 携带 `coverImage` / `summary` / `airConditioning` / `network` / `parkingFee`（类型不变，`BuildingSummaryViewModel` 这些字段本就是可选）。

- [ ] **Step 1: 写失败测试**

在 `tests/frontend-mappers.test.ts` 的 `describe('mapListingDetail', () => {` 块末尾（`it('重复 src 被去重'` 那条之后、`})` 之前）追加：

```ts
  it('详情的 building 是未收窄的楼盘摘要：封面、摘要与楼宇服务字段必须在（OPT-095）', () => {
    // OPT-047 在 mapListingCard 里为 2MB 缓存红线剔掉了 building.coverImage 等字段，
    // 而 mapListingDetail 曾以 `...card` 原样继承——线上表现为「所在楼盘」恒占位图、
    // 「房源概况」的空调 / 网络 / 停车费三行恒空。详情不进全量卡片缓存，不该被收窄。
    const detail = mapListingDetail({
      ...LISTING_MONTHLY_STANDARD,
      building: {
        ...BUILDING_JINGAN_CENTER,
        buildingServices: { airConditioning: '中央空调', network: '光纤入户', parkingFee: '800 元/月' },
      },
    })
    expect(detail?.building?.coverImage?.src).toBe('/media/cover-jingan-center.jpg')
    expect(detail?.building?.summary).toBe('南京西路核心地段甲级写字楼')
    expect(detail?.building).toMatchObject({
      airConditioning: '中央空调',
      network: '光纤入户',
      parkingFee: '800 元/月',
    })
  })
```

`BUILDING_JINGAN_CENTER` 已在该文件顶部 import（第 20–30 行附近的 `from '@/test/frontend/payload-documents'`）；若没有，加进同一条 import。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-095/payload-office-platform && pnpm vitest run tests/frontend-mappers.test.ts -t "未收窄的楼盘摘要"
```
Expected: FAIL，`expected undefined to be '/media/cover-jingan-center.jpg'`。

- [ ] **Step 3: 最小实现**

`src/domain/public-catalog/mappers.ts` `mapListingDetail` 的 `return { ...card, ... }` 里，在 `...card,` 之后、`seats:` 之前插入：

```ts
    // OPT-095：详情不进全量卡片数组缓存（OPT-047 的 2MB 红线只约束列表链路），
    // 楼盘摘要用未收窄的完整版——「所在楼盘」卡片要封面与摘要，「房源概况」参数表
    // 要空调 / 网络 / 停车费（detail-spec/listing-rows.ts 读 ctx.building.*）。
    // 此前 `...card` 把卡片链路剔过字段的 building 一并带进了详情：线上所在楼盘
    // 恒占位图、三行楼宇服务恒空（2026-09-12 抽查楼盘 164，coverImage 明明非空）。
    // `?? card.building` 只为类型收口：mapListingCard 已保证 building 可映射，恒不命中。
    building: mapBuildingSummary(listing.building) ?? card.building,
```

- [ ] **Step 4: 跑测试确认通过 + 卡片收窄未回退**

```bash
cd /e/wt-095/payload-office-platform && pnpm vitest run tests/frontend-mappers.test.ts tests/listing-card-payload-size.test.ts tests/listing-overview-panel.test.ts && pnpm typecheck
```
Expected: 三个文件全 passed（`listing-card-payload-size` 的「building 只保留卡片链路真正读取的字段」仍绿，证明卡片收窄没动）；typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
cd /e/wt-095 && git add payload-office-platform/src/domain/public-catalog/mappers.ts payload-office-platform/tests/frontend-mappers.test.ts && git commit -m "fix(catalog): 房源详情的楼盘摘要不再继承卡片链路的收窄，所在楼盘封面与楼宇服务字段恢复（OPT-095）"
```

---

### Task 2: 顶栏客服号码前加「客服」

**Files:**
- Modify: `src/components/frontend/ServicePhoneLink.tsx:31-36`（`header` 形态）
- Modify: `src/app/(frontend)/styles/member.css:77-81`（`.service-phone__number` 显隐规则）
- Test: `tests/site-header-features.test.ts`

**Interfaces:**
- Consumes: `ServicePhone = { display: string; href: string }`（`src/lib/frontend/service-phone.ts`）。
- Produces: header 形态 DOM：`<a class="service-phone" aria-label="拨打客服电话 …"><svg…/><span class="service-phone__prefix">客服</span><span class="service-phone__number">…</span></a>`。

- [ ] **Step 1: 写失败测试**

在 `tests/site-header-features.test.ts` 末尾那条 `it('图标入口带可读的 aria-label…'` 之后追加：

```ts
  it('桌面顶栏号码前带「客服」前缀，与号码同一显隐（OPT-095）', () => {
    const html = render({ servicePhone: '400-820-1234' })
    expect(html).toContain('<span class="service-phone__prefix">客服</span>')
    // 前缀紧挨号码，中间不能夹别的节点——CSS 靠相邻关系在 ≥1024 一起显示
    expect(html).toMatch(/service-phone__prefix">客服<\/span><span class="service-phone__number">0571 8888 6666</)
    // 抽屉行文案不变
    expect(html).toContain('客服电话 0571 8888 6666')
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-095/payload-office-platform && pnpm vitest run tests/site-header-features.test.ts -t "客服」前缀"
```
Expected: FAIL，`expected … to contain '<span class="service-phone__prefix">客服</span>'`。

- [ ] **Step 3: 实现组件**

`src/components/frontend/ServicePhoneLink.tsx` 的 header 分支改为：

```tsx
  return (
    <a href={phone.href} className="service-phone" aria-label={`拨打客服电话 ${phone.display}`}>
      <PhoneIcon size={20} className="service-phone__icon" />
      {/* OPT-095：号码前加「客服」，让入口不靠图标也能被认出来；与号码同受 ≥1024
          显隐控制（见 member.css），窄屏只剩图标 + aria-label。 */}
      <span className="service-phone__prefix">客服</span>
      <span className="service-phone__number">{phone.display}</span>
    </a>
  )
```

并把文件头注释里的「≥1024 显示「图标 + 号码」」改为「≥1024 显示「图标 + 客服 + 号码」」。

- [ ] **Step 4: 实现样式**

`src/app/(frontend)/styles/member.css` 把

```css
.service-phone__number { display: none; }
@media (min-width: 1024px) {
  .service-phone { padding: 0 var(--sp-3); }
  .service-phone__number { display: inline; }
}
```

改为

```css
.service-phone__prefix,
.service-phone__number { display: none; }
@media (min-width: 1024px) {
  .service-phone { padding: 0 var(--sp-3); }
  .service-phone__prefix,
  .service-phone__number { display: inline; }
  /* 「客服」与号码是同一个短语，间距收成 4px；图标与文字之间仍是 .service-phone 的 gap（8px） */
  .service-phone__prefix { margin-right: calc(var(--sp-1) - var(--sp-2)); }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /e/wt-095/payload-office-platform && pnpm vitest run tests/site-header-features.test.ts tests/service-phone.test.ts && pnpm typecheck
```
Expected: 全 passed；typecheck 无输出。

- [ ] **Step 6: 提交**

```bash
cd /e/wt-095 && git add payload-office-platform/src/components/frontend/ServicePhoneLink.tsx "payload-office-platform/src/app/(frontend)/styles/member.css" payload-office-platform/tests/site-header-features.test.ts && git commit -m "feat(header): 桌面顶栏客服号码前加「客服」前缀（OPT-095）"
```

---

### Task 3: 楼盘详情桌面供给表「房源」列加缩略图

**Files:**
- Modify: `src/components/frontend/BuildingSupplyBrowser.tsx:668-681`（桌面表首个 `<td>`）+ 顶部 import
- Modify: `src/app/(frontend)/styles.css:2530-2552`（`.building-supply-browser__table-primary` / `__table-sub` 附近，新增 `__table-cell` / `__table-thumb` / `__table-text`）
- Test: `tests/detail-components-contract.test.ts`（`describe('detail component contracts')` 内追加）

**Interfaces:**
- Consumes: `ListingCardViewModel.coverImage: MediaViewModel | null`（域层已是「房源封面 → 楼盘封面」兜底口径）；`cardCoverProps(media, sizes, targetWidth)`（`@/lib/frontend/media-srcset`，返回 `{ src, srcSet?, sizes? }`）；`CardMediaPlaceholder({ compact })`（`@/components/frontend/ui/Media`，渲染 `<span class="media-placeholder" data-media-state="missing">`）。
- Produces: 每行首格 DOM：`<td><div class="building-supply-browser__table-cell"><span class="building-supply-browser__table-thumb"><img …>|<span class="media-placeholder"…></span><span class="building-supply-browser__table-text"><a class="building-supply-browser__table-primary">…</a><span class="building-supply-browser__table-sub">…</span></span></div></td>`。E2E 用的 `.building-supply-browser__table tbody tr`、`a[href$="/listings/<slug>"]` 选择器不受影响。

- [ ] **Step 1: 写失败测试**

`tests/detail-components-contract.test.ts` 在 `it('桌面服务端默认输出单一密度表…'` 之后追加：

```ts
  it('桌面密度表每行「房源」列带缩略图；有封面出 <img>，无封面出共享占位（OPT-095）', () => {
    const withCover = makeCard({
      id: 11,
      slug: 'with-cover',
      title: '有图房源',
      coverImage: { src: '/media/unit-a.jpg', alt: '有图房源封面', width: 1600, height: 1200 },
    })
    const withoutCover = makeCard({ id: 12, slug: 'no-cover', title: '无图房源', coverImage: null })
    const snapshot: BuildingSupplySnapshot = {
      ...LEASE_ONLY_SNAPSHOT,
      totalEffectiveListings: 2,
      resultCount: 2,
      groups: [{ ...LEASE_ONLY_SNAPSHOT.groups[0]!, listings: [withCover, withoutCover] }],
      availableGroups: [{ ...LEASE_ONLY_SNAPSHOT.availableGroups[0]!, totalEffectiveListings: 2 }],
    }
    const html = renderToStaticMarkup(
      createElement(BuildingSupplyBrowser, { snapshot, basePath: '/buildings/jingan-center', currentSearch: '' }),
    )

    const thumbs = html.match(/class="building-supply-browser__table-thumb"/g) ?? []
    expect(thumbs, '两行都要有缩略图槽位，无图行不能塌成纯文本').toHaveLength(2)
    expect(html).toMatch(/table-thumb"><img[^>]*src="\/media\/unit-a\.jpg"[^>]*alt="有图房源封面"[^>]*loading="lazy"/)
    expect(html).toContain('data-media-state="missing"')
    // 标题链接仍在（E2E 靠 a[href$="/listings/<slug>"] 取行）
    expect(html).toContain('href="/listings/with-cover"')
    expect(html).toContain('href="/listings/no-cover"')
  })
```

`MediaViewModel` 的字段：`src` 必填，`alt` 必填（string），`width` / `height` 可选——若 `makeCard` 的类型对 `coverImage` 要求 `alt`，上面已给。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-095/payload-office-platform && pnpm vitest run tests/detail-components-contract.test.ts -t "带缩略图"
```
Expected: FAIL，`expected [] to have a length of 2`。

- [ ] **Step 3: 实现组件**

`src/components/frontend/BuildingSupplyBrowser.tsx` 顶部 import 区（`import ListingCard from …` 之后）加：

```ts
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'
import { cardCoverProps } from '@/lib/frontend/media-srcset'
```

（本文件是 `'use client'`，`Media.tsx` 也是 client 组件，可直接 import；`media-srcset` 是纯函数，无 payload 依赖——`tests/detail-components-contract.test.ts` 的「不导入 payload-types 或 payload」用例会继续把关。）

把桌面表第一个 `<td>`（`{/* 标题即链接：… */}` 那段）替换为：

```tsx
                      <td>
                        {/* OPT-095：「房源」列加缩略图。取图口径就是卡片的 coverImage
                            （域层已做「房源封面 → 楼盘封面」兜底），两者都缺时给共享
                            占位——槽位恒渲染，无图行不能塌成纯文本，否则同一张表里
                            两种版式。移动端卡片视图本来就带图，这里只补桌面密度表。 */}
                        <div className="building-supply-browser__table-cell">
                          <span className="building-supply-browser__table-thumb">
                            {listing.coverImage ? (
                              <img
                                {...cardCoverProps(listing.coverImage, '56px', 320)}
                                alt={listing.coverImage.alt || listing.title}
                                loading="lazy"
                                decoding="async"
                                width={listing.coverImage.width}
                                height={listing.coverImage.height}
                              />
                            ) : (
                              <CardMediaPlaceholder compact />
                            )}
                          </span>
                          <span className="building-supply-browser__table-text">
                            {/* 标题即链接：原先整行只有最右侧那个 44px 箭头可点，用户
                                直觉上会去点标题却没反应（移动端卡片视图的标题本来就在
                                ListingCard 的整卡链接里，只有桌面密度表缺这一口）。 */}
                            <a
                              href={detailHref}
                              className="building-supply-browser__table-primary"
                              {...detailAnalyticsAttrs}
                            >
                              {listing.title}
                            </a>
                            {sub && <span className="building-supply-browser__table-sub">{sub}</span>}
                          </span>
                        </div>
                      </td>
```

- [ ] **Step 4: 实现样式**

`src/app/(frontend)/styles.css` 在 `.building-supply-browser__table-primary {` 规则**之前**插入：

```css
/* OPT-095：「房源」列 = 56×42 缩略图 + 标题/副行。缩略图槽位恒渲染（无图给
   .media-placeholder），行高由 tr 的 56 兜底，缩略图 42 高不撑行。 */
.building-supply-browser__table-cell {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
}

.building-supply-browser__table-thumb {
  flex: 0 0 56px;
  width: 56px;
  height: 42px;
  border-radius: var(--r-input); /* 8px；列表页 .bd-row__thumb 是 48 方图配 10px，56×42 横图取小一档 */
  overflow: hidden;
  background: var(--bg-subtle);
}

.building-supply-browser__table-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 缩略图槽位里的占位符：去掉 .media-placeholder 的 16px padding，28px 图标才放得下 */
.building-supply-browser__table-thumb .media-placeholder {
  padding: 0;
}

.building-supply-browser__table-text {
  flex: 1 1 auto;
  min-width: 0;
}
```

并把 `.building-supply-browser__table-primary` 的 `display: block;` 之后加一行 `overflow-wrap: anywhere;`（首列变窄 56+12px 后，长标题要能折行而不是把表撑宽）。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /e/wt-095/payload-office-platform && pnpm vitest run tests/detail-components-contract.test.ts tests/building-supply.test.ts && pnpm typecheck
```
Expected: 全 passed；typecheck 无输出。

- [ ] **Step 6: 提交**

```bash
cd /e/wt-095 && git add payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx "payload-office-platform/src/app/(frontend)/styles.css" payload-office-platform/tests/detail-components-contract.test.ts && git commit -m "feat(building-detail): 桌面供给密度表「房源」列加缩略图，缺图走共享占位（OPT-095）"
```

---

### Task 4: 闸门 + 浏览器走查 + 证据

**Files:**
- Create: `artifacts/verification/OPT-095/walkthrough-2026-09-12.md`
- Create: `artifacts/verification/OPT-095/*.png`（截图）
- Modify: `specs/work-items/OPT-095-detail-display-fixes.md`（§4 验收勾选、状态行）

- [ ] **Step 1: 全量静态闸门**

```bash
cd /e/wt-095/payload-office-platform && pnpm typecheck && pnpm lint 2>&1 | tail -5 && pnpm test:changed 2>&1 | tail -15
```
Expected: typecheck 无输出；lint `0 errors`（既有 warning 数不增加：改前先记一次基线数）；`test:changed` 全 passed。

- [ ] **Step 2: E2E 选择器自查（不跑全量 E2E）**

```bash
cd /e/wt-095/payload-office-platform && rg -n "building-supply-browser__table|service-phone|building-summary-card|table-primary" tests/e2e/
```
Expected：命中的选择器只有 `.building-supply-browser__table`、`… tbody tr`、`a[href$=…]`、`.building-supply-browser__footnote`——本次都没改。若出现按 `td > a` 直接取子元素的写法，改成 `td a.building-supply-browser__table-primary`。

- [ ] **Step 3: 起 dev server 并走查**

用 `preview_start`（`.claude/launch.json` 里加一条 `{ "name": "wt-095", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 3727, "cwd": "E:/wt-095/payload-office-platform" }`，`PORT=3727`）。走查前先确认本地库迁移到最新：`pnpm exec payload migrate:status` 无 pending。

走查清单（每条留证据：截图或 `read_page` / `innerText` 文本）：

| # | 路由 / 视口 | 判据 |
|---|---|---|
| 1 | `/shanghai/listings/<有楼盘封面的房源 slug>` 1440 | `.building-summary-card__media img` 存在且 `src` 非空；无 `data-media-state="missing"` |
| 2 | 同上 | 「房源概况」参数表出现「空调」「网络」「停车费」任一行（取该楼盘在楼盘详情「楼宇服务」里有值的字段对照） |
| 3 | `/shanghai` 1440 | `.service-phone` 的 `innerText` 为 `客服 <号码>`，单行 |
| 4 | `/shanghai` 375 | `.service-phone__prefix` 与 `__number` 的 `getComputedStyle().display === 'none'`；抽屉行仍是「客服电话 <号码>」 |
| 5 | `/shanghai/buildings/<有在租房源的楼盘 slug>` 1440 | 供给表每行 `.building-supply-browser__table-thumb` 存在；有封面行是 `<img>`、无封面行是 `.media-placeholder`；`tbody tr` 高度 ≥ 56 |
| 6 | 同上 375 | 仍是 `[data-listing-card-variant="building-supply"]` 卡片，无 `<table>` |

找 slug 的方法：`curl -s localhost:3727/shanghai/listings | grep -o 'href="/shanghai/listings/[^"]*"' | head`。

- [ ] **Step 4: 写证据文件**

`artifacts/verification/OPT-095/walkthrough-2026-09-12.md`，格式照 `artifacts/verification/OPT-094/walkthrough-2026-09-12.md`：环境行 + 三张表（对应三个改动）+ 闸门行。截图放同目录。

- [ ] **Step 5: 更新工作项状态并提交**

`specs/work-items/OPT-095-detail-display-fixes.md`：状态改为「**已实施，待合并**」，§4 勾选实际完成项。

```bash
cd /e/wt-095 && git add artifacts/verification/OPT-095/ specs/work-items/OPT-095-detail-display-fixes.md && git commit -m "docs(opt-095): 走查证据与工作项状态"
```

- [ ] **Step 6: 推送（不自动建 PR，先向用户汇报）**

```bash
cd /e/wt-095 && git push -u origin feat/opt-095-detail-display-fixes-8e61
```

推送后向用户汇报走查结果与证据路径，由用户决定是否建 PR（合并即上线）。

---

## 自审记录

- **规格覆盖**：§3 六行 → Task 1（mappers + 单测）、Task 2（ServicePhoneLink + member.css + 单测）、Task 3（BuildingSupplyBrowser + styles.css + 契约测试）；§4 验收 → Task 4。规格里「`mapListingCard` 收窄不回退」的断言已由既有 `tests/listing-card-payload-size.test.ts` 覆盖，Task 1 Step 4 把它纳入回归跑，不另写重复用例。
- **占位扫描**：无 TBD / 「适当处理」；每个代码步骤都有代码块。
- **类型一致性**：`cardCoverProps(media, sizes, targetWidth)` 签名与 `media-srcset.ts:61` 一致；`CardMediaPlaceholder({ compact })` 与 `Media.tsx:102` 一致；`MediaViewModel.alt` 为必填 string，Task 3 测试夹具已给。
