import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
import type { LarkTicket } from '../src/core/lark-ticket';
import { AppScopeMissingError } from '../src/core/auth-errors';
import { handleCardAction, handleInvokeErrorWithAutoAuth } from '../src/tools/auto-auth';

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockGetTicket = vi.fn();
vi.mock('../src/core/lark-ticket', () => ({
  getTicket: (...args: unknown[]) => mockGetTicket(...args),
}));

const mockGetLarkAccount = vi.fn();
vi.mock('../src/core/accounts', () => ({
  getLarkAccount: (...args: unknown[]) => mockGetLarkAccount(...args),
}));

const mockGetAppGrantedScopes = vi.fn();
const mockInvalidateAppScopeCache = vi.fn();
vi.mock('../src/core/app-scope-checker', () => ({
  getAppGrantedScopes: (...args: unknown[]) => mockGetAppGrantedScopes(...args),
  invalidateAppScopeCache: (...args: unknown[]) => mockInvalidateAppScopeCache(...args),
  isAppScopeSatisfied: (grantedScopes: string[], requiredScopes: string[], scopeNeedType?: 'one' | 'all') => {
    if (grantedScopes.length === 0 || requiredScopes.length === 0) return true;
    if (scopeNeedType === 'all') return requiredScopes.every((scope) => grantedScopes.includes(scope));
    return requiredScopes.some((scope) => grantedScopes.includes(scope));
  },
}));

const mockCreateCardEntity = vi.fn();
const mockSendCardByCardId = vi.fn();
const mockUpdateCardKitCardForAuth = vi.fn();
vi.mock('../src/card/cardkit', () => ({
  createCardEntity: (...args: unknown[]) => mockCreateCardEntity(...args),
  sendCardByCardId: (...args: unknown[]) => mockSendCardByCardId(...args),
  updateCardKitCardForAuth: (...args: unknown[]) => mockUpdateCardKitCardForAuth(...args),
}));

const mockDispatchSyntheticTextMessage = vi.fn();
vi.mock('../src/messaging/inbound/synthetic-message', () => ({
  dispatchSyntheticTextMessage: (...args: unknown[]) => mockDispatchSyntheticTextMessage(...args),
}));

const mockExecuteAuthorize = vi.fn();
vi.mock('../src/tools/oauth', () => ({
  executeAuthorize: (...args: unknown[]) => mockExecuteAuthorize(...args),
}));

const mockFromAccount = vi.fn();
vi.mock('../src/core/lark-client', () => ({
  LarkClient: {
    fromAccount: (...args: unknown[]) => mockFromAccount(...args),
  },
}));

vi.mock('../src/tools/helpers', () => ({
  formatToolResult: (obj: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }),
  getResolvedConfig: (cfg: ClawdbotConfig) => cfg,
}));

vi.mock('../src/core/api-error', () => ({
  formatLarkError: () => 'formatted_lark_error',
}));

function createMockCfg(): ClawdbotConfig {
  return {
    channels: {
      feishu: {
        enabled: true,
        appId: 'cli_app',
        appSecret: 'secret',
      },
    },
  } as ClawdbotConfig;
}

function createTicket(overrides: Partial<LarkTicket> = {}): LarkTicket {
  return {
    accountId: 'acct_1',
    chatId: 'oc_chat_1',
    messageId: 'om_message_1',
    startTime: Date.now(),
    senderOpenId: 'ou_owner',
    chatType: 'group',
    threadId: 'omt_thread_1',
    ...overrides,
  };
}

function createCardActionEvent(operationId: string, operatorOpenId: string) {
  return {
    operator: { open_id: operatorOpenId },
    action: {
      value: {
        action: 'app_auth_done',
        operation_id: operationId,
      },
    },
  };
}

function getOperationIdFromCardSend(index: number): string {
  const call = mockCreateCardEntity.mock.calls[index];
  if (!call) {
    throw new Error(`card send ${index} not found`);
  }
  const card = call[0].card as {
    body: { elements: Array<{ value?: { operation_id?: string } }> };
  };
  const operationId = card.body.elements[5]?.value?.operation_id;
  if (!operationId) {
    throw new Error(`operation_id not found in seeded app-auth card ${index}`);
  }
  return operationId;
}

async function seedPendingAppAuth(ticket: LarkTicket) {
  mockGetTicket.mockReturnValue(ticket);

  const resultPromise = handleInvokeErrorWithAutoAuth(
    new AppScopeMissingError(
      {
        apiName: 'docs.v1.doc.get',
        scopes: ['scope.app'],
        appId: 'cli_app',
      },
      'all',
      'user',
      ['scope.app', 'scope.user'],
    ),
    createMockCfg(),
  );

  await waitFor(80);
  await resultPromise;

  return getOperationIdFromCardSend(mockCreateCardEntity.mock.calls.length - 1);
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('auto-auth app resume binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetLarkAccount.mockReturnValue({
      accountId: 'acct_1',
      enabled: true,
      configured: true,
      appId: 'cli_app',
      appSecret: 'secret',
      brand: 'feishu',
      config: {},
    });
    mockCreateCardEntity.mockResolvedValue('card_1');
    mockSendCardByCardId.mockResolvedValue(undefined);
    mockUpdateCardKitCardForAuth.mockResolvedValue(undefined);
    mockFromAccount.mockReturnValue({ sdk: {} });
    mockGetAppGrantedScopes.mockResolvedValue(['scope.app']);
    mockExecuteAuthorize.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    mockDispatchSyntheticTextMessage.mockResolvedValue(undefined);
  });

  it('denies a mismatched operator and still allows the original requester to resume', async () => {
    const ticket = createTicket();
    const operationId = await seedPendingAppAuth(ticket);

    const denied = await handleCardAction(
      createCardActionEvent(operationId, 'ou_other'),
      createMockCfg(),
      ticket.accountId,
    );

    expect(denied).toEqual({
      toast: {
        type: 'error',
        content: '该授权卡片仅限原发起人继续操作',
      },
    });
    expect(mockInvalidateAppScopeCache).not.toHaveBeenCalled();
    expect(mockExecuteAuthorize).not.toHaveBeenCalled();

    const resumed = await handleCardAction(
      createCardActionEvent(operationId, ticket.senderOpenId!),
      createMockCfg(),
      ticket.accountId,
    );

    expect(resumed).toMatchObject({
      toast: {
        type: 'success',
        content: '权限确认成功',
      },
      card: {
        type: 'raw',
      },
    });

    await waitFor(0);

    expect(mockInvalidateAppScopeCache).toHaveBeenCalledWith('cli_app');
    expect(mockExecuteAuthorize).toHaveBeenCalledTimes(1);
  });

  it('allows the original requester to continue into the resume authorize path', async () => {
    const ticket = createTicket({ messageId: 'om_message_2' });
    const operationId = await seedPendingAppAuth(ticket);

    const result = await handleCardAction(
      createCardActionEvent(operationId, ticket.senderOpenId!),
      createMockCfg(),
      ticket.accountId,
    );

    expect(result).toMatchObject({
      toast: {
        type: 'success',
        content: '权限确认成功',
      },
      card: {
        type: 'raw',
      },
    });

    await waitFor(0);

    expect(mockGetAppGrantedScopes).toHaveBeenCalledWith({}, 'cli_app', 'user');
    expect(mockUpdateCardKitCardForAuth).toHaveBeenCalled();
    expect(mockDispatchSyntheticTextMessage).not.toHaveBeenCalled();
    expect(mockExecuteAuthorize).toHaveBeenCalledTimes(1);

    const authorizeArgs = mockExecuteAuthorize.mock.calls[0][0] as {
      senderOpenId: string;
      scope: string;
      forceAuth: boolean;
      showBatchAuthHint: boolean;
      ticket: LarkTicket;
    };
    expect(authorizeArgs.senderOpenId).toBe(ticket.senderOpenId);
    expect(authorizeArgs.forceAuth).toBe(true);
    expect(authorizeArgs.showBatchAuthHint).toBe(true);
    expect(authorizeArgs.ticket).toEqual(ticket);
    expect(new Set(authorizeArgs.scope.split(' '))).toEqual(new Set(['scope.app', 'scope.user']));
  });

  it('keeps overlapping app-auth flows isolated across sender and thread boundaries', async () => {
    const ticketA = createTicket({
      messageId: 'om_shared_message',
      senderOpenId: 'ou_owner_a',
      threadId: 'omt_thread_a',
    });
    const ticketB = createTicket({
      messageId: 'om_shared_message',
      senderOpenId: 'ou_owner_b',
      threadId: 'omt_thread_b',
    });

    const operationIdA = await seedPendingAppAuth(ticketA);
    const operationIdB = await seedPendingAppAuth(ticketB);

    expect(operationIdA).not.toBe(operationIdB);
    expect(mockCreateCardEntity).toHaveBeenCalledTimes(2);

    await handleCardAction(
      createCardActionEvent(operationIdA, ticketA.senderOpenId!),
      createMockCfg(),
      ticketA.accountId,
    );
    await handleCardAction(
      createCardActionEvent(operationIdB, ticketB.senderOpenId!),
      createMockCfg(),
      ticketB.accountId,
    );

    await waitFor(0);

    const resumedSenders = mockExecuteAuthorize.mock.calls.map(
      (call) =>
        (
          call[0] as {
            senderOpenId: string;
            ticket: LarkTicket;
          }
        ).senderOpenId,
    );
    expect(resumedSenders).toEqual(['ou_owner_a', 'ou_owner_b']);

    const resumedTickets = mockExecuteAuthorize.mock.calls.map(
      (call) =>
        (
          call[0] as {
            senderOpenId: string;
            ticket: LarkTicket;
          }
        ).ticket,
    );
    expect(resumedTickets).toEqual([ticketA, ticketB]);
  });
});
