import type { Logger } from '../ports/logger.ts';

const SENSITIVE_KEY = /(password|private.?key|token|secret|authorization|credential|payload)/i;
const SENSITIVE_VALUE = /(-----BEGIN|bearer\s|password\s*[:=]|private.?key\s*[:=])/i;

function formatDetails(details: Readonly<Record<string, unknown>> | undefined): string {
  if (!details || Object.keys(details).length === 0) {
    return '';
  }
  return ` ${JSON.stringify(sanitizeRecord(details))}`;
}

function sanitizeRecord(details: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(value)])
  );
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return SENSITIVE_VALUE.test(value) ? '[REDACTED]' : value.slice(0, 500);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeRecord(value as Readonly<Record<string, unknown>>);
  }
  return value;
}

export const consoleLogger: Logger = {
  info(message, details) {
    console.info(new Date().toISOString(), message + formatDetails(details));
  },
  warn(message, details) {
    console.warn(new Date().toISOString(), message + formatDetails(details));
  },
  error(message, details) {
    console.error(new Date().toISOString(), message + formatDetails(details));
  }
};
