import { createHash } from 'node:crypto';

export function isDocMcpTraceEnabled(): boolean {
  const value = process.env.OPENCLAW_TRACE_DOC_MCP?.trim().toLowerCase();
  return value !== '0' && value !== 'false';
}

export function fingerprintSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}
