# Agent 上下文路由

本目录将长期规则按领域拆分，目标是让单个任务只加载必要上下文。

| 文件 | 何时读取 |
|---|---|
| `core.md` | 每个任务 |
| `backend.md` | Payload 后台页面、Collection、Hook、Custom View |
| `frontend.md` | C 端页面、组件、SEO、咨询和公开查询 |
| `supply.md` | 楼盘、房源、商户关系和有效供给 |
| `permissions.md` | 登录、角色、权限、字段脱敏、导出 |
| `migrations.md` | 数据模型、索引、约束、生产数据 |
| `testing.md` | 验证、浏览器、完成声明 |

不要把同一规则复制进多个文件。跨域规则放 `core.md`；领域文件引用它。

