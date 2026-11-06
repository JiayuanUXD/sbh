const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const worktreeRoot = path.resolve(__dirname, '../../../..');
const mpRoot = path.resolve(worktreeRoot, 'sbh-miniprogram');
const outDir = __dirname;

const commit = execSync('git rev-parse HEAD', { cwd: worktreeRoot, encoding: 'utf8' }).trim();
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: worktreeRoot, encoding: 'utf8' }).trim();
const timestamp = new Date().toISOString();

console.log('--- 运行验证探针 ---');

const buildingResult = JSON.parse(execSync(`node ${path.resolve(outDir, 'verify-building-detail.cjs')}`, {
  env: { ...process.env, TARGET_ROOT: mpRoot },
  encoding: 'utf8',
}));

const stateResult = JSON.parse(execSync(`node ${path.resolve(outDir, 'verify-state-actions.cjs')}`, {
  env: { ...process.env, TARGET_ROOT: mpRoot },
  encoding: 'utf8',
}));

const uiResult = JSON.parse(execSync(`node ${path.resolve(outDir, 'verify-ui-metrics.cjs')}`, {
  env: { ...process.env, TARGET_ROOT: mpRoot },
  encoding: 'utf8',
}));

console.log('--- 运行静态检查 ---');
let checkProjectOutput = '';
try {
  checkProjectOutput = execSync('node scripts/check-project.mjs', { cwd: mpRoot, encoding: 'utf8' }).trim();
} catch (e) {
  checkProjectOutput = e.stdout || e.message;
}

console.log('--- 运行 TypeScript 类型检查 ---');
let typecheckPassed = false;
try {
  execSync('pnpm typecheck', {
    cwd: mpRoot,
    encoding: 'utf8',
  });
  typecheckPassed = true;
} catch (e) {
  typecheckPassed = false;
}

console.log('--- 运行全量单元测试 ---');
let vitestSummary = {};
const vitestTmpPath = path.resolve(outDir, 'vitest-results.json');
try {
  execSync(`pnpm vitest run --reporter=json --outputFile=${vitestTmpPath}`, { cwd: mpRoot, encoding: 'utf8' });
  const parsed = JSON.parse(fs.readFileSync(vitestTmpPath, 'utf8'));
  vitestSummary = {
    numTotalTestSuites: parsed.numTotalTestSuites,
    numPassedTestSuites: parsed.numPassedTestSuites,
    numFailedTestSuites: parsed.numFailedTestSuites,
    numTotalTests: parsed.numTotalTests,
    numPassedTests: parsed.numPassedTests,
    numFailedTests: parsed.numFailedTests,
    success: parsed.success,
  };
  fs.unlinkSync(vitestTmpPath);
} catch (e) {
  vitestSummary = { raw: e.stdout || e.message, success: false };
}

const evidence = {
  spec: 'MP-110',
  runId: '20261105-run1',
  timestamp,
  environment: {
    node: process.version,
    commit,
    branch,
    worktreeRoot,
    miniprogramRoot: mpRoot,
  },
  checks: {
    projectCheck: checkProjectOutput.includes('SBH 小程序工程静态检查通过'),
    typecheck: typecheckPassed,
    vitest: vitestSummary,
  },
  probes: {
    buildingDetail: buildingResult,
    stateActions: stateResult,
    uiMetrics: uiResult,
  },
  overallVerdict: (
    checkProjectOutput.includes('SBH 小程序工程静态检查通过') &&
    typecheckPassed &&
    vitestSummary.numFailedTests === 0 &&
    buildingResult.verdict === 'PASS' &&
    stateResult.verdict === 'PASS' &&
    uiResult.verdict === 'PASS'
  ) ? 'PASS' : 'FAIL',
};

fs.writeFileSync(path.resolve(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
console.log('--- 证据写入完成：', path.resolve(outDir, 'evidence.json'), '---');
console.log('总体结论：', evidence.overallVerdict);
