import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredLarkAccount } from '../src/core/types';
import { withRequesterSenderId } from '../src/core/requester-sender-scope';

const mocks = vi.hoisted(() => ({
  getTicket: vi.fn(),
  getEnabledLarkAccounts: vi.fn(),
  getLarkAccount: vi.fn(),
  getResolvedConfig: vi.fn(),
  fromAccount: vi.fn(),
  getRequiredScopes: vi.fn(),
  getAppGrantedScopes: vi.fn(),
  getAppOwnerFallback: vi.fn(),
  getStoredToken: vi.fn(),
  callWithUAT: vi.fn(),
  assertOwnerAccessStrict: vi.fn(),
  invalidateAppScopeCache: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/core/lark-ticket', () => ({
  getTicket: (...args: unknown[]) => mocks.getTicket(...args),
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

vi.mock('../src/core/scope-manager', () => ({
  getRequiredScopes: (...args: unknown[]) => mocks.getRequiredScopes(...args),
}));

vi.mock('../src/core/app-scope-checker', () => ({
  getAppGrantedScopes: (...args: unknown[]) => mocks.getAppGrantedScopes(...args),
  invalidateAppScopeCache: (...args: unknown[]) => mocks.invalidateAppScopeCache(...args),
  missingScopes: (granted: string[], required: string[]) => required.filter((scope) => !new Set(granted).has(scope)),
}));

vi.mock('../src/core/app-owner-fallback', () => ({
  getAppOwnerFallback: (...args: unknown[]) => mocks.getAppOwnerFallback(...args),
}));

vi.mock('../src/core/token-store', () => ({
  getStoredToken: (...args: unknown[]) => mocks.getStoredToken(...args),
}));

vi.mock('../src/core/uat-client', () => ({
  callWithUAT: (...args: unknown[]) => mocks.callWithUAT(...args),
}));

vi.mock('../src/core/owner-policy', () => ({
  assertOwnerAccessStrict: (...args: unknown[]) => mocks.assertOwnerAccessStrict(...args),
}));

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => mocks.logger,
}));

vi.mock('../src/core/mcp-trace', () => ({
  fingerprintSecret: () => 'hash',
  isDocMcpTraceEnabled: () => false,
}));

vi.mock('../src/core/raw-request', () => ({
  rawLarkRequest: vi.fn(),
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({
  withUserAccessToken: (token: string) => ({ token }),
}));

import { ToolClient, createToolClient } from '../src/core/tool-client';

describe('tool client sender identity precedence', () => {
  const config = {} as never;
  const account: ConfiguredLarkAccount = {
    accountId: 'default',
    enabled: true,
    configured: true,
    appId: 'app-1',
    appSecret: 'secret-1',
    brand: 'feishu',
    config: {
      allowFrom: ['*'],
      groupAllowFrom: [],
    },
  };
  const sdk = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getResolvedConfig.mockReturnValue(config);
    mocks.getTicket.mockReturnValue({
      accountId: 'default',
      senderOpenId: 'ou_ticket',
    });
    mocks.getLarkAccount.mockReturnValue(account);
    mocks.getEnabledLarkAccounts.mockReturnValue([account]);
    mocks.fromAccount.mockReturnValue({ sdk });
    mocks.getRequiredScopes.mockReturnValue(['scope.read']);
    mocks.getAppGrantedScopes.mockResolvedValue(['scope.read', 'offline_access']);
    mocks.getStoredToken.mockResolvedValue({ scope: 'scope.read offline_access' });
    mocks.getAppOwnerFallback.mockResolvedValue('ou_owner');
    mocks.assertOwnerAccessStrict.mockResolvedValue(undefined);
    mocks.callWithUAT.mockImplementation(
      async (_auth: unknown, runner: (accessToken: string) => Promise<unknown>) => await runner('uat-token'),
    );
  });

  it('prefers trusted requester sender over ticket sender for child-run auth', async () => {
    const client = withRequesterSenderId('ou_trusted_child', () => createToolClient(config));
    const seenUsers: string[] = [];

    await client.invoke(
      'feishu_doc.read' as never,
      async (_sdk, _opts, uat) => {
        seenUsers.push(String(uat));
        return 'ok';
      },
      { as: 'user' },
    );

    expect(client.senderOpenId).toBe('ou_trusted_child');
    expect(mocks.callWithUAT).toHaveBeenCalledWith(
      expect.objectContaining({ userOpenId: 'ou_trusted_child' }),
      expect.any(Function),
    );
    expect(seenUsers).toEqual(['uat-token']);
  });

  it('falls back to ticket sender when no trusted requester sender is provided', () => {
    const client = createToolClient(config);
    expect(client.senderOpenId).toBe('ou_ticket');
  });

  it('prefers explicit userOpenId over trusted sender and owner fallback', async () => {
    const client = new ToolClient({
      account,
      senderOpenId: 'ou_trusted_child',
      sdk,
      config,
    });

    await client.invoke('feishu_doc.read' as never, async () => 'ok', { as: 'user', userOpenId: 'ou_explicit' });

    expect(mocks.callWithUAT).toHaveBeenCalledWith(
      expect.objectContaining({ userOpenId: 'ou_explicit' }),
      expect.any(Function),
    );
    expect(mocks.getAppOwnerFallback).not.toHaveBeenCalled();
  });
});
