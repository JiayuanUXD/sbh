# OPT-020 验证记录

## 根因

- GitHub Actions run `30251208259` 的质量任务通过，CloudBase 部署失败。
- CloudBase 镜像构建成功，失败版本未获得流量。
- 隔离灰度 `sbh-009` 的容器日志确认：M2.1 迁移把旧枚举值直接转换成新版枚举，生产旧值 `business-district` 导致转换失败。
- 容器采用迁移成功后才启动 Next.js 的失败关闭策略，因此应用未监听 80 端口；存活探针失败是迁移异常的后续症状。

## 线上只读核对

- 当前线上版本：`sbh-007`，100% 流量。
- 区域总数：5。
- 旧类型分布：2 个 `district`、2 个 `business-district`、1 个 `city`。
- 诊断版本未切流，线上数据未写入。

## 修复

- 升级前把 `business-district` 映射为 `business_area`。
- 按旧模型“最近地铁站”的语义把 `metro` 映射为 `metro_station`。
- 先新增可空 `immutable_code`，按 `LEGACY_LOC_<id>` 回填历史行，再增加非空和唯一约束。
- 回滚前把新版类型归一化回旧枚举，避免回滚转换再次失败。

## 本地验证

- TDD 红灯：新增测试首次运行 3/3 失败，分别命中旧类型、历史编码和回滚缺口。
- 专项测试：3 个文件、16 个测试全部通过。
- 全量测试：106 个文件、2004 个测试全部通过。
- TypeScript 类型检查：通过。
- ESLint：0 错误、8 个既有警告。
- 生产构建：通过，包含 `/api/health`、`/`、`/admin` 路由。
- 迁移预检：3 项通过、0 项失败；保留 1 项“字段类型变更”风险提示。
- 隔离 PostgreSQL：
  - 旧样本 `city / district / business-district / metro` 全部升级成功；
  - 对应结果为 `city / district / business_area / metro_station`；
  - 历史编码格式异常数为 0；
  - down 回滚恢复为 `city / district / business-district / metro`；
  - 临时数据库已在验证后删除。

## 尚未验证

- 迁移修复提交 `617394a` 已推送，GitHub Actions `30257724309` 的 quality 全部通过。
- CI 使用的 CloudBase CLI 在创建构建任务前返回 HTTP 400；显式 API 上传同一源码包成功，确认不是代码包或权限问题。
- 显式灰度版本 `sbh-010` 构建时发现 Dockerfile 复制不存在的 `/app/public`；版本保持 0% 流量。
- 已增加 Docker 构建上下文与显式灰度参数回归测试，并修复空 `public` 目录处理。
- 本机没有 Docker 命令，镜像层面的最终验证由下一次 CloudBase 构建承担。
- 尚待验证灰度 `/api/health`、`/`、`/admin` 及真实生产数据迁移结果。
