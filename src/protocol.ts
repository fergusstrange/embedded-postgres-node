import { PostgresError } from './errors.js';

export type ProtocolEvent =
  | { protocol: 1; event: 'ready'; connection_url: string; port: number }
  | { protocol: 1; event: 'stopped' }
  | { protocol: 1; event: 'error'; error: string };

const limit = 64 * 1024;

/** Incremental JSON-lines parser. Never include raw protocol in diagnostics. */
export class ProtocolParser {
  private pending = '';
  constructor(private readonly onEvent: (event: ProtocolEvent) => void) {}

  push(chunk: string): void {
    this.pending += chunk;
    let newline: number;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      this.line(line);
    }
    if (this.pending.length > limit) throw new PostgresError('PROTOCOL', 'CLI protocol line exceeds 64 KiB');
  }

  finish(): void {
    if (this.pending) this.line(this.pending);
    this.pending = '';
  }

  private line(line: string): void {
    if (line.length > limit) throw new PostgresError('PROTOCOL', 'CLI protocol line exceeds 64 KiB');
    if (!line.trim()) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new PostgresError('PROTOCOL', 'CLI emitted invalid JSON'); }
    if (!value || typeof value !== 'object' || !('protocol' in value) || value.protocol !== 1 || !('event' in value)) {
      throw new PostgresError('PROTOCOL', 'CLI must speak protocol 1');
    }
    const event = value as Record<string, unknown>;
    if (event.event === 'ready') {
      if (!Number.isInteger(event.port) || (event.port as number) < 1 || (event.port as number) > 65535 || typeof event.connection_url !== 'string') {
        throw new PostgresError('PROTOCOL', 'Invalid CLI ready event');
      }
      let url: URL;
      try { url = new URL(event.connection_url); } catch { throw new PostgresError('PROTOCOL', 'Invalid CLI connection URL'); }
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new PostgresError('PROTOCOL', 'Invalid CLI connection URL scheme');
    } else if (event.event === 'error') {
      if (typeof event.error !== 'string') throw new PostgresError('PROTOCOL', 'Invalid CLI error event');
    } else if (event.event !== 'stopped') {
      throw new PostgresError('PROTOCOL', 'Unknown CLI protocol event');
    }
    this.onEvent(value as ProtocolEvent);
  }
}
