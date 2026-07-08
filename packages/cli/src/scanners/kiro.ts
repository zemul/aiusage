import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { IngestBreakdown } from '@aiusage/shared';
import {
  parseTs,
  dateKey,
  resolveProjectFields,
  walkFiles,
  initDateMap,
  accumulate,
  finalize,
  emptyResult,
} from './utils.js';

/**
 * Kiro CLI scanner.
 *
 * 数据目录: ~/.kiro/sessions/cli/*.json
 * 每个 JSON 文件包含 session_state.conversation_metadata.user_turn_metadatas[]
 * 每个 turn 有:
 *   - end_timestamp: ISO 时间戳
 *   - input_token_count / output_token_count (目前通常为 0)
 *   - metering_usage: [{value: number, unit: "credit"}]
 *   - total_request_count: 请求次数
 */

interface KiroMeteringEntry {
  value?: number;
  unit?: string;
}

interface KiroTurnMetadata {
  end_timestamp?: string;
  input_token_count?: number;
  output_token_count?: number;
  metering_usage?: KiroMeteringEntry[];
  total_request_count?: number;
}

interface KiroSession {
  session_id?: string;
  cwd?: string;
  created_at?: string;
  session_state?: {
    conversation_metadata?: {
      user_turn_metadatas?: KiroTurnMetadata[];
    };
  };
}

export async function scanKiroDates(
  targetDates: string[],
  baseDir?: string,
  projectAliases?: Record<string, string>,
): Promise<Map<string, IngestBreakdown[]>> {
  const dates = new Set(targetDates);
  const dir = baseDir ?? `${homedir()}/.kiro/sessions/cli`;

  const files = await walkFiles(dir, '.json');
  if (files.length === 0) return emptyResult(dates);

  const grouped = initDateMap(dates);

  for (const filePath of files) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let session: KiroSession;
    try {
      session = JSON.parse(raw);
    } catch {
      continue;
    }

    const turns = session.session_state?.conversation_metadata?.user_turn_metadatas;
    if (!turns || turns.length === 0) continue;

    const rootPath = session.cwd;
    const fields = rootPath
      ? resolveProjectFields(rootPath, projectAliases)
      : { project: 'unknown', projectDisplay: 'unknown' };

    for (const turn of turns) {
      const ts = parseTs(turn.end_timestamp);
      if (!ts) continue;

      const dk = dateKey(ts);
      const dayMap = grouped.get(dk);
      if (!dayMap) continue;

      const input = turn.input_token_count ?? 0;
      const output = turn.output_token_count ?? 0;

      // Kiro 目前 token 数为 0，但有 metering_usage (credits)
      // 如果 token 为 0 但有 metering_usage 且有请求数，仍记为一次事件
      const hasCredits = turn.metering_usage?.some(m => (m.value ?? 0) > 0) ?? false;
      if (input === 0 && output === 0 && !hasCredits) continue;

      const model = 'unknown'; // Kiro 不暴露模型名

      accumulate(
        dayMap,
        `${model}|${fields.project}`,
        {
          provider: 'aws',
          product: 'kiro',
          channel: 'cli',
          model,
          project: fields.project,
          projectDisplay: fields.projectDisplay,
          projectAlias: fields.projectAlias,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        { input, cached: 0, cacheWrite: 0, output, reasoning: 0 },
      );
    }
  }

  return finalize(grouped);
}
