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
  - 2019 个测试通过
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
