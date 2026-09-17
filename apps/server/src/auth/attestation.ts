// 端末アテステーションの検証。DESIGN 5章。
//
// **ここはモックである。** 本番では iOS App Attest / Android Play Integrity の
// 署名付きアサーションを OS ベンダーの公開鍵で検証する。返り値の形だけ合わせてあるので、
// 差し替えは verify() の中身の置き換えで済む。
//
// デバイス登録は「何の前提もなくアカウントを1つ作れる入口」であり、
// 端末IDによる検知は偽装可能なので、ここが初回登録の不正対策の要になる。

export type AttestationPlatform = 'ios' | 'android';

export interface AttestationInput {
  readonly platform: AttestationPlatform;
  /** App Attest / Play Integrity のトークン。 */
  readonly token: string;
}

export interface AttestationResult {
  readonly verified: boolean;
  /** 失敗理由。監査ログ用（DESIGN 11章）。 */
  readonly reason?: string;
}

/**
 * モックの判定規則。
 * `invalid-` で始まるトークンを失敗とし、それ以外は成功扱いにする。
 * 正規の環境でも失敗しうる（オフライン・旧OS・一部端末）ため、
 * 失敗時にどう扱うかは config.attestation.policy 側で決める。
 */
export function verifyAttestation(input: AttestationInput): AttestationResult {
  if (input.token.trim() === '') {
    return { verified: false, reason: 'アテステーショントークンが空です。' };
  }
  if (input.token.startsWith('invalid-')) {
    return { verified: false, reason: `アテステーションの検証に失敗しました（${input.platform}）。` };
  }
  return { verified: true };
}

export function isAttestationPlatform(value: unknown): value is AttestationPlatform {
  return value === 'ios' || value === 'android';
}
