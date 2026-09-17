// リフレッシュトークンの形式。DESIGN 3章。
//
//   rt_{family_id}.{generation}.{random_secret}
//        ↑              ↑              ↑
//     検索キー       世代判定     ハッシュ化して比較
//
// この構造の目的は「照合すべきハッシュを O(1) で特定すること」であって、
// 世代番号そのものに認証上の意味はない（DESIGN 4章）。
import { rejectRefresh } from './errors';

/** ログや問い合わせで JWT と取り違えないための接頭辞（DESIGN 3章）。 */
const PREFIX = 'rt_';
const SEPARATOR = '.';

export interface ParsedRefreshToken {
  readonly familyId: string;
  readonly generation: number;
  readonly secret: string;
}

export function formatRefreshToken(familyId: string, generation: number, secret: string): string {
  return `${PREFIX}${familyId}${SEPARATOR}${generation}${SEPARATOR}${secret}`;
}

/**
 * 形式の検査のみ。ここを通っても「正規のトークンである」ことは一切保証しない。
 * 生成のたびに `family_id` / `secret` は base64url（`.` を含まない）なので、
 * 単純な split で曖昧さなく分解できる。
 */
export function parseRefreshToken(raw: string): ParsedRefreshToken | null {
  if (!raw.startsWith(PREFIX)) return null;
  const parts = raw.slice(PREFIX.length).split(SEPARATOR);
  if (parts.length !== 3) return null;

  const [familyId, rawGeneration, secret] = parts;
  if (familyId === '' || secret === '') return null;
  // 10進数の非負整数のみ。'01' や '1e3' を通すと世代の同一性判定がぶれる。
  if (!/^(?:0|[1-9]\d*)$/.test(rawGeneration)) return null;

  const generation = Number(rawGeneration);
  if (!Number.isSafeInteger(generation)) return null;

  return { familyId, generation, secret };
}

/** 形式不正も「拒否のみ」。DESIGN 4章より、ファミリーには一切触れない。 */
export function requireParsedRefreshToken(raw: string): ParsedRefreshToken {
  const parsed = parseRefreshToken(raw);
  if (parsed === null) throw rejectRefresh();
  return parsed;
}
