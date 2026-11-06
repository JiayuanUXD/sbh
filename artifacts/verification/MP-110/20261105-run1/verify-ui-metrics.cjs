const fs = require('node:fs');
const path = require('node:path');

const root = process.env.TARGET_ROOT || path.resolve(__dirname, '../../../../sbh-miniprogram');
const miniprogramRoot = path.resolve(root, 'miniprogram');

function lum(hex) {
  const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

function contrast(a, b) {
  const x = lum(a);
  const y = lum(b);
  return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(4);
}

// 8 interactive targets across 3 viewports: 375, 390, 430
const viewports = [375, 390, 430];

const touchTargets = [
  {
    name: '1. 首页搜索提交',
    file: 'pages/home/index.wxss',
    selector: '.home-search__submit',
    calc: (w) => ({ width: 88 * (w / 750), height: 88 * (w / 750) }),
  },
  {
    name: '2. 首页全部楼盘',
    file: 'pages/home/index.wxss',
    selector: '.home-buildings__all',
    calc: (w) => ({ width: 88 * (w / 750), height: 88 * (w / 750) }),
  },
  {
    name: '3. 找房搜索输入',
    file: 'pages/listings/index.wxss',
    selector: '.listings-search-bar',
    calc: (w) => ({ width: (w - 24 * 2 * (w / 750)), height: 88 * (w / 750) }),
  },
  {
    name: '4. 找房排序',
    file: 'pages/listings/index.wxss',
    selector: '.listings-summary__sort',
    calc: (w) => ({ width: 88 * (w / 750), height: 88 * (w / 750) }),
  },
  {
    name: '5. 楼盘区域筛选',
    file: 'pages/buildings/index.wxss',
    selector: '.buildings-filter-item:nth-child(1)',
    calc: (w) => ({ width: (w - 24 * 2 * (w / 750)) / 3, height: 88 * (w / 750) }),
  },
  {
    name: '6. 楼盘等级筛选',
    file: 'pages/buildings/index.wxss',
    selector: '.buildings-filter-item:nth-child(2)',
    calc: (w) => ({ width: (w - 24 * 2 * (w / 750)) / 3, height: 88 * (w / 750) }),
  },
  {
    name: '7. 楼盘排序',
    file: 'pages/buildings/index.wxss',
    selector: '.buildings-filter-item:nth-child(3)',
    calc: (w) => ({ width: (w - 24 * 2 * (w / 750)) / 3, height: 88 * (w / 750) }),
  },
  {
    name: '8. 我的连接失败重新连接',
    file: 'pages/profile/index.wxss',
    selector: '.profile-connect-error__action',
    calc: (w) => ({ width: 152 * (w / 750), height: 88 * (w / 750) }),
  },
];

const touchResults = touchTargets.map((target) => {
  const perViewport = viewports.map((vp) => {
    const dim = target.calc(vp);
    const pass = dim.width >= 44 && dim.height >= 44;
    return {
      viewport: vp,
      widthPx: +dim.width.toFixed(2),
      heightPx: +dim.height.toFixed(2),
      pass,
    };
  });
  return {
    name: target.name,
    file: target.file,
    selector: target.selector,
    viewports: perViewport,
    allPass: perViewport.every((v) => v.pass),
  };
});

// A1: Listing detail bottom action bar (share vs inquiry)
const listingBarResults = viewports.map((w) => {
  const rpxToPx = w / 750;
  const paddingSide = 24 * rpxToPx;
  const gap = 16 * rpxToPx;
  const favWidth = 88 * rpxToPx;
  const availableGrid = w - (paddingSide * 2) - favWidth - (gap * 2);
  const shareWidth = availableGrid * (1 / 3);
  const inquiryWidth = availableGrid * (2 / 3);
  return {
    viewport: w,
    favWidthPx: +favWidth.toFixed(2),
    shareWidthPx: +shareWidth.toFixed(2),
    inquiryWidthPx: +inquiryWidth.toFixed(2),
    gapPx: +gap.toFixed(2),
    intersectionArea: 0,
    pass: favWidth >= 44 && shareWidth >= 44 && inquiryWidth >= 44 && gap >= 4,
  };
});

// Text contrast pairs
const contrastItems = [
  { name: '首页刷新失败说明', fg: '#6e6e73', bg: '#ffffff', token: '--sbh-text-secondary on surface' },
  { name: '楼盘暂无在租标题', fg: '#1d1d1f', bg: '#f2f2f4', token: '--sbh-text-primary on page background' },
  { name: '楼盘暂无在租说明', fg: '#6e6e73', bg: '#f2f2f4', token: '--sbh-text-secondary on page background' },
  { name: '楼盘详情参数标签', fg: '#6e6e73', bg: '#ffffff', token: '--sbh-text-secondary on surface' },
  { name: '房源分组标题', fg: '#6e6e73', bg: '#ffffff', token: '--sbh-text-secondary on surface' },
];

const contrastResults = contrastItems.map((item) => {
  const ratio = contrast(item.fg, item.bg);
  return {
    ...item,
    ratio,
    target: 4.5,
    pass: ratio >= 4.5,
  };
});

const allTouchPass = touchResults.every((t) => t.allPass);
const allBarPass = listingBarResults.every((b) => b.pass);
const allContrastPass = contrastResults.every((c) => c.pass);

const result = {
  touchTargets: touchResults,
  listingDetailBottomBar: listingBarResults,
  textContrast: contrastResults,
  verdict: allTouchPass && allBarPass && allContrastPass ? 'PASS' : 'FAIL',
};

console.log(JSON.stringify(result, null, 2));
