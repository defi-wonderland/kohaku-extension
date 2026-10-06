/**
 * What the card tests share: the fake recovery client the screen test hands
 * the screen, a promise a test settles by hand, the refusal the setup read
 * throws when a password does not open the saved backup, and the refusal a
 * client built against another digest version fails with, and readers of the
 * card's PDF: the text it draws, the values it draws over one page or several,
 * and the parts of its file.
 */
import type { RestoreCause, RestoreRefusal } from '@web/modules/social-recovery/sdk-interfaces'
import type { DigestVersionRefusal } from '@web/modules/social-recovery/shared/client'

/** The two setup reads the card's password row calls on the client. */
export interface FakeSetupReads {
  setupState: jest.Mock
  getSetup: jest.Mock
}

/** The client state the screen sees, as the client hook answers it. */
export type FakeClientState =
  | { status: 'loading' }
  | { status: 'ready'; client: { setup: FakeSetupReads } }
  | { status: 'failed'; error: unknown }
  | { status: 'update-the-wallet'; refusal: DigestVersionRefusal }

/** One line a text block draws: where its baseline starts, and its string. */
export interface PdfDrawnLine {
  x: number
  y: number
  text: string
}

/** One text block the PDF draws: its font resource and size, its grey, its page, its lines, and their strings joined. */
export interface PdfTextBlock {
  font: string
  size: number
  grey: number
  /** The page it is drawn on, from 0, in the page tree's order. */
  page: number
  lines: PdfDrawnLine[]
  text: string
}

/** A line drawn on a page, in a font size and a grey. */
export interface PdfPlacedLine extends PdfDrawnLine {
  page: number
  size: number
  grey: number
}

/** One value as the PDF draws it in the fixed-width font, over every page it spans. */
export interface PdfDrawnValue {
  lines: PdfPlacedLine[]
  /** The marks drawn beside the value's lines, in the grey of the value's label. */
  marks: PdfPlacedLine[]
  /** The value's lines joined, the marks left out. */
  text: string
  /** The grey of the label that names the value. */
  labelGrey: number
}

/** One entry of the PDF's cross-reference table, in table order from object 0. */
export interface PdfXrefEntry {
  offset: number
  generation: number
  inUse: boolean
}

/** A stream as written, with its object number and the length its dictionary declares. */
export interface PdfStream {
  object: number
  declaredLength: number
  text: string
}

/** A page object and the object number of its content stream. */
export interface PdfPageObject {
  object: number
  contents: number
}

/** The parts of a PDF file a reader finds its way by. */
export interface PdfFileParts {
  /** The file, one character per byte. */
  file: string
  startxref: number
  /** The first object number of the table's one subsection. */
  firstObject: number
  entries: PdfXrefEntry[]
  trailer: string
  /** The page tree's kids, as object numbers. */
  kids: number[]
  /** The page count the page tree declares. */
  count: number
  /** Every object whose type is a page, in file order. */
  pages: PdfPageObject[]
  /** Every stream, in file order. */
  streams: PdfStream[]
}

/** A promise with its two ends in the test's hands. */
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

export const restoreRefusalOf = (cause: RestoreCause): RestoreRefusal => {
  const error = new Error(`The restore refused: ${cause}`) as RestoreRefusal
  error.name = 'RestoreRefusal'
  error.cause = { code: cause, subject: 'setup', values: {} }
  return error
}

/** The refusal of a client built against another deployment's digest version. */
export const digestVersionRefusal = (): DigestVersionRefusal =>
  Object.assign(new Error('The manager publishes another digest version.'), {
    name: 'DigestVersionRefusal' as const,
    state: 'update-the-wallet' as const,
    carried: { name: 'Recovery', version: '1' }
  })

// The characters the Windows code page 1252 places at the bytes 0x80 to 0x9f,
// where Latin-1 has control codes; 0x81, 0x8d, 0x8f, 0x90 and 0x9d hold none.
// Every other byte reads the same in both.
const WIN_ANSI_HIGH: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178
}

/** The code page's characters at the bytes 0x80 to 0x9f, as pairs of byte and code point. */
export const winAnsiHighEntries = (): Array<[number, number]> =>
  Object.entries(WIN_ANSI_HIGH).map(([byte, codePoint]) => [Number(byte), codePoint])

const winAnsiChar = (byte: number): string => String.fromCodePoint(WIN_ANSI_HIGH[byte] ?? byte)

const decodeLiteral = (literal: string): string =>
  literal.replace(/\\([0-7]{3}|[\\()])/g, (_, escaped: string) =>
    escaped.length === 3 ? winAnsiChar(parseInt(escaped, 8)) : escaped
  )

const fileOf = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

/**
 * The file read the way a reader reads it: `startxref` from the end, the
 * cross-reference table and the trailer at that offset, the page tree, each
 * page object, and every stream with the length its dictionary declares.
 * Throws where a part is missing.
 */
export const pdfFileParts = (bytes: Uint8Array): PdfFileParts => {
  const file = fileOf(bytes)
  const tail = file.match(/startxref\r?\n(\d+)\r?\n%%EOF\s*$/)
  if (!tail) {
    throw new Error('no startxref before the end of the file')
  }
  const startxref = Number(tail[1])
  const table = file
    .slice(startxref)
    .match(/^xref\r?\n(\d+) (\d+)\r?\n((?:\d{10} \d{5} [nf][ \r]\n)*)trailer\s*(<<[\s\S]*?>>)/)
  if (!table) {
    throw new Error('no cross-reference table at startxref')
  }
  const entries = Array.from(table[3].matchAll(/(\d{10}) (\d{5}) ([nf])/g), ([, o, g, kind]) => ({
    offset: Number(o),
    generation: Number(g),
    inUse: kind === 'n'
  }))
  if (entries.length !== Number(table[2])) {
    throw new Error('the subsection counts another number of entries')
  }

  const objects = Array.from(
    file.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g),
    ([, n, body]) => ({ object: Number(n), body })
  )
  const tree = objects.find(({ body }) => /\/Type \/Pages\b/.test(body))?.body
  const kids = tree?.match(/\/Kids \[([^\]]*)\]/)?.[1]
  const count = tree?.match(/\/Count (\d+)/)?.[1]
  if (kids === undefined || count === undefined) {
    throw new Error('no page tree')
  }
  const pages = objects.flatMap(({ object, body }) => {
    if (!/\/Type \/Page(?![A-Za-z])/.test(body)) {
      return []
    }
    const contents = body.match(/\/Contents (\d+) 0 R/)?.[1]
    if (contents === undefined) {
      throw new Error(`page ${object} names no content stream`)
    }
    return [{ object, contents: Number(contents) }]
  })
  const streams = objects.flatMap(({ object, body }) => {
    const stream = body.match(/^<< \/Length (\d+) >>\r?\nstream\r?\n([\s\S]*?)\r?\nendstream$/)
    return stream ? [{ object, declaredLength: Number(stream[1]), text: stream[2] }] : []
  })
  if (!streams.length) {
    throw new Error('no content stream')
  }

  return {
    file,
    startxref,
    firstObject: Number(table[1]),
    entries,
    trailer: table[4],
    kids: Array.from(kids.matchAll(/(\d+) 0 R/g), ([, n]) => Number(n)),
    count: Number(count),
    pages,
    streams
  }
}

/**
 * The PDF's text blocks in drawing order, page after page in the page tree's
 * order, each with its lines and their strings joined back into its text,
 * read in the Windows encoding the fonts declare.
 */
export const pdfTextBlocks = (bytes: Uint8Array): PdfTextBlock[] => {
  const { kids, pages, streams } = pdfFileParts(bytes)
  return kids.flatMap((kid, page) => {
    const contents = pages.find(({ object }) => object === kid)?.contents
    const stream = streams.find(({ object }) => object === contents)
    if (!stream) {
      throw new Error(`page ${kid} has no content stream`)
    }
    return Array.from(stream.text.matchAll(/(?:^|\n)BT\n([\s\S]*?)\nET/g), ([, block]) => {
      const lines = Array.from(
        block.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm \(((?:\\.|[^\\)])*)\) Tj/g),
        ([, x, y, literal]) => ({ x: Number(x), y: Number(y), text: decodeLiteral(literal) })
      )
      const font = block.match(/(\/F\d+) ([\d.]+) Tf/)
      return {
        font: font?.[1] ?? '',
        size: Number(font?.[2] ?? NaN),
        grey: Number(block.match(/(?:^|\n)([\d.]+) g(?:\n|$)/)?.[1] ?? NaN),
        page,
        lines,
        text: lines.map((line) => line.text).join('')
      }
    })
  })
}

/**
 * The values the PDF draws in its fixed-width font, each as one piece however
 * many blocks and pages it spans. A block in that font drawn in the grey of
 * the label before it holds marks beside the value; any other holds the
 * value's own lines. A block in another font ends the value.
 */
export const pdfDrawnValues = (bytes: Uint8Array): PdfDrawnValue[] => {
  const values: PdfDrawnValue[] = []
  let current: PdfDrawnValue | undefined
  let labelGrey = NaN
  pdfTextBlocks(bytes).forEach((block) => {
    if (block.font !== '/F3') {
      current = undefined
      labelGrey = block.grey
      return
    }
    if (!current) {
      current = { lines: [], marks: [], text: '', labelGrey }
      values.push(current)
    }
    const { page, size, grey } = block
    const placed = block.lines.map((line) => ({ ...line, page, size, grey }))
    if (grey === labelGrey) {
      current.marks.push(...placed)
      return
    }
    current.lines.push(...placed)
    current.text += block.text
  })
  return values
}

// Jest runs every file under __tests__, this one included; its own check runs
// only when Jest runs this file, never from a file that imports the harness.
if (expect.getState().testPath === __filename) {
  describe('harness', () => {
    it('settles a held promise only when the test says, either way', async () => {
      const answered = deferred<string>()
      const refused = deferred<string>()
      const first = await Promise.race([answered.promise, Promise.resolve('still waiting')])
      expect(first).toBe('still waiting')
      answered.resolve('opened')
      refused.reject(new Error('refused'))
      await expect(answered.promise).resolves.toBe('opened')
      await expect(refused.promise).rejects.toThrow('refused')
    })

    it('throws a restore refusal as an error that carries its cause', () => {
      const refusal = restoreRefusalOf('restore.backup-unopened')
      expect(refusal).toBeInstanceOf(Error)
      expect(refusal.cause.code).toBe('restore.backup-unopened')
    })
  })
}
