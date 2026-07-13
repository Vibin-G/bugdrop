import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadScreenshotAsAsset } from '../src/lib/github';

describe('GitHub screenshot uploads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['image/jpeg', 'jpg', '/9j/2Q=='],
    ['image/webp', 'webp', 'UklGRgQAAABXRUJQ'],
  ])(
    'stores %s screenshots with the matching extension',
    async (contentType, extension, base64) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: { html_url: 'https://github.example/blob' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        uploadScreenshotAsAsset('token', 'owner', 'repo', `data:${contentType};base64,${base64}`)
      ).resolves.toBe('https://github.example/blob?raw=true');

      const uploadRequest = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(uploadRequest[0]).toMatch(new RegExp(`/screenshots/\\d+\\.${extension}$`));
      expect(JSON.parse(String(uploadRequest[1].body))).toEqual(
        expect.objectContaining({ content: base64, branch: 'bugdrop-screenshots' })
      );
    }
  );
});
