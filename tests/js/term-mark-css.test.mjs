// :term: トリガ視覚マーキングの CSS 静的アサート（node:fs で CSS テキストを読み、
// セレクタ・プロパティ・--riddle-term-* 変数の存在を検証する）。
// computed style の実効きはブラウザ確認へ委譲する。
//
// 契約:
// - a.riddle-term.riddle-term（クラス重ね・詳細度 (0,2,1)）が点線下線
//   （text-decoration-*）と cursor: help を持つ。テーマ定番の div.body a
//   （(0,1,2)・text-decoration ショートハンドは style を solid にリセットする）
//   に負けないための形。
// - 下線スタイル/色は var(--riddle-term-*) 参照（利用者が上書き可能）。
// - color を宣言しない（リンク色はテーマのまま維持する設計判断）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS_PATH = fileURLToPath(
  new URL(
    "../../src/sphinx_riddle_whisper/static/riddle.css",
    import.meta.url,
  ),
);
const css = readFileSync(CSS_PATH, "utf8");

// a.riddle-term.riddle-term（クラス重ね）のベース規則の宣言ブロック本体を抽出する。
function extractTermRuleBlocks(cssText) {
  return [
    ...cssText.matchAll(/a\.riddle-term\.riddle-term\b([^{}]*)\{([^}]*)\}/gi),
  ]
    .filter((m) => m[1].trim() === "")
    .map((m) => m[2]);
}

test("riddle.css: a.riddle-term.riddle-term（クラス重ね）の規則が存在する", () => {
  // Act
  const blocks = extractTermRuleBlocks(css);

  // Assert
  assert.ok(
    blocks.length > 0,
    "a.riddle-term.riddle-term の規則が見つからない（詳細度 (0,2,1) の契約）",
  );
});

test("riddle.css: a.riddle-term が text-decoration-line: underline を指定している", () => {
  // Arrange / Act
  const blocks = extractTermRuleBlocks(css);
  const decls = blocks
    .map((block) => /\btext-decoration-line\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert
  assert.ok(
    decls.some((value) => /\bunderline\b/i.test(value)),
    `a.riddle-term に text-decoration-line: underline が無い（値: ${JSON.stringify(decls)}）`,
  );
});

// 下線スタイル/色は var(--riddle-term-*) 参照であること（テーブル駆動）。
const TERM_VAR_BINDINGS = [
  {
    label: "下線スタイル",
    property: "text-decoration-style",
    varName: "--riddle-term-underline-style",
  },
  {
    label: "下線色",
    property: "text-decoration-color",
    varName: "--riddle-term-underline-color",
  },
];

for (const { label, property, varName } of TERM_VAR_BINDINGS) {
  test(`riddle.css: a.riddle-term の${label}が var(${varName}) を参照している`, () => {
    // Arrange / Act
    const blocks = extractTermRuleBlocks(css);
    const declRe = new RegExp(`\\b${property}\\s*:\\s*([^;}]*)`, "i");
    const varRe = new RegExp(`var\\(\\s*${varName}\\b[^)]*\\)`, "i");
    const decls = blocks
      .map((block) => declRe.exec(block))
      .filter((m) => m !== null)
      .map((m) => m[1].trim());

    // Assert
    assert.ok(
      decls.some((value) => varRe.test(value)),
      `a.riddle-term の ${property} が var(${varName}) を参照していない（値: ${JSON.stringify(decls)}）`,
    );
  });
}

test("riddle.css: a.riddle-term が cursor: help を指定している", () => {
  // Arrange / Act
  const blocks = extractTermRuleBlocks(css);
  const decls = blocks
    .map((block) => /\bcursor\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert
  assert.ok(
    decls.some((value) => /^help$/i.test(value)),
    `a.riddle-term に cursor: help が無い（cursor 値: ${JSON.stringify(decls)}）`,
  );
});

test("riddle.css: a.riddle-term は color を宣言しない（リンク色はテーマ維持）", () => {
  // Arrange / Act: text-decoration-color / background-color 等への部分一致を避けるため、
  // プロパティ名直前に区切り（行頭/空白/`;`/`{`）を要求し `color:` 単体を探す。
  const blocks = extractTermRuleBlocks(css);
  const hasColorDecl = blocks.some((block) =>
    /(?:^|[;{\s])color\s*:/i.test(block),
  );

  // Assert
  assert.ok(
    !hasColorDecl,
    "a.riddle-term が color を宣言している（テーマのリンク色を上書きしてしまう）",
  );
});

// --riddle-term-* 変数の既定値がトップレベル :root に定義されていること（テーブル駆動）。
const TERM_ROOT_VARS = [
  { varName: "--riddle-term-underline-style", expectedRe: /\bdotted\b/i },
  { varName: "--riddle-term-underline-color", expectedRe: /\bcurrentColor\b/i },
];

for (const { varName, expectedRe } of TERM_ROOT_VARS) {
  test(`riddle.css: :root に ${varName} が既定値付きで定義されている`, () => {
    // Arrange / Act: 全 :root ブロックから対象変数の宣言値を探す
    //（ダーク上書きは不要な設計 — currentColor 追従のため）。
    const rootBlocks = [...css.matchAll(/:root\b[^{}]*\{([^}]*)\}/gi)].map(
      (m) => m[1],
    );
    const declRe = new RegExp(`${varName}\\s*:\\s*([^;}]+)`, "i");
    const values = rootBlocks
      .map((block) => declRe.exec(block))
      .filter((m) => m !== null)
      .map((m) => m[1].trim());

    // Assert: 宣言が存在し、期待既定値を持つ
    assert.ok(values.length > 0, `:root に ${varName} が定義されていない`);
    assert.ok(
      values.some((value) => expectedRe.test(value)),
      `${varName} の既定値が期待と異なる（値: ${JSON.stringify(values)}）`,
    );
  });
}

// @media print ブロック本体をブレース対応で切り出す
//（.riddle-lightbox 規則などネストした {} を含むため regex 単発では不可）。
function extractPrintBlock(cssText) {
  const start = cssText.search(/@media\s+print\s*\{/i);
  if (start === -1) {
    return null;
  }
  const open = cssText.indexOf("{", start);
  let depth = 1;
  for (let i = open + 1; i < cssText.length; i += 1) {
    if (cssText[i] === "{") {
      depth += 1;
    } else if (cssText[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return cssText.slice(open + 1, i);
      }
    }
  }
  return null;
}

// @media print 内の a.riddle-term.riddle-term 規則の宣言ブロック本体を抽出する。
function extractPrintTermRuleBlocks(cssText) {
  const printBlock = extractPrintBlock(cssText);
  if (printBlock === null) {
    return [];
  }
  return [
    ...printBlock.matchAll(/a\.riddle-term\.riddle-term\b([^{}]*)\{([^}]*)\}/gi),
  ]
    .filter((m) => m[1].trim() === "")
    .map((m) => m[2]);
}

// 印刷時はポップアップが動作しないため、マーキング装飾を解除する契約（レビュー L-1）。
test("riddle.css: @media print で a.riddle-term の下線を解除している", () => {
  // Arrange / Act
  const blocks = extractPrintTermRuleBlocks(css);
  const decls = blocks
    .map((block) => /(?:^|[;{\s])text-decoration\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert
  assert.ok(
    decls.some((value) => /^none$/i.test(value)),
    `@media print の a.riddle-term に text-decoration: none が無い（値: ${JSON.stringify(decls)}）`,
  );
});

test("riddle.css: @media print で a.riddle-term の cursor を auto に戻している", () => {
  // Arrange / Act
  const blocks = extractPrintTermRuleBlocks(css);
  const decls = blocks
    .map((block) => /\bcursor\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert
  assert.ok(
    decls.some((value) => /^auto$/i.test(value)),
    `@media print の a.riddle-term に cursor: auto が無い（cursor 値: ${JSON.stringify(decls)}）`,
  );
});

// クラス重ね契約の裏面: 単一クラス形 a.riddle-term { ... } が残っていると
// 詳細度 (0,1,1) の宣言が混入してテーマ CSS（div.body a 等 (0,1,2)）に負け得る。
// トップレベル・print で走査対象を分離し、それぞれ単一クラス形が
// 存在しないことを検証する（失敗箇所を切り分けるため — レビュー M-1 対応）。
// フィルタ: クラス重ね形では m[1] が ".riddle-term..." と "." 始まりになり除外される。
// 空文字（素の単一クラス形）に加え ":" 始まり（a.riddle-term:hover 等の
// 擬似クラス/擬似要素付き単一クラス形）も捕捉する（レビュー L-1 対応）。
function extractBareTermRuleBlocks(cssText) {
  return [...cssText.matchAll(/a\.riddle-term\b([^{}]*)\{([^}]*)\}/gi)]
    .filter((m) => {
      const rest = m[1].trim();
      return rest === "" || rest.startsWith(":");
    })
    .map((m) => m[2]);
}

test("riddle.css: トップレベルに単一クラス形 a.riddle-term の規則が存在しない（詳細度ブーストの契約）", () => {
  // Arrange: @media print ブロック本体を除外してトップレベルだけを走査する
  //（print 内は次のテストが担う。printBlock が空文字のときの replace は恒等変換）。
  const printBlock = extractPrintBlock(css) ?? "";
  const nonPrintCss = css.replace(printBlock, "");

  // Act
  const bare = extractBareTermRuleBlocks(nonPrintCss);

  // Assert: トップレベルに単一クラス形が無い
  assert.equal(
    bare.length,
    0,
    `トップレベルに単一クラス形 a.riddle-term の規則が ${bare.length} 件残っている（クラス重ね形 a.riddle-term.riddle-term に統一する契約）`,
  );
});

test("riddle.css: @media print 内にも単一クラス形 a.riddle-term の規則が存在しない", () => {
  // Arrange: print ブロック本体を取り出す（無ければ空文字として扱う）
  const printBlock = extractPrintBlock(css) ?? "";

  // Act
  const bare = extractBareTermRuleBlocks(printBlock);

  // Assert: print 解除規則も (0,2,1) でなければ自前のベース規則に負ける
  assert.equal(
    bare.length,
    0,
    `@media print 内に単一クラス形 a.riddle-term の規則が ${bare.length} 件残っている（ベース規則 (0,2,1) に勝てず印刷時の解除が壊れる）`,
  );
});
