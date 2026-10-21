/** The part of the `qrcode` package a test draws a code with: the module grid of a text. */
export interface QrCodeLibrary {
  create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }
  ): { modules: { size: number; data: Uint8Array } }
}

/**
 * An image a test hands the decoder: its natural size and the RGBA pixels it
 * shows when drawn at a given size.
 */
export interface FakePicture {
  width: number
  height: number
  pixelsAt(width: number, height: number): Uint8ClampedArray
}

/** One draw the decoder made on its canvas: the size it drew the image at. */
export interface CanvasDraw {
  width: number
  height: number
}
