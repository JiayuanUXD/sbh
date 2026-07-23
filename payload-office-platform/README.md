# 中高端商务办公租赁平台 Payload CMS

本地 Payload CMS + Next.js 原型，用于商业办公租赁平台的后台内容管理和前台展示。

## 本地启动

```bash
pnpm install
pnpm generate:types
pnpm seed
pnpm dev
```

访问地址：

- 前台首页：http://localhost:3717
- Payload 后台：http://localhost:3717/admin
- REST API：http://localhost:3717/api
- GraphQL：http://localhost:3717/api/graphql

首次访问后台时，按 Payload 提示创建第一个管理员账号。

## 已配置内容模型

- `locations`：城市、行政区、商圈、地铁站
- `amenities`：楼宇配套与办公服务标签
- `buildings`：楼盘库
- `listings`：可租房源
- `leads`：咨询线索
- `pages`：页面内容与 SEO
- `media`：图片与媒体库
- `users`：后台管理员

## 技术选型

- Payload CMS 3
- Next.js 16
- React 19
- SQLite 本地数据库
- Lexical 富文本编辑器

生产环境建议将 SQLite 替换为 PostgreSQL，并接入对象存储、地图 API 和搜索服务。
