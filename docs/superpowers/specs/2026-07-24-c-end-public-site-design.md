# 商办租赁平台 C 端公开站 MVP 设计

日期：2026-07-24
状态：已通过设计评审，待写实现计划
关联：B 端后台 spec 见 `商办租赁平台后台管理系统_MVP_PRD.md`（复用，不在本 spec 范围）

## 1. 背景与目标

做一个面向租户（C 端）的商办办公租赁公开站，对标 executivecentre.com.cn / shangban.58.com / soolou.com/sh。租户在站上搜办公室、看房源/楼盘详情、在线询价留电。

本 spec 是平台拆分后的第一个子项目：**C 端公开站**。B 端后台（房源/线索/经纪运营）复用现有 PRD，作为支撑模块后续排期，不在本 spec 展开。

### 业务模式

聚合平台（多源房源）：房源来自多业主/经纪/品牌方，C 端留电询价 → 转入后台 `leads` → 分配经纪跟进。与现有 B 端 PRD 的线索闭环对接。

### 范围内（MVP）

- 首页（hero + 热门商圈 + 精选房源 + 类型入口）
- 房源列表 + 筛选（区域/商圈/类型/面积/预算/装修）+ 分页
- 房源详情页 + 楼盘详情页
- 在线询价/留电（写 `leads`，source=前台表单）
- SEO（meta、sitemap、JSON-LD）+ 基础性能

### 范围外（V1.1+）

- 地图找房
- 多城市（首期上海单城市）
- 预约带看日历、成交履约、财务
- 经纪人/商户独立工作台
- VR 看房、IM、电话回拨

### 假设

- 首期地理：上海单城市，URL 不带城市段；未来加城市引入 `/[city]/` 前缀
- 房源类型：沿用现有 `Listings.listingType` 枚举（传统办公室/服务式办公室/共享办公/整层办公），MVP 全展示；园区/商铺不在模型内，不涉及
- 询价流转：C 端提交写 `leads`（source=前台表单, status=new, interestedListing 关联当前房源），分配/跟进是后台职责
- 技术栈：Next.js 16 + Payload 3 + PostgreSQL（已部署 CloudBase CloudRun）+ Tailwind + 自写组件

## 2. 架构（方案 A：扩展现有 Payload 单体）

```
payload-office-platform/  (单体，已部署 CloudRun)
├─ (payload)    admin + REST/GraphQL + Local API   ← B 端后台（Payload 自带），复用
└─ (frontend)   C 端公开站                            ← 本 spec 新增
                  └─ 用 Payload Local API (payload.find/findOne) 服务端直连 DB
                     不走 HTTP，SSR 渲染，SEO 友好
```

- C 端页面全部 React Server Component，用 `payload.find()` / `payload.findOne()` 直接查库
- 询价提交走 Next.js Route Handler（`/api/inquiries`），server 端校验后用 Local API 写 `leads`
- 后台 admin 即 B 端 PRD 的落地点：房源/线索管理用 Payload admin，线索分配等增强后续 B 端迭代做

### 边界设计

C 端代码集中在 `(frontend)/` + `components/frontend/` + `lib/frontend/`，与 `(payload)/` 后台物理隔离，互不污染。未来演进到前后端分离（方案 B）时，只需把这三块搬到独立仓库，迁移成本可控。

## 3. 路由地图

| 路径 | 页面 | 数据来源 |
|------|------|---------|
| `/` | 首页：hero + 热门商圈 + 精选房源(isFeatured) + 类型入口 | Local API |
| `/listings` | 房源列表 + 筛选 + 分页 | Local API + searchParams |
| `/listings/[slug]` | 房源详情：图集、价格、户型、配套、楼盘信息、相关房源、询价 CTA | Local API findOne |
| `/buildings/[slug]` | 楼盘详情：楼盘信息 + 该楼盘下房源列表 | Local API |
| `/about`、`/contact` | 静态页（走 `pages` collection，运营可编辑） | Local API |
| `POST /api/inquiries` | 询价提交端点（校验 + 写 leads） | Local API create |

上海单城市，URL 不带城市段；未来加城市引入 `/[city]/...` 前缀，不影响现有结构。

## 4. 数据模型变更（最小）

现有 collections 已具备大部分字段：

- `Listings`：title / slug(唯一) / status / listingType / building / rent / rentUnit / area / seats / availableFrom / isFeatured / coverImage / highlights / description —— **无需改动**
- `Leads`：name / phone / company / status / district / budget / area / moveInTime / interestedListing / notes —— **缺 `source`**

| Collection | 改动 |
|-----------|------|
| `Leads` | 加 `source` 字段（select：前台表单/电话/导入/...，C 端提交默认"前台表单"）。其余字段已齐 |
| `Listings` | 无需改。SEO meta 从 title+description+coverImage 派生，不加字段（YAGNI） |
| `Buildings` | 核对有 `slug`（用于 `/buildings/[slug]`），没有就加 |
| `Locations` | 核对有 区域/商圈 层级关系，用于筛选；缺则补 |

新字段走 Payload migration（沿用 `src/migrations/` 既有模式）。

## 5. 询价流转

```
C 端详情页点"在线询价/预约看房"
  → 弹窗表单（姓名*、手机*、公司、预算、需求面积、入驻时间、留言、同意条款）
  → POST /api/inquiries (server route handler)
  → 校验：必填、手机号格式、honeypot 防刷、简单 rate-limit（按 IP）
  → payload.create({ collection:'leads', data:{ ...fields, source:'前台表单', status:'new', interestedListing } })
  → 返回成功 toast；失败显示字段级错误
  → 后台线索池出现该条（source=前台表单，未分配）→ 后续走 B 端 PRD 的分配/跟进闭环
```

## 6. 目录结构

```
payload-office-platform/
  src/
    app/
      (frontend)/                    # ← C 端公开站（本次新增）
        layout.tsx                    #   站点外壳：Header/Footer/全局 meta
        page.tsx                      #   首页（已存在，增强）
        listings/
          page.tsx                    #   列表 + 筛选（searchParams 驱动，SSR）
          [slug]/page.tsx             #   房源详情
        buildings/
          [slug]/page.tsx             #   楼盘详情（聚合房源）
        (static)/                     #   静态页路由组（不进 URL 段）
          about/page.tsx
          contact/page.tsx
        api/
          inquiries/route.ts         #   询价提交端点
        sitemap.ts / robots.ts        #   SEO
      (payload)/                      #   Payload admin + api（已存在，不动）
    components/
      frontend/                       # ← C 端组件（自写）
        Header.tsx
        Footer.tsx
        ListingCard.tsx               #   列表卡片
        FilterBar.tsx                 #   筛选条（受控，同步 URL searchParams）
        ListingGallery.tsx            #   详情图集（lightbox）
        AmenityList.tsx               #   配套标签
        InquiryModal.tsx              #   询价弹窗
        Pagination.tsx
        Breadcrumb.tsx
    lib/
      frontend/
        queries.ts                    #   Local API 查询封装（listings/buildings/locations）
        filters.ts                    #   searchParams ↔ 查询条件转换
        seo.ts                        #   metadata / JSON-LD 生成
        validation.ts                 #   询价表单校验（共享前后端）
    collections/                      #   已存在；仅 Leads 加 source、Buildings/Locations 核 slug
    migrations/                        #   新字段走 Payload migration
  public/frontend/                    #   静态资源（图标/占位图）
  scripts/
    seed-frontend.ts                  #   首页/楼盘/房源示例数据
  tests/
    e2e/                              #   Playwright 关键路径
    unit/                             #   查询/校验/seo 单元
```

## 7. 开发计划（6 阶段）

| 阶段 | 目标 | 产出 | 验收 |
|------|------|------|------|
| P0 基线 | 数据模型补齐 + seed | `Leads.source` 字段 + migration；核对 `Buildings.slug`/`Locations` 层级；`seed-frontend.ts` 填示例数据 | 后台可见 source 字段；seed 数据入库 |
| P1 列表+筛选 | 首页 + 列表页 + 筛选 | 首页 hero/精选；`/listings` 列表+筛选（区域/商圈/类型/面积/预算/装修）+分页；`ListingCard`/`FilterBar` | 按条件筛选命中正确；URL searchParams 双向同步 |
| P2 详情页 | 房源详情 + 楼盘详情 | `/listings/[slug]` 图集/价格/配套/楼盘/相关房源；`/buildings/[slug]` 聚合房源；JSON-LD | 详情数据正确；相关房源按楼盘关联 |
| P3 询价闭环 | 询价表单 + 端点 + 写 leads | `InquiryModal` + `POST /api/inquiries` 校验/防刷 + 写 `leads`(source=前台表单) | 提交后后台线索池出现该条；校验失败字段级报错 |
| P4 SEO/性能 | SEO + 性能收尾 | per-page meta、`sitemap.xml`/`robots.ts`、JSON-LD、`next/image` 图集懒加载、列表分页 prefetch | Lighthouse SEO/Performance ≥ 90；sitemap 可访问 |
| P5 测试+上线 | 测试 + 部署 | Playwright e2e（搜→详情→询价→入库）+ 单元测试；复用已有 CI deploy workflow | e2e 绿；push master 自动上线 |

依赖：P0→P1→P2→P3→P4→P5。P2/P3 可部分并行（详情页与询价弹窗独立）。复用已有 CloudRun 部署和 CI（见 `DEPLOYMENT.md` P0 已跑通），P5 不重搭基建。

## 8. 测试策略

- **单元**：`lib/frontend/filters.ts`（searchParams↔查询转换）、`validation.ts`（手机号/必填）、`seo.ts`（JSON-LD 生成）
- **e2e（Playwright）**：核心路径 `首页→列表筛选→详情→提交询价→断言 leads 表新增`；覆盖筛选边界、分页、表单校验失败
- **回归**：Payload migration + seed 跑通；后台 admin 能看到 C 端写入的 lead
- **不测**：Payload admin 本身（框架自带）、CloudBase 部署（已有 CI 冒烟）

## 9. 非功能要求

- 列表页 SSR 响应 < 2s（复杂筛选 < 5s），对齐 B 端 PRD 性能指标
- 所有 C 端页面 server 渲染，保证 SEO 可抓取
- 询价端点防刷：honeypot + 按 IP rate-limit
- 手机号在 C 端表单明文收集（用户主动提交），不入前端日志
- 复用 CloudRun 既有 `DATABASE_URL`/`PAYLOAD_SECRET`/`NODE_ENV` 服务环境变量

## 10. 风险

| 风险 | 缓解 |
|------|------|
| 单体后期 C 端要独立伸缩 | 代码物理隔离在 `(frontend)/`，迁移到独立仓库成本可控 |
| 询价端点被刷 | honeypot + IP rate-limit；必要时加图形验证（V1.1） |
| 房源上下架/改价后详情页缓存陈旧 | MVP 走 SSR 实时查询，不引入 ISR；流量起来再评估 |
| SEO 上线后才发现结构问题 | P4 专门做 meta/sitemap/JSON-LD，并在 e2e 里断言关键 meta |
