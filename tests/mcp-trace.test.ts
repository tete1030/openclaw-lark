import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintSecret, isDocMcpTraceEnabled } from '../src/core/mcp-trace';

describe('mcp trace helpers', () => {
  const originalTraceFlag = process.env.OPENCLAW_TRACE_DOC_MCP;

  afterEach(() => {
    if (originalTraceFlag === undefined) {
      delete process.env.OPENCLAW_TRACE_DOC_MCP;
    } else {
      process.env.OPENCLAW_TRACE_DOC_MCP = originalTraceFlag;
    }
  });

  it('builds a stable short fingerprint without exposing the raw secret', () => {
    const secret = 'u-very-secret-access-token';
    const first = fingerprintSecret(secret);
    const second = fingerprintSecret(secret);

    expect(first).toBe(second);
    expect(first).toHaveLength(12);
    expect(first).not.toContain(secret);
  });

  it('enables doc MCP trace by default and allows explicit disable', () => {
    delete process.env.OPENCLAW_TRACE_DOC_MCP;
    expect(isDocMcpTraceEnabled()).toBe(true);

    process.env.OPENCLAW_TRACE_DOC_MCP = '1';
    expect(isDocMcpTraceEnabled()).toBe(true);

    process.env.OPENCLAW_TRACE_DOC_MCP = 'false';
    expect(isDocMcpTraceEnabled()).toBe(false);

    process.env.OPENCLAW_TRACE_DOC_MCP = '0';
    expect(isDocMcpTraceEnabled()).toBe(false);
  });
});
