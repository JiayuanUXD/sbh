# sbh-222 浏览器验收复现

目标构建：`05d6946019b11869a00f6749ae725f3f1a21824f-worktree-b70c93a1a692`。HTTP 状态和页面哨兵由 `promote-verify.mjs` 记录，浏览器读数在 `production-222-browser-audit.json`；不以截图自证服务端状态。

## 探针

使用已绑定的 CUA `publicTab`，每次视口修改后重新加载，再调用以下只读探针。图像自然宽度大于零才视为加载；无图占位不计为坏图。保存完整 URL，不丢弃 query。

```javascript
const probe = await publicTab.playwright.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent,
  width: window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  images: Array.from(document.querySelectorAll('main img')).slice(0, 4).map(i => ({
    src: i.currentSrc,
    loaded: i.complete && i.naturalWidth > 0,
  })),
}));
const evidence = {
  ...probe,
  url: await publicTab.url(),
  text: await publicTab.playwright.getByRole('main').innerText(),
  logs: await publicTab.dev.logs({ levels: ['error', 'warn'], limit: 20 }),
};
```

## 场景

1. 首页与楼盘目录逐档设为 375x812、768x1024、1440x900、1920x1080，reload 后检查标题、横向溢出、图片和截图。首页保持 57,545 房源 / 4,448 楼盘 / 22 商圈。恢复默认视口。
2. 375 楼盘目录展开移动筛选，点击甲级，核验 11 个楼盘 / 8 个有供给；闵行区 485 / 254，虹桥组合 60 / 40，切换面积排序仍保留两个位置条件。
3. 陆家嘴地铁 9 / 6，2020 年后 113 / 79，叠加 1000 平米下限 74 / 74；仅有库存 2531，面积上限 5000 为 1759。第 186 页显示末尾 8 个楼盘。
4. 出售频道空且无租赁供给；闵行区叠加甲级为空，取消位置退路 11、取消等级退路 485。page=187 返回越界退路；非法 page=999999 依现有解析规则归一为 1。
5. 首页点击“查看 57,545 套在租”，确认房源总数、正常卡片和首末分页。实际点击第 2398 页，确认 57529-57545 共 17 条。点击静安区后总数 5262、页码重置，再点击南京西路为 2319。
6. 点击会德丰国际广场 502 平米房源，再点击“查看楼盘”，确认标题、价格、当前有效供给 100 套与双向关联。无图房源明确显示拍摄中，不伪造图片。
7. 首页热门商圈通过链接键盘聚焦滚入视口，检查全部五张图片 loaded 与截图像素。相关路由控制台无 error；地图加载占位不作为地图服务验收。

证据捕获：`await fsProof.writeFile(path, await publicTab.screenshot({fullPage:true}))`；案例正文用上面的 `innerText()` 捕获，JSON 由 CUA 的本地文件接口落盘。没有页面脚本写入或生产表单提交。
