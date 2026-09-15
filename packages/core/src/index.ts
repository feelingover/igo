// @igo/core の公開面。クライアント（Expo）とサーバ（Node）の両方がここだけを見る。
//
// package.json に exports フィールドを「書かない」こと。書くと Node/Metro の
// exports セマンティクスが効いて拡張子推論が無効になり、内部の拡張子なし import
// （'../types' → types/index.ts）が解決できなくなる。main/types だけで十分。
export * from './types';
export * from './engine/types';
export * from './engine/ruleEngine';
export * from './services/gameService';
export * from './services/localGameService';

// selfRuleEngine は意図的に公開しない。
// 具象エンジンを名指しする場所は createRuleEngine() 只一つ、という不変条件を保つため
// （エンジン差し替えが ruleEngine.ts の編集だけで済む / SPEC 6章）。
