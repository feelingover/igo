# igo

囲碁（Go）の対局クライアントとサーバのモノレポです。Expo (SDK 56) /
React Native + TypeScript 製。

**Phase 1**: 9路盤・ローカル二人対局（パス＆プレイ）。ルール判定とスコア計算を完備。

## 機能

- 9×9 SVG 盤、二段階タップ（仮置き → 確定）で着手
- ルール判定: 取り（アゲハマ集計）、自殺手の禁止、コウ／同形反復禁止（positional superko）
- パス・両パスによる終局、投了
- 中国ルールの area scoring（コミ 6.5）。結果は「黒 5.5目勝ち」「白 中押し勝ち」
  「持碁（引き分け）」のように日本語で表示します
- 終局時の地の可視化: 盤上の空点に黒地／白地のマーカーを表示し、
  「石 ＋ 地（＋ コミ）＝ 合計」の内訳をパネルに表示

`moves[]` を唯一の真実とし、盤面はそこから導出する設計。ルールエンジン
（`IRuleEngine`）とゲームサービス（`IGameService`）はインターフェース越しに
差し替え可能で、UI は具象実装を知らない。詳細は [SPEC.md](./SPEC.md) と
[CLAUDE.md](./CLAUDE.md) を参照。

## 構成

npm workspaces のモノレポです。

| パッケージ | 役割 |
| --- | --- |
| `packages/core` | `@igo/core`。ドメイン型・ルールエンジン・`IGameService`。RN/DOM 依存ゼロ |
| `apps/client` | `igo-client`。Expo アプリ（UI のみ） |
| `apps/server` | `@igo/server`。Hono 製の REST サーバ。トークン認証のモックを実装済み。対戦成績の永続化は未実装 |

クライアントとサーバを分けずに 1 リポジトリへ置いているのは、Phase 2 が
「ルール判定はサーバー権威」を要求するためです。自殺手判定・同形反復・中国ルールの
面積計算を両側で動かす必要があり、実装を 2 つ持つと「サーバでは合法、端末では非合法」
という食い違いが避けられません。`packages/core` を共有することでこれを構造的に防いでいます。

## セットアップ

```bash
npm install
npm run web      # ブラウザでプレビュー（推奨）
npm start        # Expo dev サーバ（QR / dev client）
npm run ios      # iOS シミュレータ
npm run android  # Android エミュレータ
```

> Expo Go（App Store 版）は SDK 55 までの対応のため、本アプリ（SDK 56）は
> Expo Go では起動できません。`npm run web` か dev client を利用してください。

## 開発

```bash
npm run typecheck     # tsc --noEmit（strict）。3 ワークスペースすべて
npm run test:engine   # ルールエンジンの検証スイート
npm run test:auth     # トークン認証モックの検証スイート
npm run server:smoke  # @igo/core が素の Node で動くことの確認
npm run server:dev    # 認証モックサーバを起動（:8787、ファイル監視あり）
```

`npm run test:engine` はルールエンジン（取り・自殺手・コウ・スコア・
`moves[]` 再構築）を Node 上で実走検証します。エンジンのロジックを変更したら
実行してください。

`npm run server:smoke` は `@igo/core` 経由で一局を進め、取り・手番違反の拒否・
着手禁止点の拒否・両パス終局のスコアまでを Node 上で確認します。サーバ権威の
ルール判定が成立していることの確認用です。

`npm run test:auth` は後述の認証モックを HTTP 層ごと検証します。ローテーションの
猶予期間、再利用検知、`token_version` による即時失効、鍵ローテーションの重複期間
などを実走で確認しますので、`apps/server` に手を入れたら実行してください。

実行は `tsx` 経由のため型検査を伴いません。型の担保は `npm run typecheck` が
担当しますので、こちらも併せて実行してください。

## トークン認証モック

[mobile-game-token-auth-design.md](./mobile-game-token-auth-design.md) に書いた
モバイルゲーム向けの3層トークン認証（アクセストークン / リフレッシュトークン /
デバイス認証情報）を、`apps/server` に REST のモックとして実装しています。

```bash
npm run server:dev   # http://localhost:8787
```

インメモリ実装のため、プロセスを再起動すると署名鍵を含む全状態が消えます。
エンドポイント・リクエスト例・実装範囲は
[apps/server/README.md](./apps/server/README.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
