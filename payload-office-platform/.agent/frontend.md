# C 端前台专项规则

## 架构

- `app/(frontend)` 负责路由、Metadata、页面编排和错误边界。
- `domain/public-catalog` 负责公开查询门面、DTO 和 mapper。
- `domain/supply` 是公开房源资格唯一来源。
- `components/frontend` 只消费只读 DTO。
- `lib/frontend` 只保存纯解析、格式化和前台工具。
- 路由不拼 Payload `where`，组件不调用 Payload。

## React 与类型

- Server Components 默认；Client Component 只用于筛选抽屉、画廊、咨询弹层和必要交互。
- URL 是筛选、排序和分页状态的事实来源。
- 外部输入 `unknown` + schema/guard；DTO 默认 `Readonly`。
- effect 只用于外部同步，不派生普通渲染数据。
- 列表 key 使用不可变业务 ID。

## 视觉

- 方向：克制、专业、温暖、数据可信、编辑感。
- 主色：`#171A1D`、`#F5F1E8`、`#FCFBF8`、`#D5D0C7`、`#A46F3F`、`#1F5A50`。
- 中文展示/正文：思源宋体 SC / 思源黑体 SC；数字英文：IBM Plex Sans；必须有系统回退。
- 桌面最大 1440px、12 列；重点验证 375、768、1440、1920。
- 房源卡 4:3，详情主图 16:10；图片声明尺寸并有 alt/失败占位。
- 避免自动轮播、阻挡搜索的视频、大面积阴影和胶囊化。
- 动效 160–240ms，并尊重 `prefers-reduced-motion`。

## 状态

每页验证正常、加载、空、错误、404/失效、长文本、极值、图片失败、小视口和减少动效。失败不得伪装成 0 数据；无结果不得混入不匹配供给。

## SEO / 缓存 / 分析

- 每页唯一 title、description、canonical、OG；一个 H1。
- JSON-LD 与页面使用同一 DTO，不虚构库存、评级或价格。
- sitemap 只包含已发布内容和有效供给，域名来自类型化配置。
- 公共供给最长缓存 5 分钟，并由领域事件失效。
- 分析只记录匿名 ID、枚举、上下文和结果；曝光按可见性去重。

## 咨询

- 校验 Content-Type、body、同源/CSRF、schema、长度、枚举和隐私版本。
- 数据库唯一约束保证幂等；生产使用共享限流。
- 定向房源提交前再次 `assertEffectiveListing`。
- 失效目标不建立兴趣关系，可转通用需求。
- 不在响应、日志、监控或分析暴露 PII 与内部 Lead 信息。

