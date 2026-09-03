# Task Packet：OPT-065 站点缺 favicon，每个页面控制台常驻一条 404

> 状态：**已修复**
> 创建日期：2026-09-02
> 来源：OPT-064 生产走查时被这条无关 404 干扰过判断
> 相关：PR #125（OPT-064b）之后独立开工，与埋点无关
> ⚠️ **编号撞号（事后发现）**：`OPT-064-analytics-dashboard.md` 早在 2026-09-01
> （PR #117）就在文件头声明占用了 065/066/067，其 §6.2「业务日报页」即 OPT-065。
> 本文件开工时只查了 `specs/work-items/` 的**文件名**，没读已有文件里的编号占用声明，
> 于是同号。两边均已上线，不改号；**065 作废不再复用**，下一个新编号从 068 起。

---

## 1. 一句话

生产站点没有任何 `<link rel="icon">` 声明，浏览器回落去取 `/favicon.ico` 拿到 404，
每个页面的控制台都常驻一条 `Failed to load resource: 404`。

## 2. 证据（修复前）

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/favicon.ico
# 404
```

页面内 `document.querySelectorAll('link[rel*="icon"], link[rel="manifest"]')` 返回空数组。

## 3. 为什么值得单独修

这条 404 本身不影响功能，代价在**排查噪音**：控制台里长期躺着一条与当前改动无关的
红字，每次走查都要先花一步把它排除掉。OPT-064 排查采集脚本时就吃过这个亏。

`tests/e2e/` 里有多个 spec 断言「控制台零错误」，补上图标后这些 spec 只会更稳，
不需要改。

## 4. 修法

Next 16 App Router 的 icon 文件约定：`src/app/` 下放对应文件，Next 自动注入 `<link>`。
本项放三份：

| 文件 | 作用 |
|---|---|
| `src/app/icon.svg` | 现代浏览器首选，矢量任意尺寸清晰。**三份资产的唯一事实源** |
| `src/app/favicon.ico` | 16/32/48 三尺寸。留着它是因为爬虫、RSS 阅读器这类客户端会**无视 `<link>` 直接打 `/favicon.ico`** |
| `src/app/apple-icon.png` | 180×180，iOS 主屏。方角不透明——圆角由系统遮罩负责，留透明圆角会露黑边 |

`pnpm icons:build`（`scripts/generate-icons.mjs`）从 SVG 重新生成后两份。改了 SVG 一定要跑，
否则 `.ico` 还是旧图——Next 的文件约定只做「有什么文件注入什么 link」，不做格式转换。

## 5. 图标设计

天际线塔楼：三段错落白色塔楼 + 楼层横缝，压在 `--accent` `#0071e3` 圆角方块上。

两个不显然的决定：

- **配色取自 `(frontend)/styles.css` 的现行 token**，不是早期的奶油+金色。该体系已在
  OPT-035 整体换成 Apple 风蓝/灰（`--bg` `#f5f5f7` / `--ink` `#1d1d1f` / `--accent` `#0071e3`），
  `--color-copper` 之类只是保留的别名，现在全部指向蓝色。
- **没有用站点 logo 派生**：生产 `SiteSettings.logo` 是 `null`（页头渲染的是文字站名），
  而且 `icon.*` 是构建期静态文件，本来也拿不到运行期 DB 里的媒体。

小尺寸下楼层横缝会糊掉、只剩塔楼轮廓，这是刻意的：16px 靠轮廓识别，不靠细节。
备选过「商」字标，16px 下 11 笔糊成一团，弃用。

## 6. 验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' <站点>/favicon.ico   # 期望 200
```

页面内 `link[rel*="icon"]` 应返回 `icon.svg` / `favicon.ico` / `apple-touch-icon` 三条，
且控制台无 404。

## 7. 不在范围内

`site.webmanifest`。当前没有 PWA 需求，缺它不产生任何控制台错误——原始报告里提到
`link[rel="manifest"]` 为空，只是作为「什么声明都没有」的佐证，不是要补的东西。
