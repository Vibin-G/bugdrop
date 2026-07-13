import { describe, expect, it } from 'vitest';
import {
  resolveFeedbackProvider,
  resolveSubmissionUrl,
  shouldCheckProviderInstallation,
} from '../src/widget/provider-config';

describe('provider configuration', () => {
  it('keeps GitHub as the backwards-compatible default', () => {
    expect(resolveFeedbackProvider(undefined)).toBe('github');
    expect(shouldCheckProviderInstallation('github')).toBe(true);
  });

  it('uses an explicit endpoint and skips GitHub checks for Linear', () => {
    const provider = resolveFeedbackProvider('linear');

    expect(provider).toBe('linear');
    expect(shouldCheckProviderInstallation(provider)).toBe(false);
    expect(
      resolveSubmissionUrl(
        'https://example.supabase.co/functions/v1/linear-feedback',
        'https://legacy.example/api'
      )
    ).toBe('https://example.supabase.co/functions/v1/linear-feedback');
  });

  it('falls back to the legacy BugDrop feedback route', () => {
    expect(resolveSubmissionUrl(undefined, 'https://bugdrop.example/api')).toBe(
      'https://bugdrop.example/api/feedback'
    );
  });

  it('does not rewrite an explicit submission endpoint', () => {
    expect(
      resolveSubmissionUrl('https://example.supabase.co/functions/v1/linear-feedback/', '')
    ).toBe('https://example.supabase.co/functions/v1/linear-feedback/');
  });

  it('rejects unsupported providers', () => {
    expect(() => resolveFeedbackProvider('jira')).toThrow('Unsupported feedback provider');
  });
});
