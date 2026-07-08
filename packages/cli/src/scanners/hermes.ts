import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
  walkFiles,
  normalizeModelName,
} from './utils.js';

/**
 * Hermes Agent scanner.
 *
 * 数据目录: ~/.hermes/sessions/session_*.json
 * 每个 JSON 文件包含:
 *   - session_id, model, platform, base_url
 *   - session_start, last_updated (ISO 时间戳)
 *   - messages[] (无 token 统计，只有角色和内容)
 *   - message_count
 *
 * Hermes 不暴露 token 数，我们按 assistant 消息数统计事件。
 */

interface HermesMessage {
  role?: string;
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
}

interface HermesSession {
  session_id?: string;
  model?: string;
  platform?: string;
  base_url?: string;
  session_start?: string;
  last_updated?: string;
  message_count?: number;
  messages?: HermesMessage[];
}

export async function scanHermesDates(
  targetDates: string[],
  baseDir?: string,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? `${homedir()}/.hermes/sessions`;

  const files = await walkFiles(dir, '.json');
  // 只处理 session_*.json，排除 request_dump 等其他文件
  const sessionFiles = files.filter(f => {
    const name = f.split('/').pop() ?? '';
    return name.startsWith('session_');
  });

  if (sessionFiles.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of sessionFiles) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let session: HermesSession;
    try {
      session = JSON.parse(raw);
    } catch {
      continue;
    }

    // 用 session_start 或 last_updated 确定日期
    const ts = parseTs(session.session_start) ?? parseTs(session.last_updated);
    if (!ts) continue;

    const dk = dateKey(ts);
    const dayMap = grouped.get(dk);
    if (!dayMap) continue;

    const messages = session.messages ?? [];
    // 统计 assistant 回复数作为事件数
    const assistantCount = messages.filter(m => m.role === 'assistant').length;
    if (assistantCount === 0) continue;

    const model = normalizeModelName(session.model ?? 'unknown');

    accumulate(
      dayMap,
      `${model}|unknown`,
      {
        provider: inferProvider(session.base_url, session.model),
        product: 'hermes',
        channel: session.platform === 'telegram' ? 'web' : 'cli',
        model,
        project: 'unknown',
        projectDisplay: 'unknown',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    );
  }

  return finalize(grouped);
}

/** 从 base_url 或 model 名推断 provider */
function inferProvider(baseUrl?: string, model?: string): string {
  if (baseUrl) {
    if (baseUrl.includes('openai.com')) return 'openai';
    if (baseUrl.includes('anthropic')) return 'anthropic';
    if (baseUrl.includes('google')) return 'google';
    if (baseUrl.includes('xiaomimimo') || baseUrl.includes('xiaomi')) return 'xiaomi';
    if (baseUrl.includes('openrouter')) return 'openrouter';
    if (baseUrl.includes('deepseek')) return 'deepseek';
  }
  if (model) {
    if (model.includes('gpt') || model.includes('o1') || model.includes('o3') || model.includes('o4')) return 'openai';
    if (model.includes('claude')) return 'anthropic';
    if (model.includes('gemini')) return 'google';
    if (model.includes('mimo')) return 'xiaomi';
    if (model.includes('deepseek')) return 'deepseek';
  }
  return 'unknown';
}
