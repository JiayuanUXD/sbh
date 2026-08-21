import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const OUT='E:/github/sbh/artifacts/verification/OPT-037'
const ORIGIN='http://localhost:3741'
const slug=process.argv[2] ?? 'west-nanjing-premium-center'
const tag=process.argv[3] ?? 'main'
const b=await chromium.launch()
for (const [w,h] of [[375,812],[768,1024],[1440,900],[1920,1080]]) {
  const p=await b.newPage({viewport:{width:w,height:h}})
  await p.goto(`${ORIGIN}/buildings/${slug}`,{waitUntil:'networkidle'})
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
