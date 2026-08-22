/** 逐像素差异的 Y 范围（用于判断差异是否全部落在地图/POI 区）。 */
import sharp from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'
import fs from 'node:fs'
const ROOT='E:/github/sbh/artifacts/verification/OPT-037/final-fix-2'
const A=process.argv[2], B=process.argv[3]
for (const f of fs.readdirSync(`${ROOT}/${A}`).filter(x=>x.endsWith('.png')).sort()) {
  const pa=`${ROOT}/${A}/${f}`, pb=`${ROOT}/${B}/${f}`
  if(!fs.existsSync(pb)) continue
  const ma=await sharp(pa).metadata(), mb=await sharp(pb).metadata()
  const w=Math.min(ma.width,mb.width), h=Math.min(ma.height,mb.height)
  const ra=await sharp(pa).extract({left:0,top:0,width:w,height:h}).raw().toBuffer()
  const rb=await sharp(pb).extract({left:0,top:0,width:w,height:h}).raw().toBuffer()
  const ch=ra.length/(w*h)
  let minY=Infinity,maxY=-1,n=0
  for(let i=0;i<ra.length;i+=ch){
    if(Math.abs(ra[i]-rb[i])>8||Math.abs(ra[i+1]-rb[i+1])>8||Math.abs(ra[i+2]-rb[i+2])>8){
      const y=Math.floor((i/ch)/w); if(y<minY)minY=y; if(y>maxY)maxY=y; n++
    }
  }
  if(n>0||ma.height!==mb.height) console.log(`${f}: h=${ma.height}/${mb.height} diffPx=${n} yRange=${minY}..${maxY}`)
}
