// 監査ログ。DESIGN 11章。
//
// 再利用検知は「起きてはいけないことが起きた」シグナルなので必ず記録する。
//
// **トークンそのものは記録しない。** これを規約ではなく型で縛るために、
// AuditRecord にトークンを入れられるフィールドを用意していない。
// 相関用には `family_id` と `jti` の先頭だけを使う（どちらも秘密ではない / DESIGN 10章）。

export type AuditEvent =
  /** デバイス登録に成功した。 */
  | 'device_registered'
  /** アテステーション失敗。改造クライアント・エミュレータの兆候。 */
  | 'attestation_failed'
  /** 通常のローテーション。 */
  | 'refresh_rotated'
  /** 猶予期間内の旧トークン。キャッシュ済み応答を返した（冪等）。 */
  | 'refresh_replayed_in_grace'
  /** 猶予期間内だがキャッシュが無かった。失効させず再ローテーションした。 */
  | 'refresh_grace_cache_miss'
  /** ハッシュ不一致・未知のファミリー・世代外れ。総当たりや強制ログアウト狙いのDoS試行。 */
  | 'refresh_rejected'
  /** 再利用検知によるファミリー失効。盗難・漏洩の兆候。 */
  | 'family_revoked_reuse_detected'
  /** 手動・BAN・ログアウトによるファミリー失効。 */
  | 'family_revoked'
  /** デバイス認証情報の失効。 */
  | 'device_revoked'
  /** サイレント再ログイン。想定より多いならセキュアストレージへの保存失敗を疑う。 */
  | 'silent_relogin'
  /** token_version のインクリメント（BAN / 全端末ログアウト）。 */
  | 'token_version_bumped'
  /** レート制限にかかった。 */
  | 'rate_limited'
  /** ロック競合で 503 を返した。攻撃ではなく競合。 */
  | 'lock_contended'
  /** token_version のキャッシュが参照できなかった。 */
  | 'token_version_cache_outage';

export interface AuditContext {
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface AuditRecord extends AuditContext {
  readonly at: number;
  readonly event: AuditEvent;
  readonly userId?: string;
  readonly familyId?: string;
  readonly deviceId?: string;
  /** 補足。ここにもトークンは入れない。 */
  readonly detail?: string;
}

const MAX_RECORDS = 500;

export class AuditLog {
  private readonly records: AuditRecord[] = [];

  constructor(private readonly sink: (record: AuditRecord) => void = defaultSink) {}

  record(record: AuditRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    this.sink(record);
  }

  /** 新しい順。モック運用エンドポイントからの確認用。 */
  recent(limit = 50): AuditRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** テスト用。指定イベントの件数。 */
  countOf(event: AuditEvent): number {
    return this.records.filter((record) => record.event === event).length;
  }
}

function defaultSink(record: AuditRecord): void {
  const at = new Date(record.at).toISOString();
  const parts = [
    `user=${record.userId ?? '-'}`,
    `family=${record.familyId ?? '-'}`,
    `device=${record.deviceId ?? '-'}`,
    `ip=${record.ip ?? '-'}`,
  ];
  console.log(`[audit] ${at} ${record.event} ${parts.join(' ')}${record.detail ? ` :: ${record.detail}` : ''}`);
}

/** ログに出してよい相関ID。DESIGN 10章。 */
export const jtiPrefix = (jti: string): string => jti.slice(0, 8);
