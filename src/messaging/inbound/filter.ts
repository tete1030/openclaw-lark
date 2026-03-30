/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Keyword filter for inbound Feishu messages.
 *
 * Silently drops messages containing specific keywords before they enter
 * the message processing pipeline.
 *
 * Configuration (channels.feishu.filterKeywords):
 * - Simple: ["#NO_AGENT", "#INTERNAL"] - array of keywords (contains, case-insensitive)
 * - Advanced: { keywords: [...], mode: "contains"|"exact", caseSensitive: false, logFiltered: true }
 *
 * Per-group override: channels.feishu.groups.<chatId>.filterKeywords
 */

import type { FeishuMessageEvent } from '../types';

export type FilterKeywordsConfig =
  | string[]
  | {
      keywords: string[];
      mode?: 'contains' | 'exact';
      caseSensitive?: boolean;
      logFiltered?: boolean;
    }
  | undefined;

export function shouldFilterMessage(
  event: FeishuMessageEvent,
  config: FilterKeywordsConfig,
  logger?: (msg: string) => void,
): boolean {
  if (!config) return false;

  const keywords = Array.isArray(config) ? config : config.keywords;
  if (!keywords || keywords.length === 0) return false;

  const content = extractMessageText(event);
  if (!content) return false;

  const mode = Array.isArray(config) ? 'contains' : (config.mode ?? 'contains');
  const caseSensitive = Array.isArray(config) ? false : (config.caseSensitive ?? false);
  const logFiltered = Array.isArray(config) ? true : (config.logFiltered ?? true);

  const searchText = caseSensitive ? content : content.toLowerCase();

  for (const keyword of keywords) {
    if (!keyword?.trim()) continue;

    const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();
    const matches = mode === 'exact' ? searchText === searchKeyword : searchText.includes(searchKeyword);

    if (matches) {
      if (logFiltered && logger) {
        const messageId = event.message.message_id;
        const senderId = event.sender.sender_id.open_id ?? 'unknown';
        const chatId = event.message.chat_id;
        logger(`feishu: filtered message ${messageId} from ${senderId} in ${chatId} (matched: "${keyword}")`);
      }
      return true;
    }
  }

  return false;
}

function extractMessageText(event: FeishuMessageEvent): string {
  const { message_type, content } = event.message;
  if (!content) return '';

  if (message_type === 'text') {
    try {
      return JSON.parse(content).text ?? '';
    } catch {
      return content;
    }
  }

  if (message_type === 'post') {
    try {
      const parsed = JSON.parse(content);
      return (parsed.title ?? '') + ' ' + JSON.stringify(parsed.content ?? '');
    } catch {
      return content;
    }
  }

  return content;
}
