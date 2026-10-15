# OPT-116 验证记录

> 工作项：`specs/work-items/OPT-116-frontend-user-copy.md`
> 分支：`fix/opt-116-frontend-user-copy-27e8`
> 日期：2026-10-15，本机 macOS，Node v24.14.0（项目要求 22.x，只报 engine 警告）

## 1. 改动汇总

工作项 §2 的 11 处，另有实施中发现、同一类的 2 处（已在汇报中说明）：

| # | 位置 | 结果 |
|---|---|---|
| 12 | `InquiryModal.tsx` 房源失效时的副标题「已切换为通用选址需求」 | →「这套房源暂时不可咨询，可直接留下选址需求」 |
| 13 | `CorrectionModal.tsx` 纠错弹窗错误表（请求格式 / 请求标识 / 目标类型 / 目标缺失 / 请求不被允许） | 统一「提交失败，请刷新页面后重试」；`correctionErrorMessage` 同样回落通用提示并去重 |

附带：
- 两个弹窗的错误列表原先 `ERROR_MESSAGES[code] ?? code`——表里没有的错误码会把**英文码原样**显示给用户；改为回落通用提示，并按文案去重（多个码可能落到同一句）。
- 询价错误表里另外 4 条技术错误（请求数据格式错误 ×3、请求数据过大）同归「提交失败，请刷新页面后重试」。
- `ls-emptyrange__badge` 样式随调试标注一起删除；`dev-story/opt038` 演示页的开城文案同步。
- `ExcludedUnitsBar`（#7）目前**只在 `dev-story/opt036` 演示页里挂载**，线上列表页未使用；文案已改，上线时即为新文案。

## 2. 单测

| 项 | 结果 |
|---|---|
| 新增 `tests/opt116-frontend-copy.test.ts` | 35 条：页码越界不渲染调试标注 / 实现说明；询价结果文案无内部术语；`inquiryErrorMessage` / `correctionErrorMessage` 的技术码、未知码、可自修正码；看房时段提示 |
| 同步 `tests/detail-components-contract.test.ts` | 「计价单位不唯一」→ 断言新整句「这组房源计价单位不同，已按推荐顺序排列」 |
| 同步 `tests/inquiry-modal-state.test.ts` | 「房源状态已变化」→「这套房源刚有变动」（用例意图不变：在房源页咨询、房源失效转楼盘时要说清是房源变了） |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 error，35 warning（全部既有） |
| `pnpm test` | **455 个文件 / 6241 条全过**（停掉 dev server 后的一轮） |

TDD 与变异：
- 页码越界、询价 / 纠错错误码、详情分组提示的断言都**先跑红**再改实现。
- 页码越界守卫：临时把 `page=… → 已改写为` 加回组件 → 红；还原 → 绿。
- 看房时段的断言是改完后补的，故做了变异：把旧句改回 → 2 条红；还原 → 绿。
- 首次断言 `not.toMatch(/page=\d/)` 误中「去最后一页」按钮的 href（`?page=3`），改为只检查去掉标签后的可见文字。

关于 `media-watermark-bake.test.ts`：dev server 与浏览器运行期间跑全量，两轮分别有 5 条、2 条「Test timed out in 5000ms」，每轮失败的用例不同；单独跑该文件 4 s 内全过；本分支相对 master 在水印代码上无改动；停掉 dev server 后全量 6241 条全过。判断为负载下的超时抖动，与本项无关。

## 3. 浏览器验收（dev server，本地库）

| 页面 | 核对 | 截图 |
|---|---|---|
| `/shanghai/buildings` 暂无在租分组 | 「暂无在租 1 个 这些楼盘暂时没有可租的房源」 | `01-buildings-vacant-group.jpg` |
| `/shanghai/listings?page=99` 页码越界 | 调试标注不存在（`.ls-emptyrange__badge` 无节点）；说明为「链接可能已过期，可以跳到最后一页或回到第 1 页。」 | `02-listings-out-of-range.jpg` |
| `/shanghai/listings?type=coworking&areaMin=2000` 筛选无结果 | 「放宽下面任一条件，就能看到结果。」，退路行与「清除全部条件」照常 | `03-listings-empty-filtered.jpg` |
| `/shanghai/listings?type=full-floor&priceUnit=rmb-sqm-month` 类目暂无 | 「这一类目前还没有一套上架，有新的会第一时间显示在这里。」 | `04-listings-empty-nostock.jpg` |
| `/shanghai/buildings?business=sale` 类目暂无（楼盘） | 「这一类目前还没有一个楼盘上架，……」——量词沿用 `countNoun` prop | — |
| `/hangzhou` 即将开城 | 「现在就可以提交杭州房源，先入驻的……」，页面无「入库通道」 | `05-coming-soon-hangzhou.jpg` |

未在真实页面触发、由单测渲染覆盖的：
- 楼盘详情「这组房源计价单位不同，已按推荐顺序排列」：本地 `huangpu-bund?sort=price-asc` 未触发组级排序降级，改由 `detail-components-contract.test.ts` 以降级组渲染断言整句。
- 看房时段提示：只在询价第二步（提交手机号建线索之后）出现，不为验收一句提示去本地库造线索，改由渲染测试断言。
- 询价 / 纠错的提交结果与错误提示：由 `getInquiryResolutionCopy` / `inquiryErrorMessage` / `correctionErrorMessage` 单测覆盖。

环境说明：本地库已跑过 OPT-115 迁移（物业类型新枚举），本分支基于 master、不认识新值，楼盘详情「物业类型」一行会为空；与本项改动无关。
