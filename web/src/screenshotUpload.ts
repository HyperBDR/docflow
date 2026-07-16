export const SCREENSHOT_UPLOAD_LIMIT = 9 * 1024 * 1024
const MAX_SCREENSHOT_EDGE = 4096
const MAX_ENCODE_ATTEMPTS = 6

export class ScreenshotPreparationError extends Error {
  code: 'invalid_image' | 'too_large'

  constructor(code: 'invalid_image' | 'too_large') {
    super(code)
    this.code = code
  }
}

export type PreparedScreenshot = {
  file: File
  width: number
  height: number
  compressed: boolean
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new ScreenshotPreparationError('invalid_image')), 'image/webp', quality)
  })
}

/**
 * Keeps normal screenshots untouched and converts oversized screenshots to a
 * bounded WebP before upload. The API keeps its 10 MB hard limit; the smaller
 * client limit leaves room for encoding differences and future validation.
 */
export async function prepareScreenshot(file: File): Promise<PreparedScreenshot> {
  if (!file.type.startsWith('image/')) throw new ScreenshotPreparationError('invalid_image')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ScreenshotPreparationError('invalid_image')
  }

  try {
    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height
    if (!sourceWidth || !sourceHeight) throw new ScreenshotPreparationError('invalid_image')

    const edgeScale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(sourceWidth, sourceHeight))
    if (file.size <= SCREENSHOT_UPLOAD_LIMIT && edgeScale === 1) {
      return { file, width: sourceWidth, height: sourceHeight, compressed: false }
    }

    let width = Math.max(1, Math.round(sourceWidth * edgeScale))
    let height = Math.max(1, Math.round(sourceHeight * edgeScale))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new ScreenshotPreparationError('invalid_image')

    for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt += 1) {
      canvas.width = width
      canvas.height = height
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)

      const quality = Math.max(.5, .9 - attempt * .08)
      const blob = await canvasBlob(canvas, quality)
      if (blob.size <= SCREENSHOT_UPLOAD_LIMIT) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'screenshot'
        return {
          file: new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: file.lastModified }),
          width,
          height,
          compressed: true,
        }
      }

      const scale = Math.min(.85, Math.sqrt(SCREENSHOT_UPLOAD_LIMIT / blob.size) * .9)
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }
    throw new ScreenshotPreparationError('too_large')
  } finally {
    bitmap.close()
  }
}
