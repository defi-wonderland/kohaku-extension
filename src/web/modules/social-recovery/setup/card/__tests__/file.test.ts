/**
 * The card's file read back the way a PDF reader reads it: its name and type,
 * its header and end marker, the cross-reference table and each offset in it,
 * the content stream's length, and the text the page draws.
 */
import i18n from '@common/config/localization'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import {
  pdfFileParts,
  pdfTextBlocks
} from '@web/modules/social-recovery/setup/card/__tests__/harness'
import { cardFileOf } from '@web/modules/social-recovery/setup/card/file'
import type { RecoveryCard } from '@web/modules/social-recovery/setup/card/types'

const t = (key: string): string => i18n.t(key)

// Given in lower case; the file writes its checksummed form.
const ACCOUNT = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed' as Address
const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const PASSWORD = 'tide lantern orchid'

const hidden = (password: string): RecoveryCard => ({ account: ACCOUNT, level: 'hidden', password })
const PUBLIC: RecoveryCard = { account: ACCOUNT, level: 'public' }

const asText = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
const drawnText = (card: RecoveryCard): string =>
  pdfTextBlocks(cardFileOf(card, t).bytes)
    .map((block) => block.text)
    .join('\n')

describe('the card file', () => {
  it('is a PDF by its name and its type', () => {
    const file = cardFileOf(hidden(PASSWORD), t)
    expect(file.name.endsWith('.pdf')).toBe(true)
    expect(file.type).toBe('application/pdf')
  })

  it.each([
    ['the hidden level', hidden(PASSWORD)],
    ['the public level', PUBLIC]
  ])('starts with the PDF header and ends with the end-of-file marker at %s', (_, card) => {
    const text = asText(cardFileOf(card, t).bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('holds exactly one page', () => {
    const text = asText(cardFileOf(hidden(PASSWORD), t).bytes)
    expect(text.match(/\/Type\s*\/Page(?![A-Za-z])/g)).toHaveLength(1)
  })

  it.each([
    ['the hidden level', hidden(PASSWORD)],
    ['the public level', PUBLIC],
    ['a password outside the encoding', hidden('日本 🔑')]
  ])('points startxref at the table and each table entry at its object at %s', (_, card) => {
    const { file, startxref, firstObject, entries, trailer } = pdfFileParts(
      cardFileOf(card, t).bytes
    )
    expect(file.slice(startxref, startxref + 4)).toBe('xref')
    expect(firstObject).toBe(0)
    expect(entries[0]).toEqual({ offset: 0, generation: 65535, inUse: false })

    const inUse = entries.slice(1)
    expect(inUse.length).toBeGreaterThan(0)
    inUse.forEach((entry, at) => {
      const header = `${at + 1} ${entry.generation} obj`
      expect(entry.inUse).toBe(true)
      expect(file.slice(entry.offset, entry.offset + header.length)).toBe(header)
      // The object starts at the offset, not in the middle of another line.
      expect(file[entry.offset - 1]).toBe('\n')
    })

    const written = Array.from(file.matchAll(/(?:^|\n)(\d+) 0 obj\b/g), ([, n]) => Number(n))
    expect(written).toEqual(inUse.map((_entry, at) => at + 1))
    expect(trailer).toMatch(new RegExp(`/Size ${entries.length}\\b`))
    const root = trailer.match(/\/Root (\d+) 0 R/)?.[1]
    expect(root).toBeDefined()
    const rootAt = entries[Number(root)].offset
    expect(file.slice(rootAt)).toMatch(/^\d+ 0 obj\s*<<\s*\/Type \/Catalog/)
  })

  it.each([
    ['a short password', hidden(PASSWORD)],
    ['a password that wraps over several lines', hidden('orchid '.repeat(40))],
    ['a password outside the encoding', hidden('日本 🔑')]
  ])('declares the content stream length it writes, for %s', (_, card) => {
    const { content } = pdfFileParts(cardFileOf(card, t).bytes)
    expect(content.text.length).toBeGreaterThan(0)
    expect(content.declaredLength).toBe(content.text.length)
  })

  it('draws the address and the password at the hidden level', () => {
    const { content } = pdfFileParts(cardFileOf(hidden(PASSWORD), t).bytes)
    expect(content.text).toContain(`(${CHECKSUMMED}) Tj`)
    expect(content.text).toContain(`(${PASSWORD}) Tj`)
    expect(drawnText(hidden(PASSWORD))).toContain(PASSWORD)
  })

  it('draws the address and no password at the public level, even when one is held', () => {
    const card: RecoveryCard = { ...PUBLIC, password: PASSWORD }
    const bytes = cardFileOf(card, t).bytes
    expect(pdfFileParts(bytes).content.text).toContain(`(${CHECKSUMMED}) Tj`)
    expect(asText(bytes)).not.toContain('orchid')
    expect(drawnText(card)).not.toContain('orchid')
  })

  it('escapes the backslash and both parentheses in a value and reads them back as typed', () => {
    const password = 'a(b)c\\d)(e\\'
    const { content } = pdfFileParts(cardFileOf(hidden(password), t).bytes)
    expect(content.text).toContain('(a\\(b\\)c\\\\d\\)\\(e\\\\) Tj')
    expect(drawnText(hidden(password))).toContain(password)
  })

  it('writes a character outside the encoding as its code and says so', () => {
    const file = cardFileOf(hidden('pass 日本 🔑'), t)
    const { content } = pdfFileParts(file.bytes)
    expect(file.replacedCharacters).toBe(true)
    expect(content.text).toContain('U+65E5U+672C')
    expect(content.text).toContain('U+1F511')
    expect(drawnText(hidden('pass 日本 🔑'))).toContain('pass U+65E5U+672C U+1F511')
  })

  it('writes the encoding’s own characters as they are and says nothing was replaced', () => {
    const password = 'café €5 – orchid’s “tide”'
    const file = cardFileOf(hidden(password), t)
    expect(file.replacedCharacters).toBe(false)
    expect(asText(file.bytes)).not.toContain('U+')
    expect(drawnText(hidden(password))).toContain(password)
    expect(cardFileOf(PUBLIC, t).replacedCharacters).toBe(false)
  })

  it('keeps the content stream in printable ASCII whatever the password holds', () => {
    const { content } = pdfFileParts(cardFileOf(hidden('café 日本 €'), t).bytes)
    expect(content.text).toMatch(/^[\x20-\x7e\n]*$/)
  })
})
