import assert from 'node:assert/strict'
import fs from 'node:fs'

const results = []
for (const path of ['/api/health', '/', '/shanghai/buildings', '/shanghai/buildings?grade=ungraded', '/shanghai/buildings/west-nanjing-premium-center-2302', '/api/mini/v1/buildings?city=shanghai', '/api/mini/v1/buildings?city=shanghai&gradeSchema=quality-v1']) {
  const response = await fetch(`http://localhost:3717${path}`)
  const body = await response.text()
  assert.equal(response.status, 200, path)
  if (path === '/shanghai/buildings') {
    assert.ok(body.includes('未评级'), '默认楼盘目录也必须取得新等级缓存结果')
    assert.ok(body.includes('west-nanjing-premium-center-2302'))
  }
  if (path.includes('grade=ungraded')) assert.ok(body.includes('test0814') && body.includes('west-nanjing-premium-center-2302'))
  if (path.includes('/mini/')) {
    const data = JSON.parse(body)
    const encoded = JSON.stringify(data)
    if (path.includes('gradeSchema=quality-v1')) assert.ok(encoded.includes('ungraded'))
    else assert.ok(!encoded.includes('"grade":"ungraded"') && !encoded.includes('"grade":"grade-b"'))
    assert.ok(!encoded.includes('"grade":"creative-park"') && !encoded.includes('"grade":"serviced-office"'))
  }
  results.push({ path, status: response.status, finalUrl: response.url })
}
fs.writeFileSync(new URL('./page-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
