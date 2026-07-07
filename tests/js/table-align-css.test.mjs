// riddle_table_align 用 CSS の静的アサート（riddle-css.test.mjs と同方式:
// node:fs で CSS テキストを読み、文字列/正規表現で規則の存在を検証する）。
// テーマ basic.css は暗黙テーブルへ .align-default { text-align: center } と
// table.align-default { margin: auto }（中央寄せ）を当てるため、ポップアップ内
// だけこれを CSS 変数（既定: 左揃え）で上書きする契約を固定する。
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

test("riddle.css: :root にテーブル揃え CSS 変数の既定（左揃え）がある", () => {
  const root = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root, ":root ブロックが存在しない");
  assert.match(root[1], /--riddle-table-text-align:\s*left;/);
  assert.match(root[1], /--riddle-table-margin-inline:\s*0 auto;/);
});

test("riddle.css: .riddle-popover table.align-default が CSS 変数で揃えを上書きする", () => {
  const rule = css.match(
    /\.riddle-popover table\.align-default\s*\{([^}]*)\}/,
  );
  assert.ok(rule, ".riddle-popover table.align-default 規則が存在しない");
  assert.match(
    rule[1],
    /text-align:\s*var\(--riddle-table-text-align\)\s*!important;/,
  );
  assert.match(
    rule[1],
    /margin-inline:\s*var\(--riddle-table-margin-inline\)\s*!important;/,
  );
});

test("riddle.css: 明示 :align: 指定（align-left/center/right）は上書き対象にしない", () => {
  assert.doesNotMatch(css, /\.riddle-popover table\.align-(left|center|right)\b/);
});
