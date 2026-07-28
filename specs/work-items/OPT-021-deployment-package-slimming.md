# Task Packet：OPT-021 部署包瘦身

> 状态：已完成
> 创建日期：2026-07-28
> 最后更新：2026-07-28

## 1. 目标

通过 Git Archive 排除非运行时目录，避免 CloudBase 源码包因体积过大而上传超时。

## 2. 非目标

- 不调整应用运行时依赖、业务代码或 Docker 镜像层。
- 不执行生产部署、切流或提交推送。

## 3. 权威上下文

- Task：独立生产部署可靠性修复，无页面 Task。
- 页面 PRD：不适用。
- Design/Requirement：`DEPLOYMENT.md#Git-自动部署CI`。
- Agent：`payload-office-platform/.agent/core.md` + `payload-office-platform/.agent/testing.md`。

## 4. 当前行为与证据

- 复现路径：从仓库根目录执行 `git archive --format=zip HEAD:payload-office-platform`。
- 当前结果：加入排除规则前，验证截图等文件令部署包达到约 7.64 MB，跨境上传反复超时。
- 期望结果：`artifacts/` 与 `tests/` 不进入部署 ZIP，运行所需源码和配置保持完整。
- 修改前截图/日志：GitHub Actions run `30265028880` 的上传阶段连续超时。

## 5. 影响范围

- 修改文件：`.gitattributes`、部署配置测试、部署说明和 CI 包体积防线。
- 数据模型/迁移：无。
- 权限：无。
- API/路由：无。
- 缓存/事件：无。
- 风险：误排除运行时文件；已通过归档清单核对必需目录仍在。

## 6. 实施清单

- [x] 建立失败测试或可复现用例。
- [x] 实现最小完整闭环。
- [x] 验证归档排除边界和应用必需文件。
- [x] 更新文档与任务状态。

## 7. 验收

- 对应 PRD条款：不适用。
- 自动化测试：生产部署配置测试 6/6；全量单元测试 2019/2019。
- 浏览器路径：不适用，未修改页面、路由或交互。
- 数据/迁移检查：不适用。

## 8. 结果

- 修改文件：`payload-office-platform/.gitattributes`、`payload-office-platform/tests/production-deploy-config.test.ts`、`.github/workflows/deploy.yml`、`DEPLOYMENT.md`。
- 实际结果：部署 ZIP 约 849 KB，`artifacts/` 与 `tests/` 均未进入归档。
- 验证摘要：Git Archive 清单与自动化测试均通过。
- 详细证据：`../../artifacts/verification/OPT-021/README.md`
- 剩余风险：尚未在本次任务内触发真实生产部署；本机 Node.js 为 24.14.0，而项目声明 Node 22.x。
- 下一步：提交并推送当前变更后观察 GitHub Actions 上传耗时和 CloudBase 灰度部署结果。
