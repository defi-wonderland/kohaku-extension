/**
 * The browser's carriers: the file saved through a download link, and the
 * page printed while the print view hides everything but the card.
 */
import type { CardCarriers, CardFile } from './types'

/** The id of the print view's root, a direct child of the page's body. */
export const PRINT_VIEW_ID = 'recovery-card-print'

/** On screen the print view never shows; in print it is the only thing that does. */
export const PRINT_VIEW_CSS =
  `#${PRINT_VIEW_ID}{display:none}` +
  '@media print{' +
  `body>*:not(#${PRINT_VIEW_ID}){display:none!important}` +
  `#${PRINT_VIEW_ID}{display:block!important}` +
  '}'

export const fileUrlOf = (file: CardFile): string =>
  `data:${file.type};charset=utf-8,${encodeURIComponent(file.text)}`

const downloadFile = (file: CardFile): void => {
  const link = document.createElement('a')
  link.href = fileUrlOf(file)
  link.download = file.name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export const BROWSER_CARRIERS: CardCarriers = {
  download: downloadFile,
  print: () => window.print()
}
