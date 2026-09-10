# Task Packet：OPT-090 会员「我的咨询与委托」进度页

> 状态：**待实施（依赖 OPT-088 合入）**
> 创建日期：2026-09-10
> 母文档：`OPT-088-member-system-design.md` §4.4、§6.7、§8.3 `/account/inquiries`、§12.1 `member-status.test.ts`、§12.2 `member-inquiries.spec.ts`、§13.3
> 分支：`feat/opt-090-member-inquiries-<hex>`
> 实施代理读取顺序：同 OPT-088，再加 `.agent/supply.md` 与本包

---

## 1. 一句话

登录会员在 `/account/inquiries` 看到自己用同一手机号提交过的咨询、委托找房、投放房源的处理状态；三个公开表单在登录态预填手机号。

## 2. 范围

- `Leads.ts` 的 `phone` 加 `index: true`，`SupplySubmissions.ts` 新增 `contactPhoneNormalized`（text，`index: true`，可空），然后 `migrate:create` 生成结构迁移；**不手写 `CREATE INDEX`**（母文档 §4.3 / §4.4 的快照漂移理由）。
- 另写 TS 迁移 `opt_090_supply_submission_phone_backfill`：逐行读 `contactPhone` 调 `normalizePhone` 回填 `contact_phone_normalized IS NULL` 的行，打印影响行数与无法规范化的行 id 清单，可重跑。
- `SupplySubmissions.ts`：`beforeChange` 从 `contactPhone` 派生 `contactPhoneNormalized`；`afterRead` 脱敏规则把新列一并纳入 `phone:full`。
- `src/domain/member/member-status.ts`：`toMemberFacingLeadStatus`；`ProgressItem` 映射函数（纯函数，输入为线索与投放申请的最小字段子集）。
- `/account/inquiries` Server Component：两次 Local API 查询，映射，渲染；空态文案「还没有提交过咨询或委托」并给出去 `/entrust` `/publish` 的链接。
- 三个表单（`InquiryModal`、`EntrustForm`、`SupplySubmissionForm`）读 `useMember()`，有会员时手机号预填并只读，其余逻辑不动。
- 测试：`tests/member-status.test.ts`、进度映射快照测试、`tests/e2e/member-inquiries.spec.ts`。

## 3. 非目标

会员在前台修改或撤回咨询；显示跟进记录、备注、报价快照、归属历史、顾问电话；城市合伙人申请进度；按 visitorRef 关联匿名浏览。

## 4. 数据口径

- 线索按 `phone = member.username` 精确匹配。前台表单写入的线索已是规范化手机号，员工手工录入的非规范格式不在本页范围，写进页面注释与本包风险。
- 投放申请按 `contactPhoneNormalized = member.username` 匹配。
- 各取最新 50 条，按提交时间倒序合并展示。
- 状态映射表见母文档 §6.7，单测穷举 `LEAD_STAGES` 与旧 `status` 的全部取值，新增枚举值时测试必须红。

## 5. 验收标准

- [ ] 两条迁移 `migrate:dry-run` 通过；回填在本地库与 CI 库跑出影响行数；`down` 删列删索引可逆。
- [ ] seed 增加：会员夹具手机号一条线索（`stage: 'viewing'`）、一条委托线索（`sourcePageType: 'entrust'`，`stage` 空、`status: 'contacted'`）、一条投放申请（`status: 'contacted'`）；进度页显示三条，状态文案分别为「已安排带看」「顾问跟进中」「已联系」。
- [ ] 意向房源仍在有效供给时标题可点并跳详情；把该房源下架后刷新，标题不可点但仍显示。
- [ ] 快照测试：进度页渲染输出不含 `notes`、`followUps`、`priceSnapshot`、`ownershipStatus`、顾问电话。
- [ ] 登录态打开询盘弹层，手机号已填且只读；提交成功后进度页出现新记录。
- [ ] 四断点截图与证据进 `artifacts/verification/OPT-090/`。
- [ ] `typecheck` / `lint` / `test` / `build` 全绿，e2e 通过。

## 6. 风险与注意

- 回填期间投放申请表可能有并发写入：迁移先加列与钩子（钩子随代码上线），再回填，回填语句只更新 `contact_phone_normalized IS NULL` 的行，幂等可重跑。
- `leads` 表数据量若较大，加索引用普通 `CREATE INDEX`（Payload 迁移在事务内，`CONCURRENTLY` 不可用）；生产表当前规模小，可接受短锁，写进证据。
- 不要把进度查询做成客户端接口；本页只有服务端查询。

## 7. 证据目录

`artifacts/verification/OPT-090/`：迁移输出与回填行数、截图、快照测试输出。
