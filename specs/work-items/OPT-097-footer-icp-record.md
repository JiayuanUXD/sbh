# Task Packet：OPT-097 页脚 ICP 备案号（后台可配）

> 状态：**设计已确认，实施中**
> 创建日期：2026-09-14
> 来源：用户要在 C 端挂「沪ICP备2026037944号」，问后台如何操作；排查发现站点设置里没有备案字段，
> 页脚底栏只渲染「© 年份 版权主体」「城市 · 副标题后缀」「员工入口」。

---

## 1. 一句话

「站点设置 → 页脚」新增「ICP 备案号」字段，C 端页脚底栏在版权后渲染为指向工信部备案系统
（`https://beian.miit.gov.cn/`）的链接；留空不渲染；填错格式保存直接拒绝。

## 2. 设计裁定（2026-09-14 与用户确认）

| 问题 | 裁定 |
|---|---|
| 为什么不用「版权主体」拼进去顶一下 | 那样是纯文本，没链到工信部备案系统，不满足备案编号展示要求；且以后换号要改两处 |
| 要不要格式校验 | **要**。填错号比不填更糟。宽松正则覆盖「沪ICP备2026037944号」「京ICP证030173号」「…号-1」三种常见形态 |
| 按城市分吗 | 不分。备案是「主体 + 域名」维度，七城共用一个号 |
| 链接地址可配吗 | 不可配，固定工信部官网，没有第二个合理值 |
| 公安备案号 | **不在本项内**。需要图标 + 链到 `beian.mps.gov.cn`，等拿到号再做，同一处加字段即可 |
| 存量行 / 默认值 | 迁移只加列不回填；`NULL` = 不显示。备案号不能由代码写默认值 |

## 3. 做法

| 层 | 改动 |
|---|---|
| `src/lib/frontend/icp-record.ts`（新） | 纯函数 `normalizeIcpRecordNumber(raw: unknown): string \| null`（trim 后按正则 `^[一-龥]{1,3}ICP(备\|证)\d{6,12}号(-\d{1,3})?$` 判定）+ 常量 `ICP_RECORD_URL = 'https://beian.miit.gov.cn/'`。后台校验与前台映射共用这一份，不各写一遍 |
| `src/globals/SiteSettings.ts` 页脚 tab | 「版权主体」之后新增 `icpRecordNumber`（text，非必填，`validate` 调上面的纯函数；空值放行）。说明写明：留空不显示；渲染为工信部链接；保存后最长 60 秒全站生效 |
| 迁移 | `ALTER TABLE "site_settings" ADD COLUMN "icp_record_number" varchar;`（可空、无默认）；down 反向 DROP |
| `src/lib/frontend/site-settings-view.ts` | `SiteSettingsView.icpRecordNumber: string \| null`；`SITE_SETTINGS_FALLBACK` 里为 `null` |
| `src/lib/frontend/site-settings.ts` | `toView` 用 `normalizeIcpRecordNumber(doc.icpRecordNumber)` 映射（NULL / 空串 / 非法 → `null`） |
| `src/components/frontend/SiteFooter.tsx` | 底栏「© 年份 版权主体」之后：有值渲染 `<a class="site-footer__icp" href={ICP_RECORD_URL} target="_blank" rel="noopener noreferrer">{号}</a>`；无值不渲染节点 |
| 样式 | `.site-footer__icp`：继承底栏色，hover 下划线，与「员工入口」同一处理（放 `styles.css` 页脚段落内） |

空值语义：字段 NULL（迁移后存量行）与空串都视为「未配置」，页脚不出现备案节点，不需要运营操作。

## 4. 验收

- [ ] 单测：`normalizeIcpRecordNumber` 正反例（三种合法形态、前后空格、空串、缺「号」、含空格、`undefined`）
- [ ] 单测：`toView` 三态（有效 → 原值、NULL / 空 → null、非法 → null）；`SITE_SETTINGS_FALLBACK.icpRecordNumber === null`
- [ ] 单测：`SiteFooter` 有值时渲染链接（href / target / rel / 文本），无值时无 `.site-footer__icp`
- [ ] E2E：夹具管理员 POST `/api/globals/site-settings` 写入备案号 → 首页页脚出现该链接且 href 正确 → 结束后清空还原（沿用 `member-auth.spec.ts` 的开关模式）
- [ ] 后台：填 `abc` 保存 → 400 + 字段红字；填 `沪ICP备2026037944号` 保存成功；抓包 Request Payload 含该字段；强刷回显
- [ ] C 端浏览器：`/` 与 `/shanghai` 页脚底栏出现「沪ICP备2026037944号」链接，375 / 1440 两档；清空后不渲染
- [ ] `typecheck` 干净 / `test` 全绿 / `migrate:dry-run` 本迁移无禁用模式 / `build` 通过

证据：`artifacts/verification/OPT-097/`。

## 5. 上线后运营操作

后台 → 「站点与内容」→「站点设置」→「页脚」标签 → 「ICP 备案号」填 `沪ICP备2026037944号` → 保存。
最长 60 秒后全站页脚生效。

## 6. 不在本项内

公安备案号；备案链接地址可配；按城市区分备案号。
