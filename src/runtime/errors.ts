export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(/(password|private.?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

export function errorStatusCodes(error: unknown): readonly number[] {
  if (!isRecord(error)) {
    return [];
  }

  const response = isRecord(error.response) ? error.response : undefined;
  const responseData = response && isRecord(response.data) ? response.data : undefined;
  const responseError = responseData && isRecord(responseData.error) ? responseData.error : undefined;
  const candidates = [error.status, response?.status, error.code, responseError?.code];

  return candidates.filter((candidate): candidate is number | string =>
    typeof candidate === 'number' || typeof candidate === 'string'
  ).flatMap((candidate) => {
    const status = Number(candidate);
    return Number.isFinite(status) ? [status] : [];
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
