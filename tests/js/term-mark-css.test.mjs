// :term: トリガ視覚マーキングの CSS 静的アサート（node:fs で CSS テキストを読み、
// セレクタ・プロパティ・--riddle-term-* 変数の存在を検証する）。
// computed style の実効きはブラウザ確認へ委譲する。
//
// 契約:
// - a.riddle-term が点線下線（text-decoration-*）と cursor: help を持つ。
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

// a.riddle-term のベース規則の宣言ブロック本体を抽出する。
function extractTermRuleBlocks(cssText) {
  return [...cssText.matchAll(/a\.riddle-term\b([^{}]*)\{([^}]*)\}/gi)]
    .filter((m) => m[1].trim() === "")
    .map((m) => m[2]);
}

test("riddle.css: a.riddle-term の規則が存在する", () => {
  // Act
  const blocks = extractTermRuleBlocks(css);

  // Assert
  assert.ok(blocks.length > 0, "a.riddle-term の規則が見つからない");
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

// @media print 内の a.riddle-term 規則の宣言ブロック本体を抽出する。
function extractPrintTermRuleBlocks(cssText) {
  const printBlock = extractPrintBlock(cssText);
  if (printBlock === null) {
    return [];
  }
  return [...printBlock.matchAll(/a\.riddle-term\b([^{}]*)\{([^}]*)\}/gi)]
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
