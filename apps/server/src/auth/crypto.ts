// ランダム値生成とハッシュ。DESIGN 3章。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * ID・シークレット用のランダム値。
 *
 * base64url なので `.` を含まない。リフレッシュトークンの区切り文字が `.` である以上
 * （DESIGN 3章）、ここは形式の前提条件になっている。
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** ID 用の短めのランダム値。秘密ではないが推測しづらくはしておく。 */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * リフレッシュトークン／デバイスシークレットの保存用ハッシュ。
 *
 * 十分なエントロピーを持つランダム値が入力なので SHA-256 で足りる。
 * パスワードではないため bcrypt 等は不要（DESIGN 3章）。
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/**
 * ハッシュ同士のタイミング安全な比較（DESIGN 3章）。
 *
 * 入力は常に固定長の SHA-256 なので、長さ不一致での早期 return から漏れる情報はない。
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
