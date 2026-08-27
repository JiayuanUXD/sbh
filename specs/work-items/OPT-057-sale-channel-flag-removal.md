# Task Packet：OPT-057 移除出售频道功能开关（`NEXT_PUBLIC_SALE_CHANNEL_ENABLED`）

> 状态：**已实施**（2026-08-27）
> 创建日期：2026-08-27
> 来源：用户裁定「出售功能已经稳定上线，这个功能开关没必要留了」
> 分支：`refactor/sale-channel-flag-removal-0afe`

---

## 1. 背景与事实核对

用户最初的问法是「线上是不是有个**限制**楼盘/房源显示售卖价格的环境变量，可以删除了」。
核对后事实与该表述**方向相反**，先在此记清，避免后人照字面理解：

- 该变量是**功能开关**（`不设即关闭`），不是限制器。删掉它 = 关闭出售频道。
- 它**不在 CloudRun 服务级环境变量里**（实测线上 `EnvParams` 只有 `DATABASE_URL` /
  `PAYLOAD_SECRET` / `COS_*` / `AMAP_WEB_SERVICE_KEY` / `MULTI_CITY_ROUTING_ENABLED` 等），
  而是**写死在 Dockerfile 的 builder 与 runner 两个阶段**（`=true`）。
  原因：`NEXT_PUBLIC_*` 在 `next build` 时内联进客户端包，只改 CloudRun 变量对已构建镜像无效。
- 线上实测 `/shanghai/sale` 返回 **200**（关闭时该路由 `notFound()`），确认出售频道当时已开。

所以用户的真实诉求是第二种读法：**功能已稳定，开关本身该退休**——即让出售能力永久常开。

## 2. 改动范围

开关的接线散落 8 个源码位置 + 3 处构建/配置 + 6 个测试文件：

| 位置 | 处理 |
|---|---|
| `src/lib/frontend/site-config.ts` | 删除 `getSaleChannelEnabled()` 及其文档块 |
| `src/app/(frontend)/sale/page.tsx` | 删 2 处开关守卫（`notFound` 仍用于「城市未开城」） |
| `src/app/(frontend)/[city]/sale/page.tsx` | 删 2 处开关守卫；订正一句已过期的注释 |
| `src/app/(frontend)/sitemap.ts` | 条目判定只留 `shouldListSaleChannelInSitemap` |
| `src/collections/Listings.ts` | 删开关派生的 4 个常量；`businessType` 恒显示；价格分节标题/描述内联为原「开启」取值；`saleTermsCondition` 收敛为纯 businessType 分流 |
| `src/endpoints/listing-publish-endpoint.ts` | 删 `mark_sold` 的开关拒绝分支 |
| `src/lib/frontend/site-settings.ts` | 去掉开关参数透传与 `featureFlag` 过滤 |
| `src/lib/frontend/nav-targets.ts` | 移除 `featureFlag?: 'saleChannel'` 机制（saleChannel 是其唯一使用者），`/sale` 目标保留 |
| `Dockerfile` | 删 builder + runner 两处 `ENV` 与说明 |
| `.github/workflows/quality.yml` | 删 e2e 环境变量 |
| `.env.example` | 删该变量及其说明段 |

## 3. 测试处理

- 删 `tests/sale-channel-flag.test.ts`（测的是已删除的函数）。
- 删 `tests/sale-channel-gating.test.ts`（整份都在守「开关接线存在」）。
- 新增 `tests/sale-channel-always-on.test.ts`（26 条断言）守**反向**契约：
  8 个曾接线文件不得再出现开关函数或读该 env；Dockerfile / CI / `.env.example` 不得再注入；
  sitemap 判定不叠加开关；导航 featureFlag 机制不得留空壳；`mark_sold` 不再被拒；
  按 businessType 分流仍在；数据层始终不看可见性开关（原断言保留）。
  另锚定「城市页残留的 404 判定条件是 `!city`」——防后人误删真 404，也防把开关伪装成城市判断。
- 3 个测试文件删掉对该开关的 mock（`city-route-pages` / `public-catalog-city-parity` / `sitemap-static-routes`）。
- `tests/e2e/sale-channel.spec.ts` 保留（它守的是「路由不能静默 404」，开关没了反而更重要），
  仅更新过期的文档注释与一句断言提示。

## 4. 非目标

- 不改任何数据层口径：租赁列表排除 sale、在租面积只算 lease、有效供给谓词——本来就不受开关影响。
- 不动 `PUBLICATION_STATUSES` 里的 `sold`（枚举值决定 PG ENUM，动它会生成危险迁移）。
- 无表结构变化：`payload migrate:create` 输出 `No schema changes detected`。

## 5. 验证

见 `../artifacts/verification/OPT-057/`。
