/**
 * The decoder of an uploaded QR image: the Aadhaar secure QR code encodes one
 * big number, which the prover takes as its decimal text.
 *
 * The image is drawn on a canvas and its pixels decoded. A large photo often
 * fails at full size, so a failed decode is tried once more with the image
 * scaled to a fixed width.
 */
import jsQR from 'jsqr'

/** The width a failed decode is tried again at. */
export const QR_RETRY_WIDTH = 1024

const DECIMAL = /^[0-9]+$/

/** The decimal text of the code drawn at `width` by `height`, or undefined. */
const decodeAt = (image: ImageBitmap, width: number, height: number): string | undefined => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return undefined
  }
  context.drawImage(image, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  const code = jsQR(data, width, height)
  return code && DECIMAL.test(code.data) ? code.data : undefined
}

/**
 * The decimal text of the QR code in an image file, or undefined where the
 * file is no image the browser reads, holds no code, or holds a code that is
 * not one decimal number.
 */
export const qrDataOfImage = async (file: Blob): Promise<string | undefined> => {
  let image: ImageBitmap
  try {
    image = await createImageBitmap(file)
  } catch {
    return undefined
  }
  try {
    const { width, height } = image
    if (width === 0 || height === 0) {
      return undefined
    }
    const found = decodeAt(image, width, height)
    if (found !== undefined || width === QR_RETRY_WIDTH) {
      return found
    }
    return decodeAt(
      image,
      QR_RETRY_WIDTH,
      Math.max(1, Math.round((height * QR_RETRY_WIDTH) / width))
    )
  } catch {
    return undefined
  } finally {
    image.close?.()
  }
}
