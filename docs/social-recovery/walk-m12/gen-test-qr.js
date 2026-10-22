// The helper prepends the V2 header itself, so the sample is passed without its own V2 header. Makes a fresh Anon Aadhaar TEST QR (the official UIDAI sample data, re-timestamped to now by the core's createCustomV2TestData and signed with the project's public test key pair),
// checks its signature against testCertificate.pem, writes <out>.txt (the decimal string) and <out>.png (the QR image).
// usage: node gen-test-qr.js <out basename> [other]   ("other" makes a QR of another identity: the core replaces the photo, so the nullifier differs)
const path = require('path'); const fs = require('fs'); const crypto = require('crypto')
const NM = process.env.WALK_NODE_MODULES || require('path').join(__dirname, '..', '..', '..', 'node_modules')
const core = require(NM + '/@anon-aadhaar/core'); const QR = require(NM + '/qrcode')
const here = __dirname
const out = process.argv[2] || 'test-qr'
const other = process.argv[3] === 'other'
const data = JSON.parse(fs.readFileSync(path.join(here, 'dataInput.json'), 'utf8')).testQRData
const bytes = core.convertBigIntToByteArray(BigInt(data)); const decoded = core.decompressByteArray(bytes)
const dataToSign = core.createCustomV2TestData({ signedData: decoded.slice(3, decoded.length - 256), ...(other ? { photo: true } : {}) })
const priv = fs.readFileSync(path.join(here, 'testPrivateKey.pem'), 'utf8')
const sign = crypto.createSign('sha256'); sign.update(Buffer.from(dataToSign)); sign.end(); const signature = sign.sign({ key: priv })
const pub = crypto.createPublicKey(fs.readFileSync(path.join(here, 'testCertificate.pem'), 'utf8'))
const ok = crypto.verify('sha256', Buffer.from(dataToSign), { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, signature)
const qr = core.rawDataToCompressedQR(Buffer.concat([Buffer.from(dataToSign), signature])).toString()
fs.writeFileSync(path.join(here, out + '.txt'), qr)
const fields = Buffer.from(dataToSign).toString('latin1').split('\xff')
QR.toFile(path.join(here, out + '.png'), [{ data: qr, mode: 'numeric' }], { errorCorrectionLevel: 'L', scale: 3, margin: 4 }).then(() => {
  console.log('digits', qr.length, 'signature verifies with the test certificate', ok, 'timestamp field', fields[2], 'name', fields[3], 'png', out + '.png')
})
