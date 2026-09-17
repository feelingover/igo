// 揮発キャッシュ相当。Redis 系の代わり。
//
// ここに置いてよいのは「消えても正しさが失われないもの」だけ（DESIGN 9章）。
//   - グレースピリオド用の応答（DESIGN 4章）
//   - token_version（DESIGN 7章。ミス時は永続DBへフォールバック）
//   - レート制限カウンタ（DESIGN 10章）
// バトル進行状態のような永続データは、たとえ `family_id` キーでも入れない。

/** キャッシュ全断の再現用。DESIGN 7章の方針をコード上で検証できるようにする。 */
export class CacheUnavailableError extends Error {
  constructor() {
    super('揮発キャッシュを参照できません。');
    this.name = 'CacheUnavailableError';
  }
}

interface Entry {
  readonly value: unknown;
  readonly expiresAt: number;
}

export class VolatileCache {
  private readonly entries = new Map<string, Entry>();
  private unavailableSince: number | null = null;

  /**
   * DESIGN 9章。TTL は必須。無期限で書けるとゴミが溜まり、誰も消せなくなる。
   * 実運用ではここに TTL の最大値（例: 1時間）も強制する。
   */
  set(key: string, value: unknown, ttlSec: number, now: number): void {
    this.assertAvailable();
    this.entries.set(key, { value, expiresAt: now + ttlSec * 1000 });
  }

  get<T>(key: string, now: number): T | undefined {
    this.assertAvailable();
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.assertAvailable();
    this.entries.delete(key);
  }

  /**
   * アトミックなインクリメント。DESIGN 9章のとおり、セッション機構のような
   * read-modify-write にはしない（並行リクエストで更新が黙って消える）。
   * 戻り値はウィンドウ内の現在値。
   */
  increment(key: string, ttlSec: number, now: number): number {
    this.assertAvailable();
    const current = this.get<number>(key, now) ?? 0;
    const next = current + 1;
    // 既存エントリの期限は延長しない（固定ウィンドウを保つ）。
    const entry = this.entries.get(key);
    this.entries.set(key, { value: next, expiresAt: entry?.expiresAt ?? now + ttlSec * 1000 });
    return next;
  }

  /** グレースピリオド用キャッシュが飛んだ状況の再現（DESIGN 4章・12章）。 */
  flush(): void {
    this.entries.clear();
  }

  /** キャッシュ全断の開始・復旧。 */
  setAvailable(available: boolean, now: number): void {
    this.unavailableSince = available ? null : (this.unavailableSince ?? now);
  }

  get available(): boolean {
    return this.unavailableSince === null;
  }

  /** 断が始まってからの経過時間（ミリ秒）。フェイルオープンの上限判定に使う。 */
  outageDurationMs(now: number): number {
    return this.unavailableSince === null ? 0 : now - this.unavailableSince;
  }

  private assertAvailable(): void {
    if (this.unavailableSince !== null) throw new CacheUnavailableError();
  }
}
