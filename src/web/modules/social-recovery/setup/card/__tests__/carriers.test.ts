/**
 * @jest-environment jsdom
 *
 * jsdom has no object URLs, so the test installs its own and watches the
 * link the carrier clicks.
 */
import type { CardFile } from '..'
import { BROWSER_CARRIERS } from '../carriers'

const FILE: CardFile = {
  name: 'card.html',
  type: 'text/html',
  text: '<p>tide lantern orchid</p>'
}

const readBlob = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })

describe('the file carrier', () => {
  const OBJECT_URL = 'blob:chrome-extension://card/1'
  let blobs: Blob[]
  let revoked: string[]
  let clicks: { href: string; download: string; inPage: boolean; live: boolean }[]
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL

  beforeEach(() => {
    blobs = []
    revoked = []
    clicks = []
    URL.createObjectURL = jest.fn((blob: Blob) => {
      blobs.push(blob)
      return OBJECT_URL
    })
    URL.revokeObjectURL = jest.fn((url: string) => {
      revoked.push(url)
    })
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function click(this: HTMLAnchorElement) {
        clicks.push({
          href: this.href,
          download: this.download,
          inPage: this.parentElement === document.body,
          live: !revoked.includes(this.href)
        })
      })
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    jest.restoreAllMocks()
  })

  it('saves the file from an object URL built from its text and type', async () => {
    BROWSER_CARRIERS.download(FILE)
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe(FILE.type)
    expect(await readBlob(blobs[0])).toBe(FILE.text)
    expect(clicks).toEqual([{ href: OBJECT_URL, download: FILE.name, inPage: true, live: true }])
  })

  it('revokes the object URL after the click and leaves no link in the page', () => {
    BROWSER_CARRIERS.download(FILE)
    expect(revoked).toEqual([OBJECT_URL])
    expect(document.querySelector('a')).toBeNull()
  })

  it('never puts the text in a data URL', () => {
    BROWSER_CARRIERS.download(FILE)
    expect(clicks).toHaveLength(1)
    clicks.forEach(({ href }) => {
      expect(href.startsWith('data:')).toBe(false)
      expect(href).not.toContain('orchid')
    })
  })
})
