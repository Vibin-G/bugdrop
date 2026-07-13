export type FeedbackProvider = 'github' | 'linear';

export function resolveFeedbackProvider(value: string | undefined): FeedbackProvider {
  if (!value || value === 'github') return 'github';
  if (value === 'linear') return 'linear';
  throw new Error(`Unsupported feedback provider: ${value}`);
}

export function shouldCheckProviderInstallation(provider: FeedbackProvider): boolean {
  return provider === 'github';
}

export function resolveSubmissionUrl(
  explicitSubmissionUrl: string | undefined,
  apiUrl: string
): string {
  const value = explicitSubmissionUrl?.trim();
  if (value) return value;
  return `${apiUrl.replace(/\/$/, '')}/feedback`;
}
