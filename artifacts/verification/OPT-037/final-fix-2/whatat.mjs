/** 给定 URL/宽度/Y 区间，列出文档坐标下与该区间相交的元素（最深的几个）。 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const [,,origin,url,widthS,y0S,y1S]=process.argv
const width=Number(widthS), y0=Number(y0S), y1=Number(y1S)
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width,height:900}})
const res=await page.goto(origin+url,{waitUntil:'networkidle'})
console.log('status', res.status())
await page.evaluate(async()=>{const s=window.innerHeight;for(let y=0;y<document.documentElement.scrollHeight;y+=s){window.scrollTo({top:y,behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>r()))}window.scrollTo({top:0,behavior:'instant'})})
await page.waitForTimeout(500)
const out=await page.evaluate(([y0,y1])=>{
  const hits=[]
  for(const el of document.querySelectorAll('body *')){
    const r=el.getBoundingClientRect()
    const top=r.top+window.scrollY, bot=r.bottom+window.scrollY
    if(bot<y0||top>y1) continue
    if(r.width===0||r.height===0) continue
    const cls=typeof el.className==='string'?el.className:''
    hits.push({t:Math.round(top),b:Math.round(bot),tag:el.tagName.toLowerCase(),cls:cls.trim().slice(0,80),depth:(()=>{let d=0,p=el;while(p){d++;p=p.parentElement}return d})()})
  }
  hits.sort((a,b)=>b.depth-a.depth)
  return hits.slice(0,14)
},[y0,y1])
for(const h of out) console.log(`${h.t}..${h.b} <${h.tag}> .${h.cls}`)
await browser.close()
