import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { gotoOrThrow } from './lib/sentinel.mjs'
const OUT='E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN='http://localhost:3741'
const slug=process.argv[2] ?? 'west-nanjing-premium-center'
const tag=process.argv[3] ?? 'main'
const b=await chromium.launch()
for (const [w,h] of [[375,812],[768,1024],[1440,900],[1920,1080]]) {
  const p=await b.newPage({viewport:{width:w,height:h}})
  // ⚠️ 2026-08-22 终审第 3 轮补：纯截图脚本原本不读状态码——404 页照样能拍出四个断点。
  // 哨兵（状态码 + 该路由族的关键选择器）不通过就抛，绝不产出「看起来没问题」的图。
  await gotoOrThrow(p, `${ORIGIN}/buildings/${slug}`)
  await p.evaluate(async()=>{const s=window.innerHeight;for(let y=0;y<document.documentElement.scrollHeight;y+=s){window.scrollTo({top:y,behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>r()))}window.scrollTo({top:0,behavior:'instant'})})
  await p.screenshot({path:`${OUT}/task10-${tag}-top-${w}.png`})
  const hrefs=await p.$$eval('.dt-anchor-bar__links a',as=>as.map(a=>a.getAttribute('href')))
  for (const href of hrefs){
    await p.click(`.dt-anchor-bar__links a[href="${href}"]`)
    await p.waitForTimeout(800)
    await p.screenshot({path:`${OUT}/task10-${tag}-${href.slice(1)}-${w}.png`})
  }
  await p.close()
}
await b.close()
console.log('ok')
