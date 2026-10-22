// Posts a body file (or stdin with '-') to the daemon on WALK_PORT; {{NAME}} is filled from wallet-1.env, wallet-2.env (prefixed W1_/W2_) and GUARDIAN_ADDRESS of the credentials file, in code; the answer is masked.
const fs = require('fs'); const http = require('http'); const path = require('path')
const env = {}
const load = (f, pre, only) => { if (!fs.existsSync(f)) return; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 0) continue; const k = l.slice(0, i).trim(); if (only && !only.includes(k)) continue; env[pre + k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '') } }
load((process.env.WALK_CREDS || 'walk-credentials.env'), '', ['GUARDIAN_ADDRESS'])
load(path.join(__dirname, 'wallet-1.env'), 'W1_'); load(path.join(__dirname, 'wallet-2.env'), 'W2_')
const secrets = Object.values(env).filter((v) => v && v.length > 5).sort((a, b) => b.length - a.length)
const src = process.argv[2] === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(process.argv[2], 'utf8')
const body = src.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, n) => JSON.stringify(env[n]))
const req = http.request({ host: '127.0.0.1', port: process.env.WALK_PORT, method: 'POST' }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { for (const s of secrets) b = b.split(s).join('[secret]'); console.log(b.replace(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, "0x[addr]").replace(/0x[0-9a-fA-F]{3,8}(\.\.\.|…)[0-9a-fA-F]{3,8}/g, "0x[addr…]").replace(/https?:\/\/(?!localhost)\S+/g, '[url]')) }) })
req.setTimeout(600000); req.end(body)
