# 产品需求文档索引

> 更新日期：2026-07-25

## 页面级 PRD

| 产品面 | 权威索引 | 页面数量 | 用途 |
|---|---|---:|---|
| 后台管理系统 | [`后台管理系统_MVP_页面PRD/README.md`](./后台管理系统_MVP_页面PRD/README.md) | 22 | 后台页面设计、开发与验收唯一页面基线 |
| 前台网站 | [`前台网站_MVP_页面PRD/README.md`](./前台网站_MVP_页面PRD/README.md) | 6 | 前台页面设计、开发与验收唯一页面基线 |

## 规格与实施计划

| 产品面 | Requirements | Design | Tasks |
|---|---|---|---|
| 后台管理系统 | [`../../specs/backend-mvp/requirements.md`](../../specs/backend-mvp/requirements.md) | [`../../specs/backend-mvp/design.md`](../../specs/backend-mvp/design.md) | [`../../specs/backend-mvp/tasks.md`](../../specs/backend-mvp/tasks.md) |
| 前台网站 | [`../../specs/frontend-mvp/requirements.md`](../../specs/frontend-mvp/requirements.md) | [`../../specs/frontend-mvp/design.md`](../../specs/frontend-mvp/design.md) | [`../../specs/frontend-mvp/tasks.md`](../../specs/frontend-mvp/tasks.md) |

## 历史文档

`后台管理系统_MVP_PRD.md` 为旧版汇总文档，仅保留需求演进背景，不用于当前设计、开发或验收。发生冲突时，以后台页面级 PRD 及 `specs/backend-mvp` 为准。

## 维护规则

- 页面级产品行为修改在对应页面 PRD 中维护，并同步检查上位 Requirements 和 Design。
- 跨页面数据不变量只在权威上位文档定义，页面 PRD 通过引用使用，禁止复制出不同口径。
- `specs/*/tasks.md` 只记录实施拆分与进度，不改变需求含义。
- 不在 `public/`、构建产物或应用目录中复制 PRD；如需在线浏览，应由构建或文档服务读取本目录。

