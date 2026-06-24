// 危険スキーム URL のテスト用フィクスチャ。
// no-script-url が発火する文字列リテラルをここに集約し、
// テストコードから import して使う（tests/js は eslint ignores 対象外だが
// fixtures/ は ignores 対象のため no-script-url を回避できる）。
export const JAVASCRIPT_ALERT = "javascript:alert(1)";
