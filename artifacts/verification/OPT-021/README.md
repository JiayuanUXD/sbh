# OPT-021 部署包瘦身验证

验证日期：2026-07-28

## Git Archive 结果

- 命令：`git archive --format=zip HEAD:payload-office-platform`
- ZIP 大小：约 849 KB（869,867 bytes）
- 归档条目：388
- `artifacts/`：未进入归档
- `tests/`：未进入归档
- `Dockerfile`、`package.json`、`src/`、`scripts/`：仍在归档中

生效规则：

```gitattributes
artifacts/ export-ignore
tests/ export-ignore
```

## 自动化测试

- `pnpm exec vitest run tests/production-deploy-config.test.ts`
  - 1 个测试文件通过
  - 6 个测试通过
- `pnpm test`
  - 108 个测试文件通过
  - 2021 个测试通过
- `pnpm lint`
  - 0 个错误
  - 8 个既有警告
- `pnpm typecheck`
  - 通过
- `pnpm exec tsx scripts/preflight.ts migrations`
  - 3 项通过
  - 0 项失败
  - 1 项既有字段类型变更警告
- `NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com pnpm build`
  - 生产构建通过
- `bash -n scripts/cloudrun-release.sh`
  - 发布脚本语法检查通过

## 已知限制

- 本次未触发生产部署或流量切换。
- 测试机器使用 Node.js 24.14.0，项目声明 Node.js 22.x；pnpm 给出 engine 警告，但测试全部通过。

## 发布前完整性检查回归

首次执行本地发布时，代码包在上传前被误报为缺少 `Dockerfile`。归档实际包含该文件，根因是脚本在 `set -o pipefail` 下使用 `unzip | grep -q`：匹配后 `grep` 提前退出，导致 `unzip` 收到 SIGPIPE，管道返回 141。

修复后验证：

- 发布脚本改为完整读取 `unzip -Z1` 清单并精确匹配 `Dockerfile`。
- `bash -n scripts/cloudrun-release.sh` 通过。
- 在 `pipefail` 开启时执行同一归档检查返回 0。
- 生产部署配置测试新增对应回归用例，8/8 通过。

## 生产部署

- 目标环境：`sbh-d9gnr8h5ef7e22e30`
- 服务：`sbh`
- 部署包：约 852 KB，388 个文件
- 候选版本：`sbh-015`
- 灰度：10%，健康接口 20/20 返回 `status=ok`
- 页面冒烟：`/`、`/admin`、`/listings` 均返回 HTTP 200
- 全量：`sbh-015` 最终承载 100% 流量
- 全量后复验：健康接口 20/20 返回 `status=ok`，三个页面均返回 HTTP 200

切流命令返回后，管控面曾短暂显示旧比例。独立复查确认最终收敛为 `sbh-015 -> 100%`。发布脚本因此新增流量收敛轮询：10% 灰度需实际出现 `10,90`，全量需实际出现 `100`，否则 60 秒后停止并报错。
