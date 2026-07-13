import { describe, expect, it } from 'vitest';
import { isNativeScreenshotCandidate } from '../src/widget/native-screenshot';

describe('native screenshot source validation', () => {
  it('accepts common phone screenshot formats and Android image/jpg aliases', () => {
    expect(
      isNativeScreenshotCandidate(new File(['jpeg'], 'Screenshot.jpg', { type: 'image/jpg' }))
    ).toBe(true);
    expect(isNativeScreenshotCandidate(new File(['png'], 'Screenshot.PNG'))).toBe(true);
  });

  it('rejects active vector images before browser decoding', () => {
    const svg = new File(['<svg><script>alert(1)</script></svg>'], 'screenshot.svg', {
      type: 'image/svg+xml',
    });
    expect(isNativeScreenshotCandidate(svg)).toBe(false);
    expect(isNativeScreenshotCandidate(new File(['heic'], 'IMG_0001.HEIC'))).toBe(false);
  });
});
