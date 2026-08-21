import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const OUT='E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const tag=process.argv[2]
const cases=[['buildings-index','/buildings',375],['building-nomedia','/buildings/west-nanjing-premium-center',1440],['listing-so','/listings/jingan-serviced-office-42-seats',375]]
const browser=await chromium.launch()
for(const [name,url,width] of cases){
  const page=await browser.newPage({viewport:{width,height:900}})
  const r=await page.goto('http://localhost:3802'+url,{waitUntil:'networkidle'})
  if(r.status()!==200) throw new Error(url+' status '+r.status())
  await page.evaluate(async()=>{const s=window.innerHeight;for(let y=0;y<document.documentElement.scrollHeight;y+=s){window.scrollTo({top:y,behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>r()))}window.scrollTo({top:0,behavior:'instant'})})
  await page.waitForTimeout(400)
  await page.screenshot({path:`${OUT}/${tag}/${name}-${width}.png`,fullPage:true})
  await page.close()
}
await browser.close()
console.log('ok',tag)
