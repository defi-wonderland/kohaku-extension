/**
 * What the card tests share: the fake recovery client the screen test hands
 * the screen, a promise a test settles by hand, the refusal the setup read
 * throws when a password does not open the saved backup, and the refusal a
 * client built against another digest version fails with, and readers of the
 * card's PDF: the text it draws and the parts of its file.
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

/** One text block the PDF draws: its font resource and its strings joined. */
export interface PdfTextBlock {
  font: string
  text: string
}

/** One entry of the PDF's cross-reference table, in table order from object 0. */
export interface PdfXrefEntry {
  offset: number
  generation: number
  inUse: boolean
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
  /** The page's content stream as written, with its declared length. */
  content: { declaredLength: number; text: string }
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

// The characters the Windows encoding places at the bytes 0x80 to 0x9f, where
// Latin-1 has control codes; every other byte reads the same in both.
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

const winAnsiChar = (byte: number): string => String.fromCodePoint(WIN_ANSI_HIGH[byte] ?? byte)

const decodeLiteral = (literal: string): string =>
  literal.replace(/\\([0-7]{3}|[\\()])/g, (_, escaped: string) =>
    escaped.length === 3 ? winAnsiChar(parseInt(escaped, 8)) : escaped
  )

const fileOf = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

/**
 * The PDF's text blocks in drawing order, each block's wrapped lines joined
 * back into its text, read in the Windows encoding the fonts declare.
 */
export const pdfTextBlocks = (bytes: Uint8Array): PdfTextBlock[] =>
  Array.from(fileOf(bytes).matchAll(/\nBT\n([\s\S]*?)\nET/g), ([, block]) => ({
    font: block.match(/(\/F\d+) [\d.]+ Tf/)?.[1] ?? '',
    text: Array.from(block.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g), ([, literal]) =>
      decodeLiteral(literal)
    ).join('')
  }))

/**
 * The file read the way a reader reads it: `startxref` from the end, the
 * cross-reference table and the trailer at that offset, and the one content
 * stream with the length its dictionary declares. Throws where a part is missing.
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
  const stream = file.match(/<< \/Length (\d+) >>\r?\nstream\r?\n([\s\S]*?)\r?\nendstream/)
  if (!stream) {
    throw new Error('no content stream')
  }
  return {
    file,
    startxref,
    firstObject: Number(table[1]),
    entries,
    trailer: table[4],
    content: { declaredLength: Number(stream[1]), text: stream[2] }
  }
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
