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

// An object URL, revoked right after the click, so the browser's download
// history never keeps the card's text in the file's source address.
const downloadFile = (file: CardFile): void => {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.type }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.rel = 'noopener'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}

export const BROWSER_CARRIERS: CardCarriers = {
  download: downloadFile,
  print: () => window.print()
}
