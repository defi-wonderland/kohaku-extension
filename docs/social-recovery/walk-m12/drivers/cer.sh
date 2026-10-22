#!/bin/zsh
# usage: cer.sh <port> <press: #testid or text> <file under walk/, or ''> <capture prefix> [stopWhen text] ; runs tab.body with the upload act (and an optional Stop press when the text shows)
D="${0:A:h}"
{ cat "$D/upload.js"; cat "$D/cut.js"
  print -r -- "S.file = '$3'; S.tab = { press: '$2', prefix: '$4', when: 'Choose the image', max: 560000, after: 3000 }"
  if [ -n "$3" ]; then print -r -- "S.tab.act = S.upload"; fi
  if [ -n "$5" ]; then print -r -- "S.tab.act = async (p) => { const a = await S.upload(p); const t0 = Date.now(); while (Date.now() - t0 < 400000) { const t = await p.evaluate(() => document.body.innerText); if (t.includes('$5')) { await p.waitForTimeout(3000); await S.shot('$4-before-stop'); await p.getByText('Stop', { exact: true }).first().click(); return a + '; Stop pressed at +' + (Date.now() - t0) + 'ms' } await p.waitForTimeout(300) } return a + '; never saw $5' }"; fi
  print -r -- "const __f = process.mainModule.require('fs').readFileSync(S.WALK + '/b/tab.body','utf8'); return await (new (Object.getPrototypeOf(async function () {}).constructor)('S', __f))(S)"
} | WALK_PORT=$1 node "$D/bp.js" -
