const { chromium } = require('playwright-core')
;(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true })
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
  await p.goto('http://localhost:4325/', { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  await p.keyboard.press('m')  // paint
  await p.waitForTimeout(200)
  const box = await p.locator('canvas').first().boundingBox()
  const y = box.y + 518, x0 = box.x + 520
  // hover an unpainted pin (move only)
  await p.mouse.move(x0, y)
  await p.waitForTimeout(400)
  await p.screenshot({ path: '/tmp/gc_hover_solid.png' })
  await b.close()
})().catch(e=>{console.error(e);process.exit(1)})
