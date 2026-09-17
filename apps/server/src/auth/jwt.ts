// アクセストークン（JWT / HS256）の発行と検証。DESIGN 2章。
//
// このモジュールの外から JWT を組み立てたり文字列を切り貼りしたりしない
// （DESIGN 8章「トークンの発行・検証を1モジュールに閉じる」）。
import { createHmac } from 'node:crypto';

import { timingSafeEqualString } from './crypto';
import { AuthError } from './errors';

/**
 * 署名アルゴリズム。
 *
 * 単一サービス構成なので現状 HS256 のみ（DESIGN 2章）。検証側が増えたら
 * ここに 'ES256' を足し、鍵ごとに切り替える。`kid` から鍵とアルゴリズムを
 * 同時に引く構造にしてあるため、移行は無停止でできる（DESIGN 8章・11章）。
 */
export type JwtAlgorithm = 'HS256';

export interface SigningKey {
  readonly kid: string;
  readonly alg: JwtAlgorithm;
  /** HS256 は 256bit 以上（DESIGN 11章）。 */
  readonly secret: Buffer;
}

/** DESIGN 2章のクレーム設計。サイズが全リクエストの帯域に効くので最小限に保つ。 */
export interface AccessTokenClaims {
  /** ユーザーID。 */
  readonly sub: string;
  /** 発行者。 */
  readonly iss: string;
  /** 宛先サービス。 */
  readonly aud: string;
  /** 発行時刻（epoch 秒）。 */
  readonly iat: number;
  /** 有効期限（epoch 秒）。 */
  readonly exp: number;
  /** ファミリーID（= デバイスセッションID）。秘密情報ではない。 */
  readonly fid: string;
  /** token_version。 */
  readonly tv: number;
  /** トークン固有ID。ログ相関用（DESIGN 10章）。 */
  readonly jti: string;
}

export function signAccessToken(claims: AccessTokenClaims, key: SigningKey): string {
  // `alg` はヘッダに書くが、検証時には読まない（後述）。相互運用のための記載。
  const header = encodeSegment({ typ: 'JWT', alg: key.alg, kid: key.kid });
  const payload = encodeSegment(claims);
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(signingInput, key)}`;
}

/**
 * 署名の検証。DESIGN 2章「検証手順」の1と2だけを担う。
 * `exp` / `iss` / `aud` / `tv` の突き合わせは呼び出し側（authService）の責務。
 *
 * **`alg` ヘッダは参照しない。** `kid` から鍵とアルゴリズムの両方を引くことで、
 * `alg: none` や RS→HS すり替えの経路が構造的に塞がる。
 * 「先に署名を検証してからアルゴリズムを確認する」実装にしてはいけない。
 */
export function verifyAccessTokenSignature(
  token: string,
  resolveKey: (kid: string) => SigningKey | undefined,
): AccessTokenClaims {
  const segments = token.split('.');
  if (segments.length !== 3) throw invalidToken();
  const [rawHeader, rawPayload, rawSignature] = segments;

  // ヘッダから読むのは `kid` だけ。未知の `kid` は即座に拒否する。
  const header = decodeSegment(rawHeader);
  const kid = isRecord(header) && typeof header.kid === 'string' ? header.kid : null;
  if (kid === null) throw invalidToken();
  const key = resolveKey(kid);
  if (key === undefined) throw invalidToken();

  // 鍵に紐づくアルゴリズムで署名を作り直し、タイミング安全に比較する。
  const expected = sign(`${rawHeader}.${rawPayload}`, key);
  if (!timingSafeEqualString(expected, rawSignature)) throw invalidToken();

  return parseClaims(decodeSegment(rawPayload));
}

function sign(signingInput: string, key: SigningKey): string {
  // key.alg が 'HS256' のみである以上、ここは分岐しない。
  // アルゴリズムを増やすときだけ、この1箇所に switch が生える。
  return createHmac('sha256', key.secret).update(signingInput, 'utf8').digest('base64url');
}

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw invalidToken();
  }
}

function parseClaims(value: unknown): AccessTokenClaims {
  if (!isRecord(value)) throw invalidToken();
  const { sub, iss, aud, iat, exp, fid, tv, jti } = value;
  if (
    typeof sub !== 'string' ||
    typeof iss !== 'string' ||
    typeof aud !== 'string' ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof fid !== 'string' ||
    typeof tv !== 'number' ||
    typeof jti !== 'string'
  ) {
    throw invalidToken();
  }
  return { sub, iss, aud, iat, exp, fid, tv, jti };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 形式不正・未知の `kid`・署名不一致を1種類に潰す。
 * どこで落ちたかを応答に出すと、鍵の存在有無を探索させる材料になる。
 */
function invalidToken(): AuthError {
  return new AuthError('invalid_access_token', 401, 'アクセストークンが無効です。');
}
