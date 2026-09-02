# OPT-065 浏览器实测记录

日期：2026-09-02
环境：本工作树 `next dev`（Next 16.2.10 / Turbopack），`mcp__Claude_Browser__*` 驱动

## 1. 修复前（生产）

```
curl -s -o /dev/null -w '%{http_code}\n' https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/favicon.ico
404
```

首页 HTML 内无任何 `link[rel*="icon"]`。`SiteSettings.logo` 为 `null`（页头渲染文字站名）。

## 2. 修复后（本地）

`/` 与 `/listings` 两个页面均注入三条声明：

```
icon           | /favicon.ico?favicon.0vfu_sklpntsy.ico     | sizes=48x48  | image/x-icon
icon           | /icon.svg?icon.0s7hcx8oe7we8.svg           | sizes=any    | image/svg+xml
apple-touch-icon | /apple-icon.png?apple-icon.43id09685kd3m.png | sizes=180x180 | image/png
```

裸路径（爬虫直接打的那条路）同样可达：

```
/favicon.ico    200 image/x-icon
/icon.svg       200 image/svg+xml
/apple-icon.png 200 image/png 2274B
```

页面正常渲染（`document.title` = 「上海中高端商务办公租赁与写字楼选址平台 · 商办租赁」），
控制台无 404。

## 3. 资产本体

见同目录 `favicon-assets.png`——直接从提交的 `favicon.ico` 容器里逐条解出 PNG 负载渲染，
不是重画的，验的是文件里到底装了什么。

## 4. 没验到的部分（如实记录）

**后台 `/admin` 未在本地验证。** 这个 worktree 里 Turbopack 解析不到 pnpm 装好的包
（`Can't resolve '@payloadcms/richtext-lexical'` 等），应用整体 500；主检出正常。

已做对照确认与本改动无关：**把三个图标文件移出 `src/app/` 后重启，应用照样 500**。

C 端的验证是在 `--config.node-linker=hoisted` 的安装布局下取得的——该布局下应用能正常渲染，
上面第 2 节的数据即出自那次。后台在两种布局下都起不来，故本地无法覆盖。
后台不是本改动的目标（Payload admin 自带 metadata），但根级 `favicon.ico` 对它同样生效，
合入后值得顺手看一眼。
