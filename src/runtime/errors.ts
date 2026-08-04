export function errorMessage(error: unknown): string {
  const message = extractErrorMessage(error);
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(/bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s]+/gi, (url) => url.replace(/[?&][^\s]+$/, '?[QUERY_REDACTED]'))
    .replace(/\{[^{}]*\}|\[[^\[\]]*\]/g, '[DETAILS REDACTED]')
    .replace(/["'](password|private.?key(?:.?id)?|token|secret|client.?secret|authorization|credential|api(?:[-_ ]?key)|access[-_ ]?token|refresh[-_ ]?token)["']\s*:\s*["'][^"']*["']/gi, '$1=[REDACTED]')
    .replace(/([?&](?:api[-_ ]?key|token|access[-_ ]?token|client[-_ ]?secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(password|private.?key(?:.?id)?|token|secret|client.?secret|authorization|credential|api(?:[-_ ]?key)|access[-_ ]?token|refresh[-_ ]?token)\s*[:=]\s*["']?[^"',};\s]+["']?/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function extractErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const statusCode = numericValue(error.statusCode);
    const body = isRecord(error.body) ? error.body : undefined;
    const providerMessage = body && typeof body.message === 'string' ? body.message : undefined;
    if (providerMessage !== undefined) {
      return statusCode === undefined
        ? `Request failed: ${providerMessage}`
        : `Request failed with status ${statusCode}: ${providerMessage}`;
    }
    if (statusCode !== undefined) {
      return `Request failed with status ${statusCode}`;
    }
  }
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
