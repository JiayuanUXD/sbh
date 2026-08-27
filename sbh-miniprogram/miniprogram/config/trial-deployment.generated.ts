// 由 scripts/prepare-trial-deployment.mjs 在受控发布副本中生成。
// 空字段是仓库安全默认值：未生成受控 trial 配置时必须 fail-closed。
export const trialDeploymentManifest = Object.freeze({
  apiBaseUrl: '',
  gitCommitSha: '',
  serverDeploymentRevision: '',
} as const)
