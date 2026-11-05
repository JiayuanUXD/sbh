const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.TARGET_ROOT || path.resolve(__dirname, '../../../../sbh-miniprogram');
const ts = require(path.resolve(root, 'node_modules/typescript'));
const modules = new Map();
let registration;
let mode = 'offline';
const calls = [];

const wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  request(input) {
    calls.push({ url: input.url, method: input.method });
    if (mode === 'offline') {
      input.fail({ errMsg: 'request:fail synthetic offline' });
    } else {
      input.success({
        statusCode: 404,
        header: {},
        data: {
          ok: false,
          error: { code: 'building_not_found', message: '未找到该楼盘' },
          meta: { requestId: 'audit-synthetic-404' },
        },
      });
    }
  },
  setNavigationBarTitle: () => {},
  showToast: () => {},
  switchTab: () => {},
};

function load(file) {
  if (!fs.existsSync(file) && file.endsWith('.js')) file = file.slice(0, -3) + '.ts';
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} };
  modules.set(file, mod);
  const source = fs.readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fn = vm.runInNewContext(
    '(function(require,module,exports){' + code + '\n})',
    {
      wx,
      Page: (p) => { registration = p; },
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Error,
      TypeError,
      Date,
      URL,
      encodeURIComponent,
      decodeURIComponent,
      structuredClone,
      Map,
      Set,
      Uint8Array,
    },
  );
  fn((spec) => {
    if (!spec.startsWith('.')) throw Error('unexpected module ' + spec);
    return load(path.resolve(path.dirname(file), spec));
  }, mod, mod.exports);
  return mod.exports;
}

(async () => {
  load(path.resolve(root, 'miniprogram/pages/building-detail/index.ts'));
  const page = {
    ...registration,
    data: structuredClone(registration.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  page.data.slug = 'audit-building';

  // 1. 模拟网络错误
  mode = 'offline';
  await page.loadBuildingDetail('audit-building');
  const initial = { state: page.data.state, requestCount: calls.length };

  // 2. 模拟微信重试事件（传入 CustomEvent 对象，而非 slug 字符串）
  mode = 'not-found';
  const before = calls.length;
  await page.loadBuildingDetail({ type: 'retry', detail: {}, currentTarget: { dataset: {} } });
  const retry = {
    state: page.data.state,
    newRequestCount: calls.length - before,
    expectedState: 'not-found', // 因为 mode='not-found' 模拟 404 返回
    expectedNewRequestCount: 2, // GET 重试最多 2 次
    status: calls.length - before > 0 && page.data.state === 'not-found' ? 'PASS' : 'FAIL',
  };

  // 3. 模拟请求一个不存在的楼盘标识
  const reqBefore = calls.length;
  await page.loadBuildingDetail('audit-missing-building');
  const absent = {
    state: page.data.state,
    newRequestCount: calls.length - reqBefore,
    expectedState: 'not-found',
    status: page.data.state === 'not-found' ? 'PASS' : 'FAIL',
  };

  // 4. catalog 返回结构化错误
  const { getBuildingDetail } = load(path.resolve(root, 'miniprogram/services/catalog.ts'));
  let actualError;
  try {
    await getBuildingDetail('audit-missing-building');
  } catch (e) {
    actualError = { name: e.name, code: e.code, kind: e.kind, statusCode: e.statusCode, message: e.message };
  }

  const result = {
    sourceRoot: root,
    initial,
    retry,
    absent,
    actualError,
    totalCalls: calls.length,
    verdict: retry.status === 'PASS' && absent.status === 'PASS' ? 'PASS' : 'FAIL',
  };

  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
