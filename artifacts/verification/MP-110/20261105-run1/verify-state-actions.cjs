const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.TARGET_ROOT || path.resolve(__dirname, '../../../../sbh-miniprogram');
const miniprogramRoot = path.resolve(root, 'miniprogram');

let component;
vm.runInNewContext(
  fs.readFileSync(path.resolve(miniprogramRoot, 'components/sbh-state/index.js'), 'utf8'),
  { Component: (c) => { component = c; } },
);

const template = fs.readFileSync(path.resolve(miniprogramRoot, 'components/sbh-state/index.wxml'), 'utf8');
const conditionMatch = template.match(/wx:if="\{\{([^}]+)\}\}"\s+class="sbh-state__action"/);
const condition = conditionMatch ? conditionMatch[1] : '';

const testCases = [
  { kind: 'loading', actionLabel: '重试', expectedVisible: false, expectedEvent: false },
  { kind: 'loading', actionLabel: '', expectedVisible: false, expectedEvent: false },
  { kind: 'empty', actionLabel: '', expectedVisible: false, expectedEvent: false },
  { kind: 'empty', actionLabel: '重置筛选', expectedVisible: true, expectedEvent: true },
  { kind: 'error', actionLabel: '', expectedVisible: false, expectedEvent: false },
  { kind: 'error', actionLabel: '重新加载', expectedVisible: true, expectedEvent: true },
];

const outputs = [];
for (const tc of testCases) {
  const events = [];
  const instance = {
    data: { resolvedKind: tc.kind, actionLabel: tc.actionLabel },
    triggerEvent: (name) => events.push(name),
  };
  const buttonVisible = !!vm.runInNewContext(condition, instance.data);
  component.methods.handleRetry.call(instance);
  const eventDispatched = events.includes('retry');
  const pass = buttonVisible === tc.expectedVisible && eventDispatched === tc.expectedEvent;
  outputs.push({
    kind: tc.kind,
    actionLabel: tc.actionLabel,
    buttonVisible,
    eventDispatched,
    expectedVisible: tc.expectedVisible,
    expectedEvent: tc.expectedEvent,
    status: pass ? 'PASS' : 'FAIL',
  });
}

const references = ['pages/buildings/index.wxml', 'pages/building-detail/index.wxml'].map((file) => ({
  file,
  emptyActions: [...fs.readFileSync(path.resolve(miniprogramRoot, file), 'utf8').matchAll(/<sbh-state\s+kind="empty"[\s\S]*?\/>/g)].map((m) => m[0]),
}));

const allPass = outputs.every((o) => o.status === 'PASS');
const result = {
  condition,
  outputs,
  references,
  verdict: allPass ? 'PASS' : 'FAIL',
};

console.log(JSON.stringify(result, null, 2));
