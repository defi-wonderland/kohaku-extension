/**
 * The card as a one-page A4 PDF, written by hand: the title, each row's label
 * and value, and the card's lines, inside a thin border. It uses the three
 * standard fonts every reader carries, Helvetica and Helvetica-Bold for the
 * text and Courier for the values, in their single-byte Windows encoding. A
 * character that encoding lacks is written as its `U+XXXX` code, so nothing is
 * dropped without a trace, and the result says that happened.
 */
import type { CardPdf, CardRow, PdfBlock, PdfFont, PdfText } from './types'

// A4 in points.
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 56
const PADDING = 24
const BOX_WIDTH = PAGE_WIDTH - 2 * MARGIN
const TEXT_X = MARGIN + PADDING
const TEXT_WIDTH = BOX_WIDTH - 2 * PADDING
const LEADING = 1.35

const FONT_NAMES: Record<PdfFont, string> = {
  regular: '/F1',
  bold: '/F2',
  mono: '/F3'
}

// The advance of one character as a share of the font size. Courier's is exact;
// Helvetica's are wide estimates for ordinary text, so a wrapped line never
// runs past the border.
const ADVANCE: Record<PdfFont, number> = {
  regular: 0.56,
  bold: 0.6,
  mono: 0.6
}

const TEXT_GREY = 0.07
const LABEL_GREY = 0.35
const BORDER_GREY = 0.6

// The characters the Windows encoding places between 0x80 and 0x9f; every other
// byte it shares with Latin-1.
const WIN_ANSI_HIGH = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
])

const winAnsiByteOf = (codePoint: number): number | undefined =>
  (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)
    ? codePoint
    : WIN_ANSI_HIGH.get(codePoint)

const codeOf = (codePoint: number): string =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`

const toWinAnsi = (text: string): PdfText => {
  let replacedCharacters = false
  const units = Array.from(text, (char) => {
    const codePoint = char.codePointAt(0) ?? 0
    const byte = winAnsiByteOf(codePoint)
    if (byte === undefined) {
      replacedCharacters = true
      return codeOf(codePoint)
    }
    return String.fromCharCode(byte)
  })
  return { units, replacedCharacters }
}

const widthOf = (units: string[]): number => units.reduce((sum, unit) => sum + unit.length, 0)

// Breaks anywhere, keeping every character, a `U+XXXX` code whole.
const wrapAnywhere = (units: string[], max: number): string[][] => {
  const lines: string[][] = []
  let line: string[] = []
  let width = 0
  units.forEach((unit) => {
    if (line.length && width + unit.length > max) {
      lines.push(line)
      line = []
      width = 0
    }
    line.push(unit)
    width += unit.length
  })
  if (line.length) {
    lines.push(line)
  }
  return lines
}

// Breaks after the spaces between words, which stay at the end of their line
// so the lines joined give back the text; a word wider than a line breaks anywhere.
const wrapAtSpaces = (units: string[], max: number): string[][] => {
  const words: string[][] = []
  let word: string[] = []
  units.forEach((unit, at) => {
    word.push(unit)
    if (unit === ' ' && units[at + 1] !== ' ') {
      words.push(word)
      word = []
    }
  })
  if (word.length) {
    words.push(word)
  }

  const lines: string[][] = []
  let line: string[] = []
  let width = 0
  words.forEach((current) => {
    let ink = widthOf(current)
    for (let at = current.length - 1; at >= 0 && current[at] === ' '; at -= 1) {
      ink -= 1
    }
    if (line.length && width + ink > max) {
      lines.push(line)
      line = []
      width = 0
    }
    if (ink > max) {
      const pieces = wrapAnywhere(current, max)
      lines.push(...pieces.slice(0, -1))
      line = [...pieces[pieces.length - 1]]
      width = widthOf(line)
      return
    }
    line.push(...current)
    width += widthOf(current)
  })
  if (line.length) {
    lines.push(line)
  }
  return lines
}

const blockOf = (text: string, font: PdfFont, size: number, grey: number, gapAfter: number) => {
  const { units, replacedCharacters } = toWinAnsi(text)
  const max = Math.max(6, Math.floor(TEXT_WIDTH / (size * ADVANCE[font])))
  const lines = font === 'mono' ? wrapAnywhere(units, max) : wrapAtSpaces(units, max)
  const block: PdfBlock = { font, size, grey, lines: lines.length ? lines : [[]], gapAfter }
  return { block, replacedCharacters }
}

const blocksOf = (title: string, rows: CardRow[]) => {
  const made = [
    blockOf(title, 'bold', 14, TEXT_GREY, 14),
    ...rows.flatMap((row) =>
      row.kind === 'value'
        ? [
            blockOf(row.label, 'bold', 9, LABEL_GREY, 4),
            blockOf(row.value, 'mono', 11, TEXT_GREY, 14)
          ]
        : [blockOf(row.text, 'regular', 11, TEXT_GREY, 8)]
    )
  ]
  return {
    blocks: made.map(({ block }) => block),
    replacedCharacters: made.some(({ replacedCharacters }) => replacedCharacters)
  }
}

const num = (value: number): string => String(Number(value.toFixed(2)))

// A literal string: the backslash and both parentheses escaped, every byte
// outside printable ASCII written in octal, so the content stream stays ASCII.
const literalOf = (units: string[]): string =>
  `(${units
    .map((unit) => {
      if (unit.length > 1) {
        return unit
      }
      if (unit === '\\' || unit === '(' || unit === ')') {
        return `\\${unit}`
      }
      const code = unit.charCodeAt(0)
      return code < 0x20 || code > 0x7e ? `\\${code.toString(8).padStart(3, '0')}` : unit
    })
    .join('')})`

const contentOf = (blocks: PdfBlock[]): string => {
  const top = PAGE_HEIGHT - MARGIN
  let y = top - PADDING
  const text = blocks.map((block) => {
    const shown = block.lines.map((line, at) => {
      const baseline = y - block.size - at * block.size * LEADING
      return `1 0 0 1 ${num(TEXT_X)} ${num(baseline)} Tm ${literalOf(line)} Tj`
    })
    y -= block.size + (block.lines.length - 1) * block.size * LEADING + block.gapAfter
    return [
      'BT',
      `${FONT_NAMES[block.font]} ${num(block.size)} Tf`,
      `${num(block.grey)} g`,
      ...shown,
      'ET'
    ].join('\n')
  })
  const bottom = y - PADDING + blocks[blocks.length - 1].gapAfter
  const box = [MARGIN, bottom, BOX_WIDTH, top - bottom].map(num).join(' ')
  const border = `${num(BORDER_GREY)} G 0.75 w ${box} re S`
  return [border, ...text].join('\n')
}

const fontObject = (baseFont: string): string =>
  `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /Encoding /WinAnsiEncoding >>`

// Every byte of the file is below 0x100, one character each, so a string's
// length is its byte length and each offset is counted in bytes.
const serialise = (content: string): Uint8Array<ArrayBuffer> => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>',
    fontObject('Helvetica'),
    fontObject('Helvetica-Bold'),
    fontObject('Courier'),
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ]
  // The second line's high bytes mark the file as binary for tools that guess.
  let file = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = objects.map((body, at) => {
    const offset = file.length
    file += `${at + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = file.length
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join('')}`
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(file, (char) => char.charCodeAt(0))
}

export const cardPdfOf = (title: string, rows: CardRow[]): CardPdf => {
  const { blocks, replacedCharacters } = blocksOf(title, rows)
  return { bytes: serialise(contentOf(blocks)), replacedCharacters }
}
