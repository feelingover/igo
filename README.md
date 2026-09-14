# igo-client

囲碁（Go）の対局クライアント。Expo (SDK 56) / React Native + TypeScript 製。

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
npm run typecheck    # tsc --noEmit（strict）
npm run test:engine  # ルールエンジンの検証スイート
```

`npm run test:engine` はルールエンジン（取り・自殺手・コウ・スコア・
`moves[]` 再構築）を Node 上で実走検証します。エンジンのロジックを変更したら
実行してください。

## ライセンス

[MIT](./LICENSE)
