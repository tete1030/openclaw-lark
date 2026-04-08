import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequesterSenderId } from '../src/core/requester-sender-scope';

const mocks = vi.hoisted(() => ({
  shouldRegisterTool: vi.fn(),
  getEnabledLarkAccounts: vi.fn(),
  getLarkAccount: vi.fn(),
  getResolvedConfig: vi.fn(),
  fromAccount: vi.fn(),
  getTicket: vi.fn(),
}));

vi.mock('../src/core/tools-config', () => ({
  shouldRegisterTool: (...args: unknown[]) => mocks.shouldRegisterTool(...args),
}));

vi.mock('../src/core/accounts', () => ({
  getEnabledLarkAccounts: (...args: unknown[]) => mocks.getEnabledLarkAccounts(...args),
  getLarkAccount: (...args: unknown[]) => mocks.getLarkAccount(...args),
}));

vi.mock('../src/core/lark-client', () => ({
  getResolvedConfig: (...args: unknown[]) => mocks.getResolvedConfig(...args),
  LarkClient: {
    fromAccount: (...args: unknown[]) => mocks.fromAccount(...args),
  },
}));

vi.mock('../src/core/lark-ticket', () => ({
  getTicket: (...args: unknown[]) => mocks.getTicket(...args),
}));

import { registerTool } from '../src/tools/helpers';

describe('registerTool requester sender propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shouldRegisterTool.mockReturnValue(true);
    mocks.getResolvedConfig.mockReturnValue({});
    mocks.getEnabledLarkAccounts.mockReturnValue([]);
    mocks.getTicket.mockReturnValue(undefined);
  });

  it('wraps static tools with per-run requester sender context', async () => {
    const registerToolMock = vi.fn();
    const api = {
      config: {},
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool: registerToolMock,
    } as never;

    let seenSender: string | undefined;
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: null,
    }));
    execute.mockImplementation(async () => {
      seenSender = getRequesterSenderId();
      return {
        content: [{ type: 'text' as const, text: 'ok' }],
        details: null,
      };
    });

    registerTool(api, {
      name: 'feishu_static_probe',
      label: 'Feishu static probe',
      description: 'probe',
      parameters: { type: 'object', properties: {} },
      execute,
    });

    const registered = registerToolMock.mock.calls[0]?.[0] as
      | ((ctx: { requesterSenderId?: string }) => { execute: (...args: unknown[]) => Promise<unknown> })
      | undefined;

    expect(typeof registered).toBe('function');
    const wrapped = registered?.({ requesterSenderId: 'ou_static_sender' });
    await wrapped?.execute('tool-call-1', {}, undefined, undefined);

    expect(execute).toHaveBeenCalled();
    expect(seenSender).toBe('ou_static_sender');
    expect(getRequesterSenderId()).toBeUndefined();
  });
});
