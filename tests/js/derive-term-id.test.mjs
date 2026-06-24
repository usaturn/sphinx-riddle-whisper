// #17 term-id 導出（deriveTermId）の単体テスト。
// riddle.js から export された純関数 deriveTermId を import し、
// トリガ要素の href（例 "../index.html#term-0" / "#term-0"）から
// `#term-*` フラグメントを取り出して term-id（"term-0"）を返すことを検証する。
//
// 本ファイルは項目 t8（異常系）を担当する。
// deriveTermId は以下の同質な異常入力に対し一律 null を返す（fail-closed）:
//   - フラグメントが無い（href に "#" を含まない）
//   - フラグメントが "term-" で始まらない（#section 等）
//   - 不正な %XX エンコードで decodeURIComponent が例外を投げる
// decodeURIComponent は try/catch で囲み、例外でも落ちずに null を返すこと。
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTermId } from "../../src/sphinx_riddle_whisper/static/riddle.js";

// 異常系（同質ケースをテーブル駆動で集約）: いずれも null を返すべき入力。
const ABNORMAL_HREFS = [
  // フラグメント無し: "#" を含まないので term-id を導出できない。
  ["フラグメント無し（相対パスのみ）", "../index.html"],
  ["フラグメント無し（空文字）", ""],
  ["フラグメント無し（クエリのみ）", "page.html?q=1"],
  // フラグメントはあるが "term-" で始まらない: 対象外として無視する。
  ["term- 以外のフラグメント（#section）", "#section"],
  ["term- 以外のフラグメント（クロスページ #intro）", "../index.html#intro"],
  ["term- を含むが先頭でない（#x-term-0）", "#x-term-0"],
  ["空フラグメント（# のみ）", "page.html#"],
  // 不正な %XX エンコードで decodeURIComponent が例外を投げる入力。
  ["不正な %XX（#term-%）", "#term-%"],
  ["不正な %XX（#term-%E0%A4%A）", "#term-%E0%A4%A"],
  ["不正な %XX（#term-100%）", "#term-100%"],
];

for (const [label, href] of ABNORMAL_HREFS) {
  test(`term-id 導出: 異常入力（${label}）では null を返す`, () => {
    // Act
    const result = deriveTermId(href);

    // Assert: 同質な異常入力は一律 null（fail-closed）
    assert.equal(result, null);
  });
}

// 正常系（項目 t9・同質ケースをテーブル駆動で集約）:
//   - 同一ページ内リンク "#term-0" から "term-0" を導出する。
//   - クロスページリンク "../index.html#term-0" から "term-0" を導出する。
// いずれも path/query 部分は無視し、"#" 以降のフラグメントだけを見る。
const NORMAL_HREFS = [
  ["同一ページ内（#term-0）", "#term-0", "term-0"],
  ["クロスページ（../index.html#term-0）", "../index.html#term-0", "term-0"],
  ["クロスページ＋クエリ（page.html?q=1#term-42）", "page.html?q=1#term-42", "term-42"],
  ["絶対 URL（http://example.com/a.html#term-7）", "http://example.com/a.html#term-7", "term-7"],
  ["singlehtml（#document-index#term-0）", "#document-index#term-0", "term-0"],
  [
    "singlehtml 深い docname（#document-deep/glossary#term-baz）",
    "#document-deep/glossary#term-baz",
    "term-baz",
  ],
];

for (const [label, href, expected] of NORMAL_HREFS) {
  test(`term-id 導出: 正常入力（${label}）から ${expected} を導出する`, () => {
    // Act
    const result = deriveTermId(href);

    // Assert
    assert.equal(result, expected);
  });
}

test("term-id 導出: フラグメントは一度だけデコードする（二重デコードしない）", () => {
  // Arrange: "%2520" は一度デコードすると "%20"、二重デコードすると " "（空白）になる。
  // 正しい実装は一度だけデコードするので "term-%20" を保ったまま返す。
  const href = "#term-%2520";

  // Act
  const result = deriveTermId(href);

  // Assert: 一度だけのデコード結果。二重デコード（"term- "）であってはならない。
  assert.equal(result, "term-%20");
});
