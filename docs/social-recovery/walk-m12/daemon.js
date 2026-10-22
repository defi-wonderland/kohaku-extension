const path = require('path'); const http = require('http'); const fs = require('fs')
const { chromium } = require(process.env.WALK_PLAYWRIGHT || 'playwright-core')
const WALK = __dirname
const BUILD = process.env.WALK_BUILD || path.join(WALK, 'webkit-prod-m10')
const PROFILE = process.env.WALK_PROFILE
const PORT = Number(process.env.WALK_PORT || 9431)
const EXE = process.env.WALK_CHROMIUM || path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium')
if (!PROFILE) { console.error('WALK_PROFILE is required'); process.exit(1) }
const INIT = process.env.WALK_INIT ? fs.readFileSync(process.env.WALK_INIT, 'utf8') : null
;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EXE, headless: false, viewport: { width: 1280, height: 900 }, colorScheme: 'light',
    args: [...(process.env.WALK_HEADED === '1' ? [] : ['--headless=new']), `--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`, '--no-first-run', '--no-default-browser-check', ...(process.env.WALK_ARGS ? process.env.WALK_ARGS.split(' ') : [])]
  })
  const swlogs = []
  ctx.on('console', (m) => { if (m.worker && m.worker()) swlogs.push(new Date().toISOString().slice(11, 19) + ' ' + m.type() + ': ' + m.text().slice(0, 400)) })
  if (INIT) await ctx.addInitScript(INIT)
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 }).catch(() => null)
  const id = sw ? new URL(sw.url()).host : 'no-worker'
  const logs = []; const net = []
  const hook = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(new Date().toISOString().slice(11, 19) + ' ' + m.type() + ': ' + m.text().slice(0, 400)) })
    p.on('pageerror', (e) => logs.push(new Date().toISOString().slice(11, 19) + ' pageerror: ' + e.message.slice(0, 400)))
    p.on('requestfailed', (r) => net.push(new Date().toISOString().slice(11, 19) + ' ' + r.method() + ' ' + r.url().slice(0, 150) + ' ' + (r.failure() && r.failure().errorText)))
    p.on('response', (r) => { if (r.status() >= 400) net.push(new Date().toISOString().slice(11, 19) + ' ' + r.status() + ' ' + r.url().slice(0, 150)) })
  }
  ctx.pages().forEach(hook); ctx.on('page', hook)
  const S = { ctx, id, logs, net, swlogs, WALK, page: null, sw }
  S.ext = () => ctx.pages().filter((p) => p.url().startsWith('chrome-extension://'))
  S.shot = async (name, page) => { const p = page || S.page; await p.waitForTimeout(600); const f = path.join(WALK, name + '.png'); await p.screenshot({ path: f, fullPage: false }); return f }
  S.text = async (page) => (await (page || S.page).evaluate(() => document.body.innerText)).slice(0, 4000)
  http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', async () => {
    try { const fn = new (Object.getPrototypeOf(async function () {}).constructor)('S', b); const r = await fn(S); res.end(typeof r === 'string' ? r : JSON.stringify(r, null, 1)) }
    catch (e) { res.end('ERR ' + (e && e.stack || e)) } }) }).listen(PORT, '127.0.0.1')
  console.log('ready', id, 'pid', process.pid, 'browser', ctx.browser() ? 'y' : 'persistent')
})().catch((e) => { console.error(e); process.exit(1) })
