# OPT-092 浏览器验收记录（2026-09-11）

环境：worktree `E:\wt-navpage`，`next dev -p 3723`，库 `sbh_dev_navpage`（以本地 `postgres` 为模板克隆，
含 3 条 pages：about / privacy-policy / home，均 published）。迁移 `20260911_031639_nav_page_target`
已在该库执行（13ms）。登录账号 `e2e-adm@example.com`（`scripts/seed.ts` 公开夹具）。

## 0. 线上现状取证（修复前）

`curl https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/` 解析页脚：

```
[COL] 浏览      在租房源 / 找写字楼 / 资讯中心
[COL] 按类型    传统办公 / 联合办公 / 整层办公
[COL] 服务      委托找房 / 投放房源
[COL] 公司动态  加入我们 -> /city-partner?city=shanghai   ← 错链，用城市合伙人顶替
```

4 组 + 品牌 = 5 个格子，`grid-template-columns: 1.6fr 1fr 1fr 1fr` 只有 4 轨 → 第 4 组掉到第二行第一列。

## 1. 后台：配置「内容页」链接（三步铁证）

1. 「站点设置 → 导航 → 页脚分组」点「添加 Footer Column」，分组标题填「公司动态」，添加 Link，
   跳转目标下拉最后一项为「内容页（/pages/…，在旁边的「内容页」里选具体页面）」；选中后出现
   「内容页」关系选择器，列出 关于我们 / 隐私政策 / 中高端商务办公租赁平台首页。选「关于我们」，显示文字填「加入我们」，保存。
2. 抓包：`POST /api/globals/site-settings?depth=0&fallback-locale=null → 200`，响应
   `footerColumns[3] = {title:"公司动态", links:[{target:"page", page:1, label:"加入我们", visible:true}]}`。
3. PG：
   ```
   title    | target | page_id | label    | visible
   公司动态 | page   | 1       | 加入我们 | t
   ```
4. 强刷后台重新进「导航」tab：`footerColumns-3-links-row-0` 回显 title=公司动态、target=内容页、
   page=关于我们、label=加入我们、visible=true。

### 校验

清空「内容页」选择后保存：`POST … → 400 Bad Request`，字段红字
「跳转目标选了「内容页」，必须指定一个页面」，toast「下面的字段是无效的：导航 > 页脚分组 4 > 分组内链接 1 > 内容页」。

## 2. 前台页脚（`document.styleSheets.length === 2`，样式已套）

| 视口 | `grid-template-columns` | 品牌 | 四组位置 |
|---|---|---|---|
| 1440 | `343 214 214 214 214` | x=48 y=5160 w=343 | 浏览 x=423 / 按类型 x=669 / 服务 x=916 / 公司动态 x=1162，**全部 y=5160 同一行** |
| 1024 | `456 456` | 整行 w=945 | 浏览+按类型 y=1453；服务+公司动态 y=1604（2×2） |
| 768 | `328 328` | 整行 w=689 | 同上 2×2 |
| 375 | `343` | w=343 | 四组纵向单列，`body.scrollWidth = 375` 无横向溢出 |

`--footer-cols` 内联值 = 4。截图：`footer-1440.png` / `footer-1024.png` / `footer-375.png`（Playwright 元素截图）。

「加入我们」href = `/pages/about`；点击后 `location = /pages/about`，`<h1>` 专注上海中高端商务办公租赁，
面包屑「关于我们」，canonical `http://localhost:3723/pages/about`。

## 3. 页面状态联动

- `PATCH /api/pages/1 {status:"draft"}` → 200；刷新 `/`：页脚只剩 浏览/按类型/服务，`--footer-cols = 3`，
  `a[href="/pages/about"]` 不存在（唯一链接不渲染 → 空组整体跳过）。
- `PATCH … {status:"published"}` → 200；刷新：四组恢复，`--footer-cols = 4`，链接文本「加入我们」。

（`next dev` 不持有 `unstable_cache`，此处验的是渲染层过滤；缓存失效的钩子调用由
`tests/nav-page-target.test.ts` 锁定。）

## 4. 主导航同源

REST 追加 `mainNav[7] = {target:"page", page:1, label:"关于我们"}` → 200；刷新 `/`：
`.site-nav a` 末项「关于我们 -> /pages/about」。随后已还原为 7 项。

## 5. 控制台

仅 `GET /api/media/file/logo_sbkj.svg → 500`（×3）：本 worktree 本地磁盘没有该 media 文件，
与本次改动无关（克隆库引用的媒体不在本树）。无其它错误。

## 6. 静态闸门

- `pnpm typecheck` 通过
- `pnpm lint` 0 error（24 个既有 `no-img-element` warning）
- `pnpm test` 358 files / 4871 passed / 41 skipped
- `pnpm migrate:dry-run`：本迁移 `up/down/json: true, no forbidden patterns`（4 条 warning 全部来自历史迁移）
