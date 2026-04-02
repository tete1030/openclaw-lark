import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEditMessageFeishu = vi.fn();
const mockGetEnabledLarkAccounts = vi.fn();

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../src/core/accounts', () => ({
  getEnabledLarkAccounts: (...args: unknown[]) => mockGetEnabledLarkAccounts(...args),
}));

vi.mock('../src/messaging/outbound/send', () => ({
  editMessageFeishu: (...args: unknown[]) => mockEditMessageFeishu(...args),
}));

vi.mock('../src/messaging/outbound/deliver', () => ({
  sendCardLark: vi.fn(),
  sendTextLark: vi.fn(),
}));

vi.mock('../src/messaging/outbound/media', () => ({
  uploadAndSendMediaLark: vi.fn(),
}));

vi.mock('../src/messaging/outbound/reactions', () => ({
  addReactionFeishu: vi.fn(),
  listReactionsFeishu: vi.fn(),
  removeReactionFeishu: vi.fn(),
}));

vi.mock('../src/core/lark-client', () => ({
  LarkClient: {},
}));

import { feishuMessageActions } from '../src/messaging/outbound/actions';

describe('feishu message actions edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnabledLarkAccounts.mockReturnValue([{ accountId: 'default' }]);
    mockEditMessageFeishu.mockResolvedValue(undefined);
  });

  it('advertises edit in supported actions when accounts are enabled', () => {
    const described = feishuMessageActions.describeMessageTool?.({ cfg: {} as never });
    expect(described?.actions).toContain('edit');
    expect(feishuMessageActions.supportsAction?.({ action: 'edit' } as never)).toBe(true);
  });

  it('maps message param to text edit payload and returns structured result', async () => {
    const result = await feishuMessageActions.handleAction?.({
      action: 'edit',
      params: { messageId: 'om_edit_1', message: 'updated body' },
      cfg: {} as never,
      accountId: 'default',
    } as never);

    expect(mockEditMessageFeishu).toHaveBeenCalledWith({
      cfg: {},
      messageId: 'om_edit_1',
      text: 'updated body',
      accountId: 'default',
    });
    expect(result?.details).toMatchObject({
      ok: true,
      channel: 'feishu',
      action: 'edit',
      messageId: 'om_edit_1',
      contentType: 'text',
    });
  });

  it('falls back to text param when message is absent', async () => {
    await feishuMessageActions.handleAction?.({
      action: 'edit',
      params: { messageId: 'om_edit_2', text: 'plain text update' },
      cfg: {} as never,
      accountId: undefined,
    } as never);

    expect(mockEditMessageFeishu).toHaveBeenCalledWith({
      cfg: {},
      messageId: 'om_edit_2',
      text: 'plain text update',
      accountId: undefined,
    });
  });
});
