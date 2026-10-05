export type ErrorCode = 'CONFIG' | 'BINARY' | 'SPAWN' | 'PROTOCOL' | 'STARTUP' | 'TIMEOUT' | 'ABORTED' | 'EXIT' | 'SHUTDOWN';

/** Diagnostics deliberately omit command arguments, raw protocol and error causes. */
export class PostgresError extends Error {
  readonly code: ErrorCode;
  readonly stderr: string;
  constructor(code: ErrorCode, message: string, stderr = '') {
    super(message);
    this.name = 'PostgresError';
    this.code = code;
    this.stderr = stderr;
  }
}

export function redact(text: string, secrets: readonly string[]): string {
  // Redact complete URLs, including Unix-socket URLs and query parameters.
  let result = text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[redacted connection URL]');
  for (const secret of secrets) {
    if (secret) {
      result = result.split(secret).join('[redacted]');
      result = result.split(encodeURIComponent(secret)).join('[redacted]');
    }
  }
  return result;
}

export function positiveTimeout(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new PostgresError('CONFIG', `${name} must be an integer between 1 and 2147483647 milliseconds`);
  }
  return value;
}
