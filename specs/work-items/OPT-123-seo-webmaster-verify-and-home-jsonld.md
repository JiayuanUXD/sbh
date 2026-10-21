# Task Packet：OPT-123 站长平台验证标记 + 首页站点结构化数据

> 状态：**待合并**（分支 `feat/seo-site-verify-home-jsonld-7c4e`）
> 创建日期：2026-10-21
> 来源：用户「如果想让搜索引擎能够比较容易的搜索到网站，还需要做哪些优化」→「按照你的建议开始」

---

## 1. 一句话

让站点能通过 Google / 百度 / Bing 的站长平台验证，并给城市首页补上 Organization + WebSite 结构化数据。

## 2. 线上实测（2026-10-21，`shangban.cc`）

| 现象 | 影响 |
|---|---|
| 首页没有任何 JSON-LD | 搜索引擎拿不到「域名 ↔ 品牌」的明确声明 |
| 页面里没有任何站长平台验证 meta | 要用 HTML 标签方式验证站点所有权时没有出口 |
| `robots.txt` / `sitemap.xml` / canonical / H1 / `www` 301 | 正常，无需改 |

## 3. 做了什么

- `lib/frontend/site-verification.ts`：从服务端运行时环境变量 `SITE_VERIFY_GOOGLE` / `SITE_VERIFY_BAIDU` / `SITE_VERIFY_BING` 生成 Next `metadata.verification`。验证码不是密钥，但随账号变化，所以不写死在代码里；拿到验证码后在 CloudRun 控制台配服务级环境变量、重启即可，不用改代码重新发版。非法字符（引号、尖括号、空白）一律丢弃，避免写坏 meta 标签。全部缺省时不输出任何标签。
- `(frontend)/layout.tsx`：把上面的结果并进根 `metadata`。
- `lib/frontend/site-jsonld.ts` + `CityHomeView`：城市首页输出 `@graph`（Organization + WebSite），名称取后台「站点设置」的 `siteName`，logo 取站点设置 logo（补成绝对 URL）。
- 测试：`tests/site-verification.test.ts`、`tests/site-jsonld.test.ts`。

## 4. 刻意没做

| 项 | 原因 |
|---|---|
| `SearchAction` | Google 已停用站内搜索框富媒体结果，写了没有收益 |
| 地址 / 电话 / `sameAs` | 站内没有一份经确认的权威资料，不虚构 |
| 站长平台账号注册、sitemap 提交、百度主动推送 | 要账号登录与人工授权，由运营操作；清单见交付说明 |
| 品牌名统一 | 沿用后台「站点设置」的 `siteName`，页脚与 title 不一致的问题仍待产品拍板 |

## 5. 上线后要做

1. 在三个站长平台各自添加站点 `https://shangban.cc`，选「HTML 标签」验证，把给出的 content 值配成对应的环境变量（见 `.env.example`），重启服务后点验证。
2. 验证通过后提交 `https://shangban.cc/sitemap.xml`。
3. 在 Google 的富媒体结果测试里贴首页，确认 Organization / WebSite 无报错。

## 6. 验收

- 新增 2 个测试文件 8 条用例通过；`city-home-view` 等相关用例通过；改动文件 `tsc` / `eslint` 干净。
- 本地隔离库（`sbh_dev_seo_content`）浏览器实测：`/shanghai` 有且仅有 1 段首页 JSON-LD、可被解析、H1 仍为 1 个。
- **未验证**：三个验证 meta 的端到端输出（沙箱禁止改 dev 启动配置，没法带环境变量起服务，只有单测覆盖）；生产环境表现；Google 富媒体结果测试。
- 全量 `tsc` 在本机仍有 15 条与本改动无关的报错（`building` 的 `grade` 枚举类型、`import-task.ts` 等），不在本工作项范围。
