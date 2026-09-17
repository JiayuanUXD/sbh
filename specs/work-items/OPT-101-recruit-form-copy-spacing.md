# Task Packet：OPT-101 城市招募页 · 次要入口间距与表单文案收口

> 状态：**已实施，待合并**（分支 `fix/opt-101-recruit-form-copy-spacing-119f`，证据 `artifacts/verification/OPT-101/`）
> 创建日期：2026-09-17
> 来源：用户在杭州招募页（`/hangzhou`，coming-soon 面）走查后给出三条意见：
> ① 「登记找房需求」模块距离顶部的距离太小；② 表单内文案与字段收口；③ Hero 区域高一点。

---

## 1. 一句话

次要入口段紧邻灰底带时补回一份 section padding；第一步标题改「请留下联系信息」并去掉引导句；
城市路由的内嵌表单不再渲染「申请城市」；两个消费面表单卡下方的合规声明整条去掉。

## 2. 用户原话 → 落地

| 用户意见 | 落地 |
|---|---|
| 「登记找房需求」模块距离顶部太小 | `recruit.css` 新增 `.rc-section--band + .rc-section--tail { padding-top: var(--pad) }`。根因：尾注段本来 `padding-top: 0`，前提是商圈段垫在上面；商圈段 `featuredRegions` 为空时整段不渲染（`/city-partner` 则永远不渲染），尾注段直接贴着灰底带，灰卡与灰带零间距。补回后带 72 + 段 72 = 相邻 section 总留白 `--gap`(144)，与全站节奏一致 |
| 「先留下联系信息」→「请留下联系信息」 | `CITY_PARTNER_COPY.stageOneTitle` |
| 去掉「此步成功保存后……也可以直接结束。」 | 删 `stageOneHint` 键与第一步 `<header>` 里的 `<p>` |
| 去掉「申请城市」字段 | **只在城市由路由钉死的面去掉**（`lockCity`，即 `/[city]` 四条 coming-soon 路由）：此前是一个 disabled 的下拉，页面 h1 已写着城市名，纯重复。`/city-partner` **保留**：那一面没有别的城市入口（默认上海、`?city=` 可能无效需改选），e2e `city-partner-flow.spec.ts` 的无效城市用例正是靠它 |
| 去掉「提交申请不代表合作确认……」 | 两个消费面一起去掉（同一张表、同一句话，只删一面会回到「两面不一致」）；`CITY_PARTNER_COPY.note`、`.rc-aside__note` 规则随之摘除。`city-partner-page-seo.test.ts` 的四个禁词断言只禁词、不要求任何声明存在，三道闸门不受影响 |
| Hero 区域高一点 | `RecruitHero` 的 section 加 `rc-section--hero`；`.rc-page { --rc-hero-min-h: 480px }`（≤767 为 400），段 `min-height` + flex 垂直居中。此前 Hero = 72 + 文案 + 72 ≈ 320–360；现 1440 下恒 480、文案上下各留 128（`/city-partner` 144）。值是本页自选，不与首页 760 的满幅视频 Hero 对齐（不是同一档），写成变量方便调 |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `src/lib/frontend/city-partner-config.ts` | 标题改文案；删 `note` / `stageOneHint` |
| `src/components/frontend/city-partner/CityPartnerApplicationForm.tsx` | 第一步 header 只剩 step + h2；`lockCity ? null : <Field 申请城市>`；props 注释写明 `lockCity` 新语义；`cityGate = !lockCity && (...)`——锁城时页面级城市门控（无效 `?city=` / 默认城市不可申请）不再能把提交按钮灰成死结（预审发现） |
| `src/components/frontend/city/ComingSoonCityView.tsx` | 删 `<p className="rc-aside__note">` 与 `CITY_PARTNER_COPY` 引用；`selectableCities` 改为「`cities` 缺路由城市就追加」而不是「仅 `cities` 为空时兜底」——锁城表单的 `city ∈ cities` 校验从此结构上恒成立（预审发现） |
| `src/app/(frontend)/city-partner/page.tsx` | 删 `<p className="rc-aside__note">`；注释写明本页为何保留选择器 |
| `src/app/(frontend)/styles/recruit.css` | 新增相邻选择器规则；`.rc-page { --rc-hero-min-h: 480px }`（≤767 档 400）+ `.rc-section--hero { min-height; flex 垂直居中 }`；删 `.rc-aside__note` 规则（grep 零消费方，非运行时注入） |
| `src/components/frontend/city-partner/RecruitSecondaryCta.tsx` | 文件头注释同步 |
| `src/components/frontend/city-partner/RecruitHero.tsx` | section 加 `rc-section--hero` 修饰类 |
| `tests/city-partner-form-dom.test.ts` | +3：lockCity 下 `#partner-city` 不在 DOM、header 无 `<p>`、请求体仍带 `city: 'hangzhou'`；lockCity + 两个城市门控 prop 同时给时按钮不灰、无城市错误、照常提交；非 lockCity 下选择器仍在且非 disabled。三处重复的填表/提交序列抽成 `fillStageOne()` / `submitForm()` |
| `tests/coming-soon-city-view.test.ts` | 整页渲染断言表单在、`#partner-city` 不在（钉住路由面的 `lockCity` 接线） |
| `tests/e2e/city-partner-flow.spec.ts` | +4 断言（守层叠结果，不守 CSS 源码文本）：尾注 `paddingTop === '72px'`；塞一个空 `section` 到前面后回到 `'0px'`（钉住 `+` 组合器）；Hero `minHeight === '480px'`；375 视口下 `'400px'` |
| `scripts/verification/opt101-recruit-shots.ts` | 一次性取证脚本 |

不动：提交链路 / 请求体结构 / 同源守卫 / 埋点 / `/city-partner` 的城市选择逻辑 / 商圈段存在时的尾注间距（仍是 1×--pad）。

## 4. 验收

- [x] `typecheck` 干净（先 `generate:types`，本地 `payload-types.ts` 落后于 OPT-097）
- [x] `lint` 0 错误（35 条既有 warning）
- [x] `test:changed`：73 文件 / 725 用例全绿（含新增 2 条）
- [x] 浏览器 `/hangzhou` @1024 / 1440 / 375：`tailPaddingTop` 0 → **72px**，带底到首卡 **72px**，无横向溢出；表单无 `#partner-city`、header 无 `<p>`、h2 = 「请留下联系信息」；页面无「提交申请不代表合作确认」文本
- [x] 浏览器 `/hangzhou` 真实提交：填姓名/手机号/身份/勾选 → `POST /api/city-partner-applications` **201** `{ok:true}` → 进第二步；本地库 `city_partner_applications` 落一行 `city_slug = hangzhou`（走查后已删除该行）
- [x] 浏览器 `/city-partner?city=hangzhou` @1440 / 375：选择器仍在（value hangzhou、非 disabled、下拉三角 `backgroundImage !== 'none'`）；h1 恰 1 个、canonical 无 query；尾注 padding 同为 72
- [x] 浏览器 Hero @1440：两页均 480 高、文案垂直居中（上下 inset 128 / 144）；@375：`/hangzhou` 434（文案撑高 > 400 下限）、`/city-partner` 400；无横向溢出
- [ ] CI 三项（PR 后）
- [ ] 线上走查（合并部署后）

- [x] 本地 e2e `city-partner-flow.spec.ts` 5/5 通过（对着 3717 dev server，含上面 4 条新断言）
- [x] `/ship` 预审：checklist 两遍无发现；testing / maintainability 两个专项各 4 / 3 条，全部已修（锁城门控死结、路由城市结构性入候选、组合器反向断言、≤767 Hero 断言、测试 DRY、本表同步）

证据：`artifacts/verification/OPT-101/`（7 张 PNG + `probe.json`）。

## 5. Hero 背景图（用户问「支持配置么」）

**支持，且是既有能力**：后台「城市站点配置」→ 该城市 → 「首页内容」标签 → 「Hero 背景图」
（`CitySiteProfiles.heroMedia`，只允许图片）。同一张图**同时**用于已开城首页 Hero（视频封面 / 降级底图）
与未开城招募页 Hero。招募页上它按 `.city-coming-soon__media` 渲染：`position:absolute; inset:0;
object-fit: cover; opacity: .18`——即一张 18% 不透明度的满幅底纹，文字在其上层，
不是首页那种满幅深色图 + 白字。`/city-partner`（全局面）不挂背景图。
本地库 7 个 profile 均未配图，本项未对「配了图之后的观感」取证；要改成更强的图片表现
（不透明 + 遮罩 + 反白文字）属另一项设计改动。

## 6. 不在本项内

- 商圈段存在时的尾注间距（仍按稿子 1×--pad）。要改需先有一座 `featuredRegions` 非空的城市可看。
- `/city-partner` 去掉城市选择器——那是信息架构改动（要先给这一面另一个城市入口）。
- 表单第二步文案。
