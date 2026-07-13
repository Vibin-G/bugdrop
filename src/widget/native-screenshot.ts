export const MAX_NATIVE_SCREENSHOT_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_NATIVE_SCREENSHOT_OUTPUT_BYTES = Math.floor(1.8 * 1024 * 1024);

const MAX_LONG_EDGE_PX = 2400;
const MAX_PIXEL_COUNT = 4_000_000;
const MAX_FALLBACK_DECODE_PIXELS = 12_000_000;
const JPEG_QUALITIES = [0.86, 0.72, 0.58];
const MAX_RESIZE_ATTEMPTS = 4;
const NATIVE_RASTER_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;
const NATIVE_RASTER_TYPE_SET = new Set<string>(NATIVE_RASTER_TYPES);
export const NATIVE_SCREENSHOT_ACCEPT = `${NATIVE_RASTER_TYPES.join(',')},.jpg,.jpeg,.png,.webp`;

export function isNativeScreenshotCandidate(file: File): boolean {
  if (file.type) return NATIVE_RASTER_TYPE_SET.has(file.type.toLowerCase());
  return /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

type ImageDimensions = { width: number; height: number };
type DecodedImage = ImageDimensions & { source: CanvasImageSource; close: () => void };

function targetDimensions({ width, height }: ImageDimensions): ImageDimensions {
  const longEdgeScale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_PIXEL_COUNT / (width * height)));
  const scale = Math.min(longEdgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function readSourceDimensions(file: File): Promise<ImageDimensions | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type =
    file.type ||
    (/\.png$/i.test(file.name)
      ? 'image/png'
      : /\.webp$/i.test(file.name)
        ? 'image/webp'
        : /\.jpe?g$/i.test(file.name)
          ? 'image/jpeg'
          : '');
  if (type === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if ((type === 'image/jpeg' || type === 'image/jpg') && bytes.length >= 4) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === undefined) return null;
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda) return null;
      const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
          width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        };
      }
      offset += segmentLength;
    }
  }
  if (
    type === 'image/webp' &&
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
        height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
        height: 1 + ((bytes[22]! & 0xc0) >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10),
      };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
      };
    }
  }
  return null;
}

function loadHtmlImage(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    image.addEventListener('load', () => {
      cleanup();
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          close: () => undefined,
        });
      } else reject(new Error('Image has no visible dimensions.'));
    });
    image.addEventListener('error', () => {
      cleanup();
      reject(new Error('Could not decode image.'));
    });
    image.src = url;
  });
}

async function loadImage(file: File): Promise<DecodedImage> {
  const dimensions = await readSourceDimensions(file);
  if (
    dimensions &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    typeof globalThis.createImageBitmap === 'function'
  ) {
    try {
      const target = targetDimensions(dimensions);
      const bitmap = await createImageBitmap(file, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Older engines can expose createImageBitmap without supporting resize options.
    }
  }
  if (dimensions && dimensions.width * dimensions.height > MAX_FALLBACK_DECODE_PIXELS) {
    throw new Error('Image dimensions are too large for safe browser conversion.');
  }
  return loadHtmlImage(file);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob?.type === 'image/jpeg') resolve(blob);
        else reject(new Error('Could not convert image.'));
      },
      'image/jpeg',
      quality
    );
  });
}

function normalizedFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim() || 'screenshot';
  return `${base}.jpg`;
}

export async function normalizeNativeScreenshotFile(file: File): Promise<File> {
  const image = await loadImage(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const initialTarget = targetDimensions(image);
  let scale = Math.min(initialTarget.width / sourceWidth, initialTarget.height / sourceHeight);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not convert image.');

  try {
    for (let attempt = 0; attempt < MAX_RESIZE_ATTEMPTS; attempt += 1) {
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);

      for (const quality of JPEG_QUALITIES) {
        const blob = await canvasToJpeg(canvas, quality);
        if (blob.size <= MAX_NATIVE_SCREENSHOT_OUTPUT_BYTES) {
          return new File([blob], normalizedFilename(file.name), {
            type: 'image/jpeg',
            lastModified: file.lastModified,
          });
        }
      }
      scale *= 0.82;
    }
  } finally {
    image.close();
  }

  throw new Error('Converted screenshot is still too large.');
}
