// Run against dev or production: TEST_ORIGIN=http://localhost:8443 BROWSER_PATH=/usr/bin/brave node tests/ui-e2e.mjs
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const dir=await mkdtemp(join(tmpdir(),'iptv-ui-'))
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH,args:['--no-sandbox']})
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
await page.goto(process.env.TEST_ORIGIN||'http://localhost:8443')
await page.getByRole('button',{name:'Data sources',exact:true}).first().click()
assert.equal(await page.locator('.data-source-row').count(),13)
assert.match(await page.title(),/IPTV Accross Borders/)
await page.locator('.data-sources').screenshot({path:join(dir,'sources-desktop.png')})
await page.setViewportSize({width:390,height:844})
await page.getByRole('button',{name:'Open search',exact:true}).click()
const input=page.getByRole('textbox',{name:'Search channels',exact:true})
await input.fill('France')
await page.evaluate(()=>scrollTo(0,600));await page.waitForTimeout(300)
assert(await input.isVisible())
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
assert((await input.boundingBox()).y<160)
await input.press('Escape');assert.equal(await input.isVisible(),false)
await page.getByRole('button',{name:'Open search',exact:true}).click();assert.equal(await input.inputValue(),'France')
await page.getByRole('button',{name:'Data sources',exact:true}).last().click()
assert.equal(await input.isVisible(),false)
assert.equal(await page.evaluate(()=>document.activeElement.id),'data-sources')
await page.screenshot({path:join(dir,'sources-mobile.png')})
assert.deepEqual(errors,[])
console.log({result:'PASS desktop/mobile navigation, search, sources, focus, overflow and page errors',screenshots:dir})
}finally{await browser.close()}
