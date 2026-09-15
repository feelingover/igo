## 概要

<!-- 何を・なぜ変えたのかを 1〜3 行で書きます。 -->

## 変更内容

<!--
アーキテクチャの層ごとに書くと差分が追いやすくなります。
関連する SPEC.md の章があれば「（SPEC 6章）」のように添えてください。

- エンジン層（`packages/core/src/engine/`）:
- サービス層（`packages/core/src/services/`）:
- 状態 / UI 層（`apps/client/src/{state,components,screens}/`）:
- サーバ（`apps/server/`）:
-->

## 動作確認

- [ ] `npm run typecheck` がクリーン（3 ワークスペースすべて）
- [ ] `npm run test:engine` が全件パス（エンジンのロジックを変えた場合は検証を追加）
- [ ] `npm run server:smoke` がパス（`packages/core` を変えた場合）
- [ ] `npm run web` で実機の挙動を確認（UI を変えた場合はスクリーンショットを添付）

## 影響範囲・補足

<!--
- 既存の対局の互換性（`moves[]` から盤面を再構築できるか）
- インターフェース（`IRuleEngine` / `IGameService`）を変えた場合はその理由
- SPEC.md との差分があれば、コード側の NOTE コメントとあわせて記載
-->

## 関連 Issue

<!-- 例: Closes #123 -->
