// Posts a code file to a daemon; credentials named as {{NAME}} are filled from the credentials file in code and never printed.
const fs = require('fs'); const http = require('http')
const env = Object.fromEntries(fs.readFileSync((process.env.WALK_CREDS || 'walk-credentials.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const secrets = Object.values(env).filter((v) => v && v.length > 5)
let body = fs.readFileSync(process.argv[2], 'utf8').replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, n) => JSON.stringify(env[n]))
const req = http.request({ host: '127.0.0.1', port: process.env.WALK_PORT || 9431, method: 'POST' }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { for (const s of secrets) b = b.split(s).join('[secret]'); console.log(b.replace(/0x[0-9a-fA-F]{20,}/g, '0x…').replace(/https?:\/\/\S+/g, '[url]')) }) })
req.end(body)
