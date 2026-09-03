# MP-106 楼盘闭环与前端 UI 高保真重塑实施计划

> **状态**：草案已就绪，待评审  
> **上游设计**：`specs/work-items/MP-001-miniprogram-mvp-design.md`、`specs/work-items/MP-002-miniprogram-delivery-roadmap.md`  
> **设计事实源**：`docs/xcx/SBH小程序页面设计/uploads/miniprogram-design.md` 与 `docs/xcx/SBH小程序页面设计/SBH 小程序页面.dc.html`  
> **技术栈**：原生微信小程序（TypeScript 5.9 + WXML + WXSS）、Next.js 16 + Payload 3.86 服务端 Mini API、Vitest 4 单元测试

---

## 1. 背景与核心问题

1. **当前现状与痛点**：
   * 在 MP-105 阶段完成 MVP 底层管道与环境闭环后，现有前台 UI 与设计规范差距较大：信息密度失衡、缺少移动优先的白卡与间距节奏、组件视觉简陋、缺少品牌 Hero 叙事与微交互按压态。
   * 用户明确提出指示：“**在规格设计里面加入前端 UI 还原任务，目前的 UI 还原度和体验太差**”。
2. **商办核心业务价值**：
   * B2B 商办租赁的典型决策路径是“**先挑楼、再看具体在租房源**”或“**看中某房源后深入考察楼盘硬件与交通**”。
   * 楼盘字典是区别于 C2C 住宅平台的核心差异化资产。MP-106 必须完整交付“楼盘列表-楼盘详情-房源聚合”的业务闭环，并与房源实现无缝双向穿梭。

---

## 2. 视觉与交互重塑原则（对照 SBH 小程序页面画布）

### 2.1 地基与卡块容器系统
* **底色**：统一使用 `#f2f2f4`（移动端专用灰底，衬托白色卡块）。
* **白色圆角卡块**：
  * 背景 `#ffffff`，圆角 **`8px`**，左右边距 **`12px`**，卡块间距 **`10px`**，内边距 **`14px`**。
  * 块内多项分组使用 `1px solid #e5e5e7` 横线分隔，禁止嵌套多层白卡。
* **圆角三档分级**（按交互属性划分）：
  * **3px 标签**：不可点击的只读标签（房源特色、状态角标、楼盘等级），读起来像文字；
  * **6px 矩形**：容器内可点击控件（卡内图片、输入框、筛选 chip、提交按钮、面积格）；
  * **999px 胶囊**：仅用于底部固定操作栏的主 CTA（如“预约看房”、“找顾问问楼”），一屏最多一个，视觉凸显。

### 2.2 字号阶与数字
* **字号阶**：
  * 详情大单价 `26px/600`，Hero 标题 `23px/600`，价格 `19px/600`，卡块大标题 `17px/600`，列表卡标题 `15px/600`，正文 `13px`，辅助/元信息 `12px`，微标签 `10px`。
* **数字处理**：
  * 中文走系统默认黑体（iOS PingFang SC / Android 系统黑体）；
  * 价格、面积、工位、层数、日期等全部挂载 `.num` 类，强制使用 `font-variant-numeric: tabular-nums` 等宽对齐。

### 2.3 交互与按压反馈
* 取消 Web 端 hover 悬浮逻辑，移动端全面配置 `hover-class`（按压态 `scale(0.98)` + 底色微调下沉一档，延迟 `hover-stay-time="70"` 触发）。
* 底部操作栏严格适配 `padding-bottom: env(safe-area-inset-bottom)`。

---

## 3. 功能架构与页面清单

```text
tabBar（4 项标准导航）
├── 首页 (pages/home/index)         Hero 渐变 + 悬浮搜索 + 双快捷入口 + 精选好楼 + 推荐流
├── 找房 (pages/listings/index)     顶部搜索 + 吸顶筛选 + 置顶单位换算 + 真实房源流 + 放宽建议空态
├── 楼盘 (pages/buildings/index)    [新增] 楼盘搜索 + 等级/年份筛选 + 在租统计卡 + 暂无在租独立下沉
└── 我的 (pages/foundation/index)   [占位] 收藏、浏览历史、城市切换与设置入口
```

---

## 4. 任务拆解与实施步骤

### Task 1: 视觉 Token 体系与基础原子组件重构

**包含文件：**
- 修改：`sbh-miniprogram/miniprogram/styles/tokens.wxss`
- 修改：`sbh-miniprogram/miniprogram/app.wxss`
- 修改：`sbh-miniprogram/miniprogram/app.json`（更新 TabBar 为 4 项，配置楼盘图标）
- 修改：`sbh-miniprogram/miniprogram/components/listing-card/`
- 修改：`sbh-miniprogram/miniprogram/components/spec-grid/`
- 测试：`sbh-miniprogram/tests/design-tokens.test.ts`
- 测试：`sbh-miniprogram/tests/components.test.ts`

**步骤：**
- [ ] **1.1 Token 与全局样式对齐**：在 `tokens.wxss` 中严格定义 8px/6px/3px 圆角规范、12px/10px/14px 间距规范、26/23/19/17/15/13/12/10 字号阶与按压态 class。
- [ ] **1.2 房源卡片 (`listing-card`) 高保真重构**：
  * 左图右文布局：左侧 `112×84px` 图片（圆角 6px），左上角半透明黑色角标（如“新上”）；
  * 右侧信息：`15px/600` 标题（最多两行），`12px` 面积/层数/得房率（等宽数字），`12px` 商圈与地铁距离；
  * 价格行：`19px/600` 黑色单价 + `12px` 单位说明；
  * 底部标签：紧凑排列最多 3–4 个 `10px/3px` 圆角灰色标签。
- [ ] **1.3 规格网格 (`spec-grid`) 重构**：改为 4 列严格等分网格，上标签 `12px/--ink-3`，下数值 `17px/600` 黑色等宽数字；数值缺失显示 `—`，保持网格严密对齐。
- [ ] **1.4 更新 TabBar**：在 `app.json` 注册 4 个 Tab（首页、找房、楼盘、我的），绘制/更新简洁线性 SVG/PNG 图标。

---

### Task 2: 服务端 Mini API 楼盘门面扩展与契约

**包含文件：**
- 修改：`payload-office-platform/src/domain/mini-program/contracts.ts`
- 修改：`payload-office-platform/src/domain/mini-program/mappers.ts`
- 新增：`payload-office-platform/src/app/api/mini/v1/buildings/route.ts`
- 新增：`payload-office-platform/src/app/api/mini/v1/buildings/[slug]/route.ts`
- 修改：`payload-office-platform/src/app/api/mini/v1/home/route.ts`
- 测试：`payload-office-platform/tests/mini-api-buildings.test.ts`
- 测试：`payload-office-platform/tests/mini-api-contracts.test.ts`

**步骤：**
- [ ] **2.1 定义楼盘 DTO 契约**：在 `contracts.ts` 中增加 `MiniBuildingCard`、`MiniBuildingsData`、`MiniBuildingDetailData`。
- [ ] **2.2 实现楼盘列表接口 (`GET /api/mini/v1/buildings`)**：
  * 复用现有 `domain/public-catalog/building-search.ts` 领域逻辑；
  * 支持 `city`、`district`、`grade`、`page`、`pageSize`、`keyword` 筛选；
  * 数据划分：返回在租房源数 > 0 的 `items`，以及在租房源数 == 0 的 `inactiveItems`（为前端下沉分组服务）。
- [ ] **2.3 实现楼盘详情接口 (`GET /api/mini/v1/buildings/:slug`)**：
  * 返回楼盘建筑参数（竣工年、层数、标准层面积、电梯、车位、物业公司、物业费、空置率）；
  * 返回交通配套（周边最近地铁站与距离、高架距离）；
  * 聚合该楼盘下所有有效在租房源列表，并按面积段分组（如 `<300㎡`、`300–1,000㎡`、`>1,000㎡`）；
  * 返回同商圈可比楼盘推荐列表（3 项）。
- [ ] **2.4 扩展首页接口**：在 `GET /api/mini/v1/home` 响应中增加 `featuredBuildings`（精选好楼推荐 3 套）。
- [ ] **2.5 编写 API 契约与单元测试**：编写红绿测试，确保 0 数据库迁移，字段完全通过 Zod/类型校验。

---

### Task 3: 首页与找房列表页前端 UI 高保真翻新

**包含文件：**
- 修改：`sbh-miniprogram/miniprogram/pages/home/index.wxml`
- 修改：`sbh-miniprogram/miniprogram/pages/home/index.wxss`
- 修改：`sbh-miniprogram/miniprogram/pages/home/index.ts`
- 修改：`sbh-miniprogram/miniprogram/pages/listings/index.wxml`
- 修改：`sbh-miniprogram/miniprogram/pages/listings/index.wxss`
- 修改：`sbh-miniprogram/miniprogram/components/filter-bar/`
- 修改：`sbh-miniprogram/miniprogram/components/filter-sheet/`
- 测试：`sbh-miniprogram/tests/home-page-contract.test.ts`
- 测试：`sbh-miniprogram/tests/listings-page-contract.test.ts`

**步骤：**
- [ ] **3.1 首页 UI 翻新**：
  * 顶部 212px 深灰质感渐变 Hero（"把每一平米算清楚" / "上海 · 在租房源实时同步"）；
  * 悬浮搜索卡：`-29px` 负边距叠在 Hero 上，左侧城市选择（"上海 ▾"）+ 浅灰分割线 + 占位提示文案 + 右侧 42px 蓝色搜索图标按钮；
  * 双入口白卡：并排展示“委托找房（说需求，顾问帮你筛）”与“售卖专区”；
  * “精选好楼”横向卡片区：展示 3 栋好楼，左/上图右/下文，支持点击直接跳转楼盘详情；
  * 房源推荐流：支持 Tab 切换，渲染重构后的左图右文卡片。
- [ ] **3.2 找房列表页 UI 翻新**：
  * 顶部嵌入浅灰椭圆搜索条（高 34px）；
  * 44px 吸顶筛选栏：位置 ▾、价格 ▾、面积 ▾、筛选 ⚙︎(激活数蓝色胶囊角标)；
  * 列表头部展示“168 套符合条件”与排序下拉；
  * 房源列表一屏可见 3–4 张卡，视觉紧凑；
- [ ] **3.3 筛选抽屉 (`filter-sheet`) 深度重做**：
  * **租金单位置顶分段选择器**：分段控件展示“元/㎡·天”、“元/㎡·月”、“元/月·套”；下方带浅灰警告提示框：“切换单位会改变结果集，三者无法互相换算”；
  * 单价区间滑动条/双端调节；
  * 面积段选择 Chip 矩阵（`<300㎡`、`300–1000`、`1000–2000` 等）；
  * 押付方式、免租期选择 Chip；
  * “仅看含物业费报价”开关切换行；
  * 底部固定按钮：左侧“清空”、右侧主按钮“查看 168 套”。
- [ ] **3.4 筛选智能空态**：
  * 无结果时展示具体放宽建议卡（单价放宽建议 + 套数链接、面积放宽建议 + 套数链接、范围扩大建议）；
  * 兜底“说需求，让顾问帮你找”表单引导。

---

### Task 4: 房源详情页与留资弹层 UI 高保真翻新

**包含文件：**
- 修改：`sbh-miniprogram/miniprogram/pages/listing-detail/index.wxml`
- 修改：`sbh-miniprogram/miniprogram/pages/listing-detail/index.wxss`
- 修改：`sbh-miniprogram/miniprogram/components/detail-gallery/`
- 修改：`sbh-miniprogram/miniprogram/components/monthly-cost-card/`
- 修改：`sbh-miniprogram/miniprogram/components/inquiry-sheet/`
- 测试：`sbh-miniprogram/tests/listing-detail-page-contract.test.ts`
- 测试：`sbh-miniprogram/tests/inquiry-sheet.test.ts`

**步骤：**
- [ ] **4.1 画廊组件重构**：高度设定为 230px，左下角增加黑色半透明“户型图·平面图”标签，右下角展示“1 / 12”数字胶囊角标。
- [ ] **4.2 价格与成本排版**：
  * 主价格行：左侧 `26px/600` 大单价，右侧对齐“月租估算 ¥252,960”；
  * 下方次信息展示月租计算公式与物业费明细（`= 6.8 × 1,240 ㎡ × 30 天，未含物业费 ¥26 /㎡·月`）；
  * 核验条：浅灰分割线展示“状态核验于 2 天前 ｜ 编号 SH-020486”。
- [ ] **4.3 规格与概况白卡**：
  * 2 行 4 列规格网格对齐（建筑面积、得房率、层高、工位数 / 物业费、免租期、押付、起租期）；
  * 概况行项：左右两端对齐，中间细线分隔（交付标准、可分割、空调、工商注册、车位）；
  * 房源描述：卡片内增加“展开全部 ›”折叠交互。
- [ ] **4.4 所在楼盘卡片**：
  * 头部标题“所在楼盘 ｜ 楼盘详情 ›”；
  * 楼盘缩略图（64×64px）+ 楼盘名 + 等级/年份/层数/在租套数；
  * 静态地图位置示意图 + 地铁距离与高架距离；
  * 点击直达楼盘详情页。
- [ ] **4.5 同楼盘其他房源流**：展示同楼盘关联在租房源列表（缩略图、层数户型、面积、单价）。
- [ ] **4.6 底部固定操作栏**：高 56px + 安全区底边距，左侧为 44px 收藏与分享按钮，右侧为全宽蓝色胶囊“预约看房”主 CTA。
- [ ] **4.7 留资弹层 (`inquiry-sheet`) 重塑**：
  * 自动带入当前房源卡片摘要（房源名、面积、单价、月租估算、免租期）；
  * 期望入驻时间选择 Chip（越快越好、1 个月内、1–3 个月、还在看）；
  * 手机号授权行（支持一键授权与手工输入）；
  * 顾问联系服务承诺与隐私政策协议链接。

---

### Task 5: [新增] 楼盘列表页 (`pages/buildings/index`)

**包含文件：**
- 新增：`sbh-miniprogram/miniprogram/pages/buildings/index.ts`
- 新增：`sbh-miniprogram/miniprogram/pages/buildings/index.wxml`
- 新增：`sbh-miniprogram/miniprogram/pages/buildings/index.wxss`
- 新增：`sbh-miniprogram/miniprogram/pages/buildings/index.json`
- 新增：`sbh-miniprogram/miniprogram/components/building-card/`
- 测试：`sbh-miniprogram/tests/buildings-page-contract.test.ts`

**步骤：**
- [ ] **5.1 楼盘卡片组件 (`building-card`)**：
  * 左侧 `96×72px` 封面图（圆角 6px）；
  * 右侧信息：`15px/600` 楼盘名称，`12px` 等级/竣工年份/总层数/得房率，`12px` 区域与最近地铁距离；
  * 底部在租信息：`在租 14 套 · 单价 10.2–13.8 元/㎡·天`；
  * 按压反馈与点击事件处理。
- [ ] **5.2 楼盘列表页结构实现**：
  * 吸顶筛选行（区域 ▾、等级 ▾、竣工年份 ▾、排序 ▾）；
  * 统计栏：展示“收录 613 个 · 其中 486 个有在租房源”；
  * 在租楼盘卡块分组；
  * **“暂无在租 · 可留资等通知”独立分组**：下沉到列表下方，透明度降为 `0.72`，不隐藏也不混排，单卡展示“留资”按钮；
  * 下拉刷新与触底加载更多。

---

### Task 6: [新增] 楼盘详情页 (`pages/building-detail/index`)

**包含文件：**
- 新增：`sbh-miniprogram/miniprogram/pages/building-detail/index.ts`
- 新增：`sbh-miniprogram/miniprogram/pages/building-detail/index.wxml`
- 新增：`sbh-miniprogram/miniprogram/pages/building-detail/index.wxss`
- 新增：`sbh-miniprogram/miniprogram/pages/building-detail/index.json`
- 测试：`sbh-miniprogram/tests/building-detail-page-contract.test.ts`

**步骤：**
- [ ] **6.1 页面头部与画廊**：200px 楼体大图画廊，右下角胶囊计数（`1 / 8`）；
- [ ] **6.2 楼盘名称与标签**：`19px/600` 楼盘名称，商圈地址，标签排（甲级、地铁上盖、LEED 认证）；
- [ ] **6.3 核心参数 4 格**：在租套数、单价区间、物业费、空置率；
- [ ] **6.4 在租房源分组展示**：
  * 按面积段分块（例如 `1,000 ㎡ 以上 · 4 套`、`300–1,000 ㎡ · 5 套`）；
  * 紧凑房源小卡（72×56px 图片、层数、面积、单价），点击直达房源详情；
  * 底部“查看全部 N 套在租”按钮；
- [ ] **6.5 楼盘详细参数**：白卡列表展示竣工年、总层数/标准层、电梯数、车位数、物业公司；
- [ ] **6.6 位置与通勤**：静态交通示意图 + 周边地铁站步行时间、高架距离、机场耗时；
- [ ] **6.7 同商圈可比楼盘推荐**：横向 3 栋同商圈楼盘卡；
- [ ] **6.8 底部固定操作栏**：左侧收藏按钮，中间“看全部 N 套”次按钮，右侧“找顾问问楼”主胶囊 CTA。

---

### Task 7: 页面穿梭打通、DevTools 自动化与真机走查

**包含文件：**
- 修改：`sbh-miniprogram/scripts/devtools-smoke.mjs`
- 修改：`sbh-miniprogram/scripts/task4-acceptance-runner.mjs`
- 测试：小程序全量单测、TypeScript 编译检查

**步骤：**
- [ ] **7.1 双向路由打通**：
  * 房源详情页 -> 所在楼盘卡点击跳转 `pages/building-detail/index?slug=...`；
  * 楼盘详情页 -> 在租房源点击跳转 `pages/listing-detail/index?slug=...`；
  * 首页 -> 精选好楼点击直达楼盘详情；
  * 首页/找房 -> 搜索框支持按楼盘名模糊搜楼盘。
- [ ] **7.2 更新自动化测试**：
  * 增加楼盘列表与详情的页面契约单测；
  * 更新 DevTools 冒烟与验收脚本，加入楼盘页面的加载与点击穿梭断言；
- [ ] **7.3 产出高保真截图与对比报告**：
  * 在微信开发者工具中自动化跑通并输出全新设计的全套截图；
  * 确认视觉还原度（圆角、间距、字体、色彩、对比度）严格符合 `miniprogram-design.md`。

---

## 5. 验收门准则

1. **视觉一致性**：所有页面严格遵循 `#f2f2f4` 灰底、8px 白卡、6px 图片/输入、3px 标签、999px 底部胶囊；无多余彩标与装饰性色彩。
2. **完整双向闭环**：用户可从首页/搜索/找房列表看到楼盘信息并进入楼盘详情；在楼盘详情可浏览所有在租房源并跳转房源详情。
3. **数据真实与健壮性**：楼盘无在租房源时展示下沉保留分组与留资通知；房源无所在楼盘时平稳降级，不抛出异常。
4. **质量门通过**：全量单元测试通过、双 TypeScript 配置通过、`project:check` 静态检查通过、DevTools 自动化验收全绿。
