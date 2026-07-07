// #19 riddle.css の静的アサート（node:fs で CSS テキストを読み、文字列/正規表現で
// セレクタ・プロパティ・--riddle-* 変数の存在を検証する）。
// computed style の実効きは spec #24 Playwright へ委譲する。
//
// 本ファイルは項目 t1 を担当する:
//   - [hidden] セレクタの規則が存在し display:none を指定している
//     （JS は hidden 属性を出し入れして表示/非表示を制御する契約。
//      CSS は [hidden] を尊重し display:none を当てて非表示にする）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

// riddle.css のソーステキストを読む（テストファイルからの相対パスを解決）。
const CSS_PATH = fileURLToPath(
  new URL(
    "../../src/sphinx_riddle_whisper/static/riddle.css",
    import.meta.url,
  ),
);
const css = readFileSync(CSS_PATH, "utf8");

// `.riddle-popover` のベース規則（素の `.riddle-popover { … }`）の宣言ブロック
//   本体（`{ … }` の中身）を抽出する。多くのテストが「ベース規則だけを対象に
//   プロパティ/変数を検証する」ため、その共通抽出をここに集約する（重複除去）。
//
//   厳格化（項目 t1）: セレクタ部（`.riddle-popover` と `{` の間の captured group）が
//   « 空白のみ » の規則だけを base とみなす。これにより `.riddle-popover[hidden]`
//   （= `[hidden] `）はもちろん、コントラスト修正で追加する `.riddle-popover *` /
//   `.riddle-popover th` / `.riddle-popover pre` 等の複合/子孫セレクタ（= ` * ` / ` th `）も
//   base に数えない。素の `.riddle-popover {` だけを « ちょうど » 拾うため、ベース規則を
//   1 つと厳密要求するテスト（t6 系）が複合セレクタ追加後も緑のまま保たれる。
function extractBaseRuleBlocks(cssText) {
  return [...cssText.matchAll(/\.riddle-popover\b([^{}]*)\{([^}]*)\}/gi)]
    .filter((m) => m[1].trim() === "")
    .map((m) => m[2]);
}

// @media (prefers-color-scheme: dark){...} ブロックを除去した残りから、
//   トップレベル（ダークの外）の :root ブロック本体を抽出する。
//   「ライト既定がダーク :root の外に存在するか」を判定する複数テストで共用する。
function extractTopLevelRootBlocks(cssText) {
  const cssWithoutDark = cssText.replace(
    /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/gi,
    "",
  );
  return [...cssWithoutDark.matchAll(/:root\b[^{}]*\{([^}]*)\}/gi)].map(
    (m) => m[1],
  );
}

// 項目 t1（harness 是正・異常観点）: extractBaseRuleBlocks（およびベース規則抽出に
//   使う inline 正規表現）は、素の `.riddle-popover { … }` だけを「ベース規則」と
//   みなさなければならない。現状の正規表現 /\.riddle-popover\b([^{}]*)\{…\}/ は
//   captured group が空白以外（` *` / ` th` / ` pre` など）の複合/子孫セレクタも
//   ベース規則として誤って拾う。色コントラスト修正で `.riddle-popover *` や
//   `.riddle-popover th` 等の新規規則を CSS に追加すると、ベース規則を « ちょうど1つ »
//   と厳密要求する t6 が赤化してしまう（=偽の回帰）。
//   ここでは、本物の base 規則1つ＋複合/子孫セレクタ複数を含む擬似 CSS に
//   extractBaseRuleBlocks を適用したとき、複合/子孫セレクタを base に数えず
//   « ちょうど1つ（素の `.riddle-popover {` だけ）» を返すことを Red で固定する。
//   この Red を Green が「captured group が空白のみの規則だけを base とみなす」
//   厳格化で緑にし、複合セレクタ追加後も既存テストが緑のまま保たれることを保証する。
test("riddle.css: extractBaseRuleBlocks は複合/子孫セレクタ（.riddle-popover * / th / pre 等）をベース規則に数えない", () => {
  // Arrange: 素のベース規則 `.riddle-popover { … }` を1つだけ持ち、加えて
  //   コントラスト修正で追加される予定の複合/子孫セレクタ規則を複数含む擬似 CSS を組む。
  //   （`.riddle-popover *` / `.riddle-popover th` / `.riddle-popover pre` などは
  //    captured group が空白以外になり、ベース規則ではない。）
  const pseudoCss = [
    ".riddle-popover {",
    "  position: fixed;",
    "  color: var(--riddle-fg);",
    "}",
    ".riddle-popover * {",
    "  color: var(--riddle-fg) !important;",
    "  background: transparent !important;",
    "}",
    ".riddle-popover th {",
    "  background: var(--riddle-th-bg) !important;",
    "}",
    ".riddle-popover pre {",
    "  background: var(--riddle-code-bg) !important;",
    "}",
  ].join("\n");

  // Act: 擬似 CSS からベース規則ブロックを抽出する。
  const baseRuleBlocks = extractBaseRuleBlocks(pseudoCss);

  // Assert: ベース規則は « ちょうど1つ »（素の `.riddle-popover {` だけ）であり、
  //   複合/子孫セレクタ（* / th / pre）は base に数えられていないこと。
  assert.equal(
    baseRuleBlocks.length,
    1,
    `extractBaseRuleBlocks が複合/子孫セレクタをベース規則に数えている（検出数: ${baseRuleBlocks.length}、本来は素の .riddle-popover の1つだけ）`,
  );

  // Assert: 抽出された唯一の base 本体が素のベース規則の中身であること
  //   （誤って th/pre 規則を拾っていれば var(--riddle-th-bg) 等が混じる）。
  const [baseBlock] = baseRuleBlocks;
  assert.ok(
    /\bposition\s*:\s*fixed\b/i.test(baseBlock),
    `抽出された base 本体が素の .riddle-popover 規則でない（本体: ${JSON.stringify(baseBlock)}）`,
  );
  assert.ok(
    !/--riddle-th-bg|--riddle-code-bg|!important/i.test(baseBlock),
    `抽出された base 本体に複合/子孫セレクタ由来の宣言が混入している（本体: ${JSON.stringify(baseBlock)}）`,
  );
});

// 項目 t1（コントラスト喪失修正・正常観点）: ポップオーバが配下コンテンツの配色を
//   « 所有 » するため、子孫すべてに当たる包括リセット規則
//   `.riddle-popover *`（::before/::after を含むセレクタ）が存在し、
//   color: var(--riddle-fg) と background: transparent がいずれも !important で
//   指定されていること。テーマ/Pygments がダークモードで配下の表/コード/リテラル
//   ブロックに高特定度の固定色を当てると、ポップオーバ背景と文字色が近接して読めなく
//   なる。これに勝つため包括リセットは !important 必須（CSS は ESLint 対象外）。
//   computed style の実効きは spec #24 Playwright へ委譲し、ここでは CSS ソースの
//   セレクタ・プロパティ・!important・var() 参照の存在を静的に検証する。
test("riddle.css: 包括リセット規則 .riddle-popover *（::before/::after 含む）が color: var(--riddle-fg) と background: transparent をいずれも !important で指定している", () => {
  // Arrange / Act: 子孫包括セレクタ `.riddle-popover *`（同一規則のセレクタリストに
  //   ::before/::after を併記する書き方も許容）の宣言ブロックを CSS ソースから抽出する。
  //   セレクタ部に `.riddle-popover *` を含む規則の宣言ブロック本体を取り出す。
  const universalRuleMatch =
    /\.riddle-popover\s*\*[^{}]*\{([^}]*)\}/i.exec(css);

  // Assert: 包括リセット規則が存在すること（未追加なら null になり Red）。
  assert.ok(
    universalRuleMatch !== null,
    "包括リセット規則 .riddle-popover *（子孫全体に当たるセレクタ）が見つからない",
  );

  const universalBlock = universalRuleMatch[1];

  // Assert: セレクタリストに ::before / ::after が併記されていること
  //   （疑似要素は `*` の子孫一致に含まれないため明示が必要）。
  const universalSelector = /([^{}]*)\{/.exec(
    css.slice(universalRuleMatch.index),
  )[1];
  assert.ok(
    /::before/i.test(universalSelector) && /::after/i.test(universalSelector),
    `包括リセットのセレクタに ::before / ::after が併記されていない（セレクタ: ${JSON.stringify(universalSelector.trim())}）`,
  );

  // Act: color と background の宣言値を取り出す。
  const colorDecl = /\bcolor\s*:\s*([^;}]*)/i.exec(universalBlock);
  const backgroundDecl =
    /\bbackground\s*:\s*([^;}]*)/i.exec(universalBlock);

  // Assert: color が var(--riddle-fg) を !important で指定していること。
  assert.ok(colorDecl !== null, "包括リセット規則に color 宣言が見つからない");
  assert.ok(
    /var\(\s*--riddle-fg\b[^)]*\)/i.test(colorDecl[1]),
    `包括リセットの color が var(--riddle-fg) を参照していない（値: ${JSON.stringify(colorDecl[1].trim())}）`,
  );
  assert.ok(
    /!important/i.test(colorDecl[1]),
    `包括リセットの color に !important が付いていない（値: ${JSON.stringify(colorDecl[1].trim())}）`,
  );

  // Assert: background が transparent を !important で指定していること。
  assert.ok(
    backgroundDecl !== null,
    "包括リセット規則に background 宣言が見つからない",
  );
  assert.ok(
    /\btransparent\b/i.test(backgroundDecl[1]),
    `包括リセットの background が transparent を指定していない（値: ${JSON.stringify(backgroundDecl[1].trim())}）`,
  );
  assert.ok(
    /!important/i.test(backgroundDecl[1]),
    `包括リセットの background に !important が付いていない（値: ${JSON.stringify(backgroundDecl[1].trim())}）`,
  );
});

// 項目 t3（コントラスト喪失修正・正常観点）: ポップオーバが配下コンテンツの配色を
//   « 所有 » するため、表ヘッダ（th）のアクセント背景もポップオーバ側で固定する。
//   ダークモードでテーマ/Pygments が th に明るい固定背景を当てると、包括リセットで
//   文字色を var(--riddle-fg) に統一しても th の背景色と文字色が近接して読めなくなる。
//   そこで `.riddle-popover th` が background に var(--riddle-th-bg) を !important で
//   指定し、表ヘッダの背景をポップオーバが所有する（!important はテーマ/Pygments の
//   高特定度固定色に勝つため必須。CSS は ESLint 対象外）。computed style の実効きは
//   spec #24 Playwright へ委譲し、ここでは CSS ソースのセレクタ・プロパティ・
//   !important・var() 参照の存在を静的に検証する。
test("riddle.css: アクセント背景 .riddle-popover th が background に var(--riddle-th-bg) を !important で指定している", () => {
  // Arrange / Act: セレクタ部に `.riddle-popover th`（子孫の表ヘッダ）を含む規則の
  //   宣言ブロック本体を CSS ソースから抽出する。プロパティ名直前/直後の区切りで
  //   `.riddle-popover thead` 等への部分一致を避け、`th` 単体トークンを要求する。
  const thRuleMatch =
    /\.riddle-popover\s+th\b[^{}]*\{([^}]*)\}/i.exec(css);

  // Assert: アクセント背景規則 `.riddle-popover th` が存在すること（未追加なら null で Red）。
  assert.ok(
    thRuleMatch !== null,
    "アクセント背景規則 .riddle-popover th（表ヘッダ）が見つからない",
  );

  const thBlock = thRuleMatch[1];

  // Act: background（または background-color）宣言の値部分を取り出す。
  const backgroundDecl =
    /\bbackground(?:-color)?\s*:\s*([^;}]*)/i.exec(thBlock);

  // Assert: background 宣言が存在し、var(--riddle-th-bg) を !important で指定していること。
  assert.ok(
    backgroundDecl !== null,
    ".riddle-popover th に background 宣言が見つからない",
  );
  assert.ok(
    /var\(\s*--riddle-th-bg\b[^)]*\)/i.test(backgroundDecl[1]),
    `.riddle-popover th の background が var(--riddle-th-bg) を参照していない（値: ${JSON.stringify(backgroundDecl[1].trim())}）`,
  );
  assert.ok(
    /!important/i.test(backgroundDecl[1]),
    `.riddle-popover th の background に !important が付いていない（値: ${JSON.stringify(backgroundDecl[1].trim())}）`,
  );
});

// 項目 t4（コントラスト喪失修正・正常観点）: ポップオーバが配下コンテンツの配色を
//   « 所有 » するため、コード/リテラル系ブロックのアクセント背景もポップオーバ側で
//   固定する。ダークモードでテーマ/Pygments が pre / div.highlight / code / kbd / samp に
//   明るい固定背景を当てると、包括リセットで文字色を var(--riddle-fg) に統一しても
//   背景色と文字色が近接して読めなくなる。そこで `.riddle-popover` 配下のコード/リテラル
//   系セレクタ（pre / div.highlight / .highlight pre / code / kbd / samp）が
//   background に var(--riddle-code-bg) を !important で指定し、コード/リテラルの背景を
//   ポップオーバが所有する（!important はテーマ/Pygments の高特定度固定色に勝つため必須。
//   CSS は ESLint 対象外）。computed style の実効きは spec #24 Playwright へ委譲し、
//   ここでは CSS ソースのセレクタ・プロパティ・!important・var() 参照の存在を静的に検証する。
//   テーブル駆動で対象セレクタを一括検証する。
const CODE_BG_SELECTORS = [
  // selectorRe: セレクタ部に「`.riddle-popover` 配下の当該コード/リテラルセレクタ」を
  //   含む規則を見つけるためのパターン。セレクタリストでの併記
  //   （`.riddle-popover pre, .riddle-popover code { … }` など）や、
  //   `.riddle-popover` 配下の子孫としての記述を許容する。
  { label: "pre", selectorRe: /\.riddle-popover\s+pre\b/i },
  { label: "div.highlight", selectorRe: /\.riddle-popover\s+div\.highlight\b/i },
  { label: ".highlight pre", selectorRe: /\.riddle-popover\s+\.highlight\s+pre\b/i },
  { label: "code", selectorRe: /\.riddle-popover\s+code\b/i },
  { label: "kbd", selectorRe: /\.riddle-popover\s+kbd\b/i },
  { label: "samp", selectorRe: /\.riddle-popover\s+samp\b/i },
];

for (const { label, selectorRe } of CODE_BG_SELECTORS) {
  test(`riddle.css: アクセント背景 .riddle-popover 配下の ${label} が background に var(--riddle-code-bg) を !important で指定している`, () => {
    // Arrange / Act: CSS ソースから「セレクタリストに当該コード/リテラルセレクタを含み、
    //   宣言ブロックで background に var(--riddle-code-bg) を !important 指定する」規則を探す。
    //   コード/リテラル系セレクタは1つの規則のセレクタリストに併記される想定なので、
    //   全規則を走査して「セレクタ部が対象に一致し、かつブロックで code-bg を !important
    //   指定する」ものを収集する。
    const ruleBlocks = [...css.matchAll(/([^{}]*)\{([^}]*)\}/gi)]
      .filter((m) => selectorRe.test(m[1]))
      .map((m) => m[2]);

    // Assert: 当該セレクタを含む規則が存在すること（未追加なら 0 件で Red）。
    assert.ok(
      ruleBlocks.length > 0,
      `アクセント背景規則 .riddle-popover 配下の ${label} が見つからない`,
    );

    // Act: 当該セレクタを含む規則のいずれかが background に var(--riddle-code-bg) を
    //   !important で指定しているか調べる。
    const matching = ruleBlocks
      .map((block) => /\bbackground(?:-color)?\s*:\s*([^;}]*)/i.exec(block))
      .filter((m) => m !== null)
      .map((m) => m[1])
      .filter(
        (value) =>
          /var\(\s*--riddle-code-bg\b[^)]*\)/i.test(value) &&
          /!important/i.test(value),
      );

    // Assert: background が var(--riddle-code-bg) を !important で指定する宣言が
    //   少なくとも 1 つあること。
    assert.ok(
      matching.length > 0,
      `.riddle-popover 配下の ${label} の background が var(--riddle-code-bg) を !important で指定していない`,
    );
  });
}

test("riddle.css: [hidden] セレクタの規則があり display: none を指定している", () => {
  // Arrange / Act: CSS ソースから [hidden] を含むセレクタブロックを探す。
  // セレクタ部に [hidden] を含み、宣言ブロック内に display: none がある規則を
  // 検出する（.riddle-popover[hidden] / [hidden] いずれの書き方も許容）。
  const rule = /\[hidden\][^{}]*\{[^}]*\bdisplay\s*:\s*none\b[^}]*\}/i.test(css);

  // Assert
  assert.ok(
    rule,
    "[hidden] を含むセレクタで display: none を指定する規則が見つからない",
  );
});

test("riddle.css: .riddle-popover の基本規則が display を宣言せず [hidden] の display:none を上書きしない", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（素のベース規則）のみを抽出する。
  //   JS は hidden 属性の出し入れで表示/非表示を切り替える契約なので、ベース規則が
  //   無条件に display を宣言すると [hidden] { display: none } を上書きしてしまい
  //   hidden トグルが効かなくなる。抽出は厳格化済みの共通ヘルパに委譲する
  //   （[hidden] や複合/子孫セレクタを base に数えない）。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則の宣言ブロック内に bare な display 宣言があるか調べる。
  const hasUnconditionalDisplay = baseRuleBlocks.some((block) =>
    /\bdisplay\s*:/i.test(block),
  );

  // Assert: ベース規則が存在し、かつ display を宣言していないこと。
  assert.ok(
    baseRuleBlocks.length > 0,
    ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
  );
  assert.ok(
    !hasUnconditionalDisplay,
    ".riddle-popover の基本規則が display を宣言しており [hidden] の display:none を上書きしうる",
  );
});

// 項目 t7: .riddle-popover セレクタが存在し position: fixed が指定されている
//   （JS は el.style.top / el.style.left に px を書き込み、ビューポート基準で
//    ポップオーバを配置する契約。CSS はそれに整合するよう position: fixed を
//    当てる。fixed でないとスクロール時に座標がずれてしまう）。
test("riddle.css: .riddle-popover の基本規則に position: fixed が指定されている", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。position はベース規則で定義される想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則内の position 宣言を取り出す（値部分だけ）。
  const positionDecls = baseRuleBlocks
    .map((block) => /\bposition\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert: .riddle-popover の基本規則が存在し、position: fixed を宣言している。
  assert.ok(
    baseRuleBlocks.length > 0,
    ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
  );
  assert.ok(
    positionDecls.some((value) => /^fixed$/i.test(value)),
    `.riddle-popover の基本規則に position: fixed が指定されていない（position 値: ${JSON.stringify(positionDecls)}）`,
  );
});

// ポップオーバ本文の揃え: .riddle-popover は body へ append される共有要素のため、
//   ベース規則で text-align を宣言しないと body／ホストテーマ側の text-align（中央揃え等）を
//   継承してしまう。注入ウィジェットを外周から独立させるため、ベース規則で text-align: left を
//   明示し継承を断ち切る（実 computed style の検証は spec #24 Playwright へ委譲）。
test("riddle.css: .riddle-popover の基本規則に text-align: left が指定されている", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。text-align はベース規則で定義される想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則内の text-align 宣言を取り出す（値部分だけ）。
  const textAlignDecls = baseRuleBlocks
    .map((block) => /\btext-align\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert: text-align 宣言が存在し、その値が left（左詰め）であること。
  assert.ok(
    baseRuleBlocks.length > 0,
    ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
  );
  assert.ok(
    textAlignDecls.length > 0,
    ".riddle-popover の基本規則に text-align 宣言が見つからない",
  );
  assert.ok(
    textAlignDecls.some((value) => /^left$/i.test(value)),
    `.riddle-popover の text-align が left で指定されていない（text-align 値: ${JSON.stringify(textAlignDecls)}）`,
  );
});

test("riddle.css: .riddle-popover の max-height がハードコード値でなく var(--riddle-max-height ...) を参照している", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。max-height はベース規則で定義される想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則内の max-height 宣言を取り出す（値部分だけ）。
  //   末尾セミコロン/ブロック終端まで（`;` か `}` 手前）を値とみなす。
  const maxHeightDecls = baseRuleBlocks
    .map((block) => /\bmax-height\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert: max-height 宣言が存在し、かつ var(--riddle-max-height …) を参照している
  //   （ハードコードの長さ値ではなく CSS 変数経由であること）。
  assert.ok(
    maxHeightDecls.length > 0,
    ".riddle-popover の基本規則に max-height 宣言が見つからない",
  );
  assert.ok(
    maxHeightDecls.every((value) =>
      /var\(\s*--riddle-max-height\b[^)]*\)/i.test(value),
    ),
    `.riddle-popover の max-height が var(--riddle-max-height …) を参照していない（値: ${JSON.stringify(maxHeightDecls)}）`,
  );
});

test("riddle.css: .riddle-popover の max-width がハードコード値でなく var(--riddle-max-width ...) を参照している", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。max-width はベース規則で定義される想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則内の max-width 宣言を取り出す（値部分だけ）。
  //   末尾セミコロン/ブロック終端まで（`;` か `}` 手前）を値とみなす。
  const maxWidthDecls = baseRuleBlocks
    .map((block) => /\bmax-width\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert: max-width 宣言が存在し、かつ var(--riddle-max-width …) を参照している
  //   （ハードコードの長さ値ではなく CSS 変数経由であること）。
  assert.ok(
    maxWidthDecls.length > 0,
    ".riddle-popover の基本規則に max-width 宣言が見つからない",
  );
  assert.ok(
    maxWidthDecls.every((value) =>
      /var\(\s*--riddle-max-width\b[^)]*\)/i.test(value),
    ),
    `.riddle-popover の max-width が var(--riddle-max-width …) を参照していない（値: ${JSON.stringify(maxWidthDecls)}）`,
  );
});

// 項目 t8: .riddle-popover の基本規則に overflow-y（auto/scroll 系）が指定され、
//   長い定義がポップオーバからはみ出さずスクロールできる
//   （max-height で高さを制限したうえで overflow-y: auto により縦スクロールさせる契約）。
test("riddle.css: .riddle-popover の基本規則に overflow-y が auto/scroll 系で指定されている", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。overflow-y はベース規則で定義される想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則内の overflow-y 宣言を取り出す（値部分だけ）。
  //   末尾セミコロン/ブロック終端まで（`;` か `}` 手前）を値とみなす。
  const overflowYDecls = baseRuleBlocks
    .map((block) => /\boverflow-y\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert: overflow-y 宣言が存在し、その値が auto / scroll / overlay のいずれか
  //   （縦方向にスクロール可能なはみ出し制御であること）。
  assert.ok(
    overflowYDecls.length > 0,
    ".riddle-popover の基本規則に overflow-y 宣言が見つからない",
  );
  assert.ok(
    overflowYDecls.some((value) => /^(auto|scroll|overlay)$/i.test(value)),
    `.riddle-popover の overflow-y が auto/scroll 系で指定されていない（overflow-y 値: ${JSON.stringify(overflowYDecls)}）`,
  );
});

// 項目 t9: .riddle-popover の基本規則に z-index が指定され重なり順が制御される
//   （境界観点: ポップオーバは本文の上に重ねて表示されるため、position: fixed と
//    あわせて z-index で重なり順を明示する。z-index が無いと他の positioned 要素に
//    隠れうる）。値は整数（auto は重なり順を制御しないため不可）であることを確認する。
test("riddle.css: .riddle-popover の基本規則に z-index が整数値で指定されている", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。z-index はベース規則で定義される想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Act: ベース規則内の z-index 宣言を取り出す（値部分だけ）。
  const zIndexDecls = baseRuleBlocks
    .map((block) => /\bz-index\s*:\s*([^;}]*)/i.exec(block))
    .filter((m) => m !== null)
    .map((m) => m[1].trim());

  // Assert: z-index 宣言が存在し、その値が整数（重なり順を実際に制御する値）
  //   であること。auto は重なり順を制御しないため不可とする。
  assert.ok(
    baseRuleBlocks.length > 0,
    ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
  );
  assert.ok(
    zIndexDecls.length > 0,
    ".riddle-popover の基本規則に z-index 宣言が見つからない",
  );
  assert.ok(
    zIndexDecls.some((value) => /^-?\d+$/.test(value)),
    `.riddle-popover の z-index が整数値で指定されていない（z-index 値: ${JSON.stringify(zIndexDecls)}）`,
  );
});

// 項目 t5: @media (prefers-color-scheme: dark) ブロックが存在し、その中で
//   色系 --riddle-* 変数（--riddle-bg / --riddle-fg / --riddle-border）が
//   再定義（上書き）されている（ライトを既定、ダークをメディアクエリで）。
//   テーブル駆動で主要な色系変数の上書きを確認する。
const DARK_OVERRIDE_VARS = ["--riddle-bg", "--riddle-fg", "--riddle-border"];

for (const varName of DARK_OVERRIDE_VARS) {
  test(`riddle.css: @media (prefers-color-scheme: dark) 内で ${varName} が再定義されている`, () => {
    // Arrange: prefers-color-scheme: dark のメディアクエリブロックの中身
    //   （`@media … (prefers-color-scheme: dark) … { … }` の本体）を抽出する。
    //   ネストした {} を素朴な正規表現で扱うため、@media 開始から本体の中身を
    //   1 段ネスト分まで含めて取り出す。
    const darkBlock = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/i.exec(
      css,
    );

    // Assert: ダークのメディアクエリブロックが存在すること。
    assert.ok(
      darkBlock !== null,
      "@media (prefers-color-scheme: dark) のブロックが見つからない",
    );

    // Act: ブロック本体で対象の色系変数が宣言（上書き）されているか調べる。
    const overridden = new RegExp(
      `${varName}\\s*:\\s*[^;}]+`,
      "i",
    ).test(darkBlock[1]);

    // Assert
    assert.ok(
      overridden,
      `@media (prefers-color-scheme: dark) 内で ${varName} が再定義されていない`,
    );
  });
}

// 項目 t6（コントラスト喪失修正・正常観点）: コントラスト修正で新設するアクセント背景
//   変数 --riddle-th-bg / --riddle-code-bg は、ライト既定（トップレベル :root, t5 で検証）
//   とは別に « @media (prefers-color-scheme: dark) 内 » でダーク向けに再定義（上書き）されて
//   いること。spec の方針は『ライトを既定、ダークをメディアクエリで上書き』であり、これらの
//   アクセント背景変数も色系3変数（t5 の DARK_OVERRIDE_VARS）と同様にダーク環境で上書きして
//   配色を切り替える契約。ダーク上書きが無いとダークモードでも th/コードの背景がライト既定
//   （明るい色）のまま残り、包括リセットで統一した文字色（var(--riddle-fg)）との
//   コントラストが喪失して読めなくなる。抽出は DARK_OVERRIDE_VARS と同一手法（dark の
//   メディアクエリブロック本体を 1 段ネストまで取り出して変数宣言の有無を見る）を用い、
//   テーブル駆動で 2 変数のダーク上書きの存在を検証する（実描画は spec #24 Playwright へ委譲）。
const ACCENT_BG_DARK_OVERRIDE_VARS = ["--riddle-th-bg", "--riddle-code-bg"];

for (const varName of ACCENT_BG_DARK_OVERRIDE_VARS) {
  test(`riddle.css: @media (prefers-color-scheme: dark) 内で ${varName} がダーク向けに再定義されている`, () => {
    // Arrange: prefers-color-scheme: dark のメディアクエリブロックの中身
    //   （`@media … (prefers-color-scheme: dark) … { … }` の本体）を抽出する。
    //   ネストした {} を素朴な正規表現で扱うため、@media 開始から本体の中身を
    //   1 段ネスト分まで含めて取り出す（t5 の DARK_OVERRIDE_VARS と同一手法）。
    const darkBlock =
      /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/i.exec(
        css,
      );

    // Assert: ダークのメディアクエリブロックが存在すること。
    assert.ok(
      darkBlock !== null,
      "@media (prefers-color-scheme: dark) のブロックが見つからない",
    );

    // Act: ブロック本体で対象のアクセント背景変数が « 非空値 » で宣言（上書き）されて
    //   いるか調べる（`--riddle-foo: <非空の値>` を要求する）。
    const overridden = new RegExp(`${varName}\\s*:\\s*[^;}]+`, "i").test(
      darkBlock[1],
    );

    // Assert: アクセント背景変数がダーク向けに再定義されていること。
    assert.ok(
      overridden,
      `@media (prefers-color-scheme: dark) 内で ${varName} がダーク向けに再定義されていない`,
    );
  });
}

// 項目 t6: :root に主要 --riddle-* カスタムプロパティ群が既定値付きで
//   定義されている（.riddle-popover はこれらを var() 参照する契約）。
//   テーブル駆動で主要変数の存在＋既定値を確認する。
const ROOT_VARS = [
  "--riddle-max-width",
  "--riddle-max-height",
  "--riddle-bg",
  "--riddle-fg",
  "--riddle-border",
  "--riddle-radius",
  "--riddle-shadow",
  "--riddle-padding",
];

for (const varName of ROOT_VARS) {
  test(`riddle.css: :root に ${varName} が既定値付きで定義されている`, () => {
    // Arrange: :root セレクタの宣言ブロック本体を抽出する。
    //   （メディアクエリ内のダーク向け :root と区別するため、トップレベルの
    //    :root ブロックのみを対象にしたいが、ここでは全 :root ブロックを連結し
    //    「いずれかで既定値が定義されている」ことを確認する。
    //    ダーク上書きは t5 で別途検証済み。）
    const rootBlocks = [...css.matchAll(/:root\b[^{}]*\{([^}]*)\}/gi)].map(
      (m) => m[1],
    );

    // Assert: :root 規則が存在すること。
    assert.ok(rootBlocks.length > 0, ":root の規則が見つからない");

    // Act: いずれかの :root ブロックで対象変数が既定値付きで宣言されているか。
    //   `--riddle-foo: <非空の値>;` を要求する（宣言だけで値が無いものは不可）。
    const declared = rootBlocks.some((block) =>
      new RegExp(`${varName}\\s*:\\s*[^;}]+`, "i").test(block),
    );

    // Assert
    assert.ok(
      declared,
      `:root に ${varName} が既定値付きで定義されていない`,
    );
  });
}

// 項目 t1（t6 是正・異常観点）: 色系3変数（--riddle-bg/--riddle-fg/--riddle-border）の
//   ライト既定は『トップレベル（@media dark の外）の :root』に存在しなければならない。
//   既存 t6 は全 :root ブロック（ダーク用 :root を含む）を rootBlocks.some(...) で
//   判定するため、色変数が「ダーク :root だけ」に定義されライト既定が無くても
//   パスしてしまう偽陰性があった（spec は『ライトを既定、ダークをメディアクエリで上書き』）。
//   ここでは @media (prefers-color-scheme: dark){...} ブロックを CSS テキストから
//   除去した残りに対して :root を抽出し、色系変数のライト既定が存在することを検証する。
//   テーブル駆動で 3 変数を確認する。
const LIGHT_DEFAULT_COLOR_VARS = [
  "--riddle-bg",
  "--riddle-fg",
  "--riddle-border",
];

for (const varName of LIGHT_DEFAULT_COLOR_VARS) {
  test(`riddle.css: ${varName} のライト既定が @media dark の外のトップレベル :root に定義されている`, () => {
    // Arrange / Act: @media dark ブロックを除いた残りから、トップレベル
    //   （ダークの外）の :root ブロック本体を抽出する。
    const topLevelRootBlocks = extractTopLevelRootBlocks(css);

    // Assert: トップレベル :root が存在すること（ダーク :root しか無い構成を弾く）。
    assert.ok(
      topLevelRootBlocks.length > 0,
      "@media dark の外にトップレベルの :root が見つからない",
    );

    // Act: トップレベル :root に対象色変数のライト既定が宣言されているか。
    const hasLightDefault = topLevelRootBlocks.some((block) =>
      new RegExp(`${varName}\\s*:\\s*[^;}]+`, "i").test(block),
    );

    // Assert: 色系変数のライト既定がトップレベル :root に存在すること。
    assert.ok(
      hasLightDefault,
      `${varName} のライト既定が @media dark の外の :root に定義されていない（ダーク :root だけに書かれていないか確認すること）`,
    );
  });
}

// 項目 t2（t6 是正の回帰捕捉・境界観点）: ライト既定検証ロジックが偽陰性を
//   起こさないことを保証する。t1 が採用する「@media dark ブロックを除去し、残りから
//   トップレベル :root を抽出して色変数の既定を探す」手順を、色系3変数を『ダーク :root
//   だけ』に書きライト :root から欠落させた擬似 CSS に適用したとき、その手順が必ず
//   『ライト既定は存在しない』と判定する（=ロジックを通過させない）ことを確認する。
//   これにより「色変数をダーク :root だけに書いた CSS」を t1 が緑のまま見逃す偽陰性が
//   起き得ないことを境界で固定する。
function lightDefaultExists(cssText, varName) {
  // t1 と同一の手順: @media (prefers-color-scheme: dark){...} を取り除いた残りの
  //   トップレベル :root に色変数の既定が宣言されているかを判定する。
  return extractTopLevelRootBlocks(cssText).some((block) =>
    new RegExp(`${varName}\\s*:\\s*[^;}]+`, "i").test(block),
  );
}

test("riddle.css: ライト既定検証ロジックは色変数をダーク :root だけに書いた擬似 CSS を必ず不合格にする（偽陰性を起こさない）", () => {
  // Arrange: 色系3変数（--riddle-bg/--riddle-fg/--riddle-border）を @media dark の
  //   ダーク :root だけに定義し、トップレベル（ライト）:root には非色変数しか持たない
  //   擬似 CSS を組む。これは spec の『ライト既定、ダーク上書き』に違反する不正な CSS。
  const pseudoCssDarkOnly = [
    ":root {",
    "  --riddle-max-width: 32rem;",
    "  --riddle-max-height: 24rem;",
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    "    --riddle-bg: #1a1a1a;",
    "    --riddle-fg: #f0f0f0;",
    "    --riddle-border: #404040;",
    "  }",
    "}",
  ].join("\n");

  // Act / Assert: 色系3変数いずれについても、ライト既定検証ロジックは
  //   『ライト既定は存在しない』と判定しなければならない（true を返してはならない）。
  //   ここで true を返すと、ダーク :root だけに書いた不正 CSS を見逃す偽陰性となる。
  for (const varName of ["--riddle-bg", "--riddle-fg", "--riddle-border"]) {
    assert.equal(
      lightDefaultExists(pseudoCssDarkOnly, varName),
      false,
      `ライト既定検証ロジックが ${varName} を「ダーク :root だけ」の擬似 CSS で誤って合格させた（偽陰性）`,
    );
  }

  // Assert（対照）: 正しい構成（トップレベル :root にライト既定あり）なら true を返す
  //   ことも確認し、ロジックが常に false を返す『緩すぎ』でないことを担保する。
  const pseudoCssWithLightDefault = [
    ":root {",
    "  --riddle-bg: #ffffff;",
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    "    --riddle-bg: #1a1a1a;",
    "  }",
    "}",
  ].join("\n");
  assert.equal(
    lightDefaultExists(pseudoCssWithLightDefault, "--riddle-bg"),
    true,
    "ライト既定検証ロジックが、トップレベル :root にライト既定を持つ正しい CSS を不合格にした",
  );
});

// 項目 t5（コントラスト喪失修正・正常観点）: コントラスト修正で新設するアクセント背景
//   変数 --riddle-th-bg / --riddle-code-bg のライト既定が、ダーク向け上書きとは別に
//   « @media dark の外のトップレベル :root » に非空値で定義されていること。spec の方針は
//   『ライトを既定、ダークをメディアクエリで上書き』であり、これらの変数も色系3変数と
//   同様にライト既定をトップレベル :root に置く（ライト環境で var() がフォールバック無しでも
//   解決でき、ダークは @media dark の :root 上書きで切り替わる契約）。ダーク :root だけに
//   書いてライト既定が欠落していると、ライト環境で th/コード背景が空値になり破綻する。
//   抽出はライト既定検証で実績のある extractTopLevelRootBlocks ヘルパに委譲し、
//   テーブル駆動で 2 変数のライト既定の存在を検証する（実描画は spec #24 Playwright へ委譲）。
const ACCENT_BG_LIGHT_DEFAULT_VARS = ["--riddle-th-bg", "--riddle-code-bg"];

for (const varName of ACCENT_BG_LIGHT_DEFAULT_VARS) {
  test(`riddle.css: ${varName} のライト既定が @media dark の外のトップレベル :root に非空値で定義されている`, () => {
    // Arrange / Act: @media dark ブロックを除いた残りから、トップレベル
    //   （ダークの外）の :root ブロック本体を抽出する。
    const topLevelRootBlocks = extractTopLevelRootBlocks(css);

    // Assert: トップレベル :root が存在すること（ダーク :root しか無い構成を弾く）。
    assert.ok(
      topLevelRootBlocks.length > 0,
      "@media dark の外にトップレベルの :root が見つからない",
    );

    // Act: トップレベル :root に対象アクセント背景変数のライト既定が « 非空値 » で
    //   宣言されているか調べる（`--riddle-foo: <非空の値>;` を要求し、宣言だけで値が
    //   無いものは不可とする）。
    const hasLightDefault = topLevelRootBlocks.some((block) =>
      new RegExp(`${varName}\\s*:\\s*[^;}]+`, "i").test(block),
    );

    // Assert: アクセント背景変数のライト既定がトップレベル :root に存在すること。
    assert.ok(
      hasLightDefault,
      `${varName} のライト既定が @media dark の外の :root に非空値で定義されていない（ダーク :root だけに書かれていないか確認すること）`,
    );
  });
}

// 項目 t3（是正1: 外観変数の未適用）: .riddle-popover のベース規則が
//   背景/文字色/境界/角丸/影/余白を、それぞれ対応する var(--riddle-*) で
//   参照していること（定義だけのデッド変数にせず、ベース規則で実際に var() 適用する）。
//   テーブル駆動で「プロパティ × 参照すべき変数名」の対応表を検証する。
//   - background（または background-color）: var(--riddle-bg)
//   - color: var(--riddle-fg)
//   - border（任意のショートハンド内）: var(--riddle-border)
//   - border-radius: var(--riddle-radius)
//   - box-shadow: var(--riddle-shadow)
//   - padding: var(--riddle-padding)
const APPEARANCE_VAR_BINDINGS = [
  // property: 宣言を探すためのプロパティ名パターン（正規表現の一部）
  // varName: その宣言の値部分で var() 参照されているべき変数名
  // 背景は background / background-color のどちらの書き方も許容する。
  { label: "背景", property: "background(?:-color)?", varName: "--riddle-bg" },
  { label: "文字色", property: "color", varName: "--riddle-fg" },
  // border は border / border-color など var(--riddle-border) を含む境界宣言を許容する。
  { label: "境界", property: "border(?:-color)?", varName: "--riddle-border" },
  { label: "角丸", property: "border-radius", varName: "--riddle-radius" },
  { label: "影", property: "box-shadow", varName: "--riddle-shadow" },
  { label: "余白", property: "padding", varName: "--riddle-padding" },
];

for (const { label, property, varName } of APPEARANCE_VAR_BINDINGS) {
  test(`riddle.css: .riddle-popover のベース規則が ${label}を var(${varName}) で参照している`, () => {
    // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
    //   宣言ブロックを抽出する。外観変数の適用はベース規則で行われる想定。
    const baseRuleBlocks = extractBaseRuleBlocks(css);

    // Assert: ベース規則が存在すること。
    assert.ok(
      baseRuleBlocks.length > 0,
      ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
    );

    // Act: 対象プロパティの宣言を取り出し、その値部分に var(--riddle-*) 参照が
    //   含まれているか調べる（color は border-color/background-color に部分一致
    //   しないよう、プロパティ名直前に区切り（行頭/空白/`;`/`{`）を要求する）。
    const declRe = new RegExp(
      `(?:^|[;{\\s])(${property})\\s*:\\s*([^;}]*)`,
      "gi",
    );
    const varRe = new RegExp(`var\\(\\s*${varName}\\b[^)]*\\)`, "i");
    const referencingValues = baseRuleBlocks
      .flatMap((block) => [...block.matchAll(declRe)])
      .map((m) => m[2].trim())
      .filter((value) => varRe.test(value));

    // Assert: 当該プロパティが var(--riddle-*) を参照する宣言が少なくとも 1 つある。
    assert.ok(
      referencingValues.length > 0,
      `.riddle-popover のベース規則で ${label}が var(${varName}) を参照していない（${property} の宣言で var(${varName}) が見つからない）`,
    );
  });
}

// 項目 t4（是正1の非ハードコード保証・異常観点）: 上記6プロパティの値部分が
//   リテラル（色コード/長さ/box-shadow リテラル）でなく var(--riddle-*) 参照に
//   なっていることを確認する（ハードコード回帰の捕捉）。t3 は「値に var() 参照を
//   含む」ことを確認するが、`background: #fff; background: var(--riddle-bg);` のように
//   ハードコードと var() が同居しても t3 は緑になりうる。t4 は対象プロパティの
//   « 当該6プロパティ由来の »すべての宣言値からハードコードのリテラル
//   （hex 色 / rgb()・hsl() / box-shadow の数値長さ など）を排除し、値が var(--riddle-*)
//   参照だけで構成されている（border は `1px solid var(--riddle-border)` のような
//   キーワード＋var() を許容）ことを assert することで、リテラルへの回帰を捕捉する。
//   テーブル駆動で「プロパティ × 参照すべき変数名」を検証する。
// ハードコードのリテラル値を検出するパターン群（ポップオーバの外観に直書きされうるもの）:
//   - hex 色（#fff / #ffffff など）
//   - rgb()/rgba()/hsl()/hsla() の色関数
//   - 数値＋単位の長さ（box-shadow の `2px` や padding の `0.75rem` など）
//   - 単位なしの 0（box-shadow の `0 2px ...` の先頭 0 など）
const COLOR_LITERAL_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i;
const LENGTH_LITERAL_RE = /\b\d*\.?\d+(?:px|rem|em|%|vh|vw|pt|ch|ex)\b|(?:^|\s)0(?=\s|$)/i;
const FULL_LITERAL_RE = new RegExp(
  `${COLOR_LITERAL_RE.source}|${LENGTH_LITERAL_RE.source}`,
  "i",
);

const NON_HARDCODE_VAR_BINDINGS = [
  // literalRe: var() を除いた残り値に残っていてはならないリテラルのパターン。
  //   背景/文字色/角丸/影/余白は値全体を var() に委ねる想定なので、色も長さも
  //   直書きを許さない（FULL_LITERAL_RE）。
  //   border は `1px solid var(--riddle-border)` のように太さ/スタイルのキーワードを
  //   伴うショートハンドが許容されるため、色のリテラル直書きだけを排除する
  //   （COLOR_LITERAL_RE。太さ `1px` は var() 化対象でないので許容）。
  {
    label: "背景",
    property: "background(?:-color)?",
    varName: "--riddle-bg",
    literalRe: FULL_LITERAL_RE,
  },
  {
    label: "文字色",
    property: "color",
    varName: "--riddle-fg",
    literalRe: FULL_LITERAL_RE,
  },
  {
    label: "境界",
    property: "border(?:-color)?",
    varName: "--riddle-border",
    literalRe: COLOR_LITERAL_RE,
  },
  {
    label: "角丸",
    property: "border-radius",
    varName: "--riddle-radius",
    literalRe: FULL_LITERAL_RE,
  },
  {
    label: "影",
    property: "box-shadow",
    varName: "--riddle-shadow",
    literalRe: FULL_LITERAL_RE,
  },
  {
    label: "余白",
    property: "padding",
    varName: "--riddle-padding",
    literalRe: FULL_LITERAL_RE,
  },
];

for (const { label, property, varName, literalRe } of NON_HARDCODE_VAR_BINDINGS) {
  test(`riddle.css: .riddle-popover の${label}がハードコードのリテラルでなく var(${varName}) 参照になっている`, () => {
    // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
    //   宣言ブロックを抽出する。外観の適用はベース規則で行われる想定。
    const baseRuleBlocks = extractBaseRuleBlocks(css);

    // Assert: ベース規則が存在すること。
    assert.ok(
      baseRuleBlocks.length > 0,
      ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
    );

    // Act: 対象プロパティの宣言値をすべて取り出す（color が background-color /
    //   border-color に部分一致しないよう、プロパティ名直前に区切りを要求する）。
    const declRe = new RegExp(
      `(?:^|[;{\\s])(${property})\\s*:\\s*([^;}]*)`,
      "gi",
    );
    const varRe = new RegExp(`var\\(\\s*${varName}\\b[^)]*\\)`, "i");
    const values = baseRuleBlocks
      .flatMap((block) => [...block.matchAll(declRe)])
      .map((m) => m[2].trim());

    // Assert: 対象プロパティの宣言が存在すること（未適用＝宣言なしも回帰）。
    assert.ok(
      values.length > 0,
      `.riddle-popover のベース規則に ${property} の宣言が見つからない`,
    );

    // Assert: すべての宣言値が var(--riddle-*) を参照していること。
    assert.ok(
      values.every((value) => varRe.test(value)),
      `.riddle-popover の${label}に var(${varName}) を参照しない宣言がある（値: ${JSON.stringify(values)}）`,
    );

    // Assert（異常観点の核）: var() 参照を取り除いた残りにハードコードのリテラル
    //   （hex 色 / rgb()・hsl() / 長さ単位 / 単位なし 0）が残っていないこと。
    //   `background: #fff` のような直書きや `box-shadow: 0 2px 8px ...` のような
    //   リテラル回帰を捕捉する（border の `1px solid` は var() 化対象でないが、
    //   border の長さ/色を直書きせず色は var(--riddle-border) に委ねる前提で、
    //   ここでは色・影・角丸・余白・背景・文字色のリテラル直書きを排除する）。
    const literalLeftovers = values
      .map((value) => value.replace(/var\(\s*--riddle-[\w-]*\b[^)]*\)/gi, ""))
      .filter((rest) => literalRe.test(rest));

    assert.deepEqual(
      literalLeftovers,
      [],
      `.riddle-popover の${label}にハードコードのリテラル値が直書きされている（var(${varName}) で参照すべき。残り: ${JSON.stringify(literalLeftovers)}）`,
    );
  });
}

// 項目 t5（境界観点・border ショートハンド形の保証）: .riddle-popover の境界が
//   `border: <幅> <スタイル> var(--riddle-border)` のショートハンド形（色のみ変数で、
//   幅とスタイルは固定キーワード）として解釈でき、`border-color: var(--riddle-border)` のみ
//   （= border ショートハンドではなく color サブプロパティ単独）や、幅/スタイルの欠落へ
//   退行していないことを確認する。
//   spec の意図: 境界は `border: 1px solid var(--riddle-border)` のように幅・スタイルを
//   固定し色だけを var(--riddle-border) で受ける。`border-color` 単独では幅/スタイルが
//   当たらず境界線が描画されない退行になりうるため、border ショートハンドであることを
//   厳密に確認する（幅トークン＋スタイルキーワード＋var(--riddle-border) の3要素を要求）。
test("riddle.css: .riddle-popover の境界が border: <幅> <スタイル> var(--riddle-border) のショートハンド形で、border-color 単独に退行していない", () => {
  // Arrange: 基本規則 `.riddle-popover { … }`（[hidden] を含まないベース規則）の
  //   宣言ブロックを抽出する。境界の適用はベース規則で行われる想定。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Assert: ベース規則が存在すること。
  assert.ok(
    baseRuleBlocks.length > 0,
    ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
  );

  // Act: ベース規則から `border` ショートハンドの宣言（`border-color` 等のサブプロパティ
  //   ではなく、プロパティ名がちょうど `border` のもの）の値を取り出す。
  //   プロパティ名直前に区切り（行頭/空白/`;`/`{`）、直後に `:` を要求し、
  //   `border-color` / `border-radius` 等への部分一致を排除する。
  const borderShorthandDecls = baseRuleBlocks
    .flatMap((block) => [
      ...block.matchAll(/(?:^|[;{\s])border\s*:\s*([^;}]*)/gi),
    ])
    .map((m) => m[1].trim());

  // Assert: border ショートハンド宣言が存在すること（border-color 単独に退行していると
  //   ここで 0 件になり捕捉される）。
  assert.ok(
    borderShorthandDecls.length > 0,
    ".riddle-popover のベース規則に border ショートハンド宣言が無い（border-color 単独へ退行していないか確認すること）",
  );

  // Assert: いずれかの border ショートハンド値が
  //   「幅トークン（長さ or thin/medium/thick）＋ スタイルキーワード ＋ var(--riddle-border)」
  //   の3要素を備えていること（色のみ変数・幅/スタイルは固定）。
  //   border スタイルキーワード（solid/dashed/dotted/double/groove/ridge/inset/outset/none/hidden）と、
  //   幅トークン（数値＋単位 or thin/medium/thick）、色としての var(--riddle-border) を全て要求する。
  const widthRe = /(?:\b\d*\.?\d+(?:px|rem|em|pt)\b|\b(?:thin|medium|thick)\b)/i;
  const styleRe = /\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)\b/i;
  const colorVarRe = /var\(\s*--riddle-border\b[^)]*\)/i;

  const wellFormed = borderShorthandDecls.filter(
    (value) =>
      widthRe.test(value) && styleRe.test(value) && colorVarRe.test(value),
  );

  assert.ok(
    wellFormed.length > 0,
    `.riddle-popover の境界が border: <幅> <スタイル> var(--riddle-border) のショートハンド形になっていない（border 値: ${JSON.stringify(borderShorthandDecls)}）`,
  );
});

// 項目 t6（既存維持の回帰・境界観点）: 是正1（外観 var() の追記）を行っても、
//   .riddle-popover の « 単一の » ベース規則に既存の構造的プロパティが残存していること。
//   外観プロパティを追記する過程でベース規則を分割・上書き・削除して既存挙動を壊す回帰を
//   捕捉する。テーブル駆動で「プロパティ × 期待する値の形」を検証する:
//     - position: fixed（ビューポート基準配置）
//     - z-index: 整数（重なり順を実際に制御。auto 退行は不可）
//     - max-height: var(--riddle-max-height …) 参照（ハードコード退行は不可）
//     - max-width:  var(--riddle-max-width …) 参照（ハードコード退行は不可）
//     - overflow-y: auto/scroll/overlay 系（はみ出しスクロール）
//   さらに、これら4観点が « 同一の » ベース規則ブロックに同居していること
//   （複数の .riddle-popover 規則に散逸していないこと）を確認し、規則分割による退行を弾く。
const SURVIVING_BASE_DECLS = [
  {
    label: "position: fixed",
    property: "position",
    valueRe: /^fixed$/i,
  },
  {
    label: "z-index 整数値",
    property: "z-index",
    valueRe: /^-?\d+$/,
  },
  {
    label: "max-height の var(--riddle-max-height) 参照",
    property: "max-height",
    valueRe: /var\(\s*--riddle-max-height\b[^)]*\)/i,
  },
  {
    label: "max-width の var(--riddle-max-width) 参照",
    property: "max-width",
    valueRe: /var\(\s*--riddle-max-width\b[^)]*\)/i,
  },
  {
    label: "overflow-y の auto/scroll 系",
    property: "overflow-y",
    valueRe: /^(auto|scroll|overlay)$/i,
  },
];

for (const { label, property, valueRe } of SURVIVING_BASE_DECLS) {
  test(`riddle.css: 外観 var() 追記後も .riddle-popover の同一ベース規則に ${label} が残存している`, () => {
    // Arrange: .riddle-popover のベース規則（[hidden] を含まない）ブロックを抽出する。
    //   外観プロパティの追記はこのベース規則に対して行われる想定であり、
    //   既存の構造的プロパティはここに残っていなければならない。
    const baseRuleBlocks = extractBaseRuleBlocks(css);

    // Assert: ベース規則が « ちょうど1つ » であること（規則分割で挙動を散逸させていない）。
    //   外観追記の過程で .riddle-popover を複数規則に割ると、カスケード次第で
    //   既存挙動が崩れうるため、単一ベース規則であることを境界として固定する。
    assert.equal(
      baseRuleBlocks.length,
      1,
      `.riddle-popover のベース規則（[hidden] を含まない）はちょうど1つであるべき（検出数: ${baseRuleBlocks.length}）`,
    );

    // Act: その単一ベース規則から対象プロパティの宣言値を取り出す
    //   （color が border-color/background-color に部分一致しないのと同様、
    //    max-width が max-height 等に混じらないようプロパティ名直前に区切りを要求）。
    const [baseBlock] = baseRuleBlocks;
    const declRe = new RegExp(
      `(?:^|[;{\\s])${property}\\s*:\\s*([^;}]*)`,
      "gi",
    );
    const values = [...baseBlock.matchAll(declRe)].map((m) => m[1].trim());

    // Assert: 当該プロパティの宣言が同一ベース規則内に存在すること（削除退行を捕捉）。
    assert.ok(
      values.length > 0,
      `.riddle-popover の単一ベース規則に ${property} 宣言が見つからない（外観追記で消えていないか確認）`,
    );

    // Assert: その値が期待する形（fixed / 整数 / var() 参照 / auto系）であること
    //   （値のハードコード退行・auto 退行などを捕捉）。
    assert.ok(
      values.some((value) => valueRe.test(value)),
      `.riddle-popover の ${property} が期待する形（${label}）になっていない（値: ${JSON.stringify(values)}）`,
    );
  });
}

// 項目 t7（既存維持の回帰・境界観点）: 是正1（外観 var() の追記）を行っても、
//   hidden トグルによる表示制御の契約が保たれていることを « 1 テストで一体として »
//   確認する。契約は2つの不変条件の同居で成り立つ:
//     (A) .riddle-popover[hidden] { display: none } が存在する
//         （JS が hidden 属性を出し入れして非表示を実現する受け皿）。
//     (B) .riddle-popover のベース規則（[hidden] を含まない）が display を一切宣言しない
//         （ベースが無条件 display を持つと (A) の display:none を上書きし、hidden を
//          付けても消えなくなる）。
//   既存テストは (A)・(B) を別々に検証するが、外観 var() 追記の過程で
//   「ベースに display を足してしまう」「[hidden] 規則を巻き込んで壊す」といった回帰は
//   両者の « 同居 » が崩れて初めて顕在化する。ここでは (A) と (B) を同一テストで束ね、
//   var() 適用後も hidden トグル契約が一体として保たれることを境界で固定する。
test("riddle.css: 外観 var() 追記後も hidden トグル契約（[hidden]{display:none} 存在 かつ ベース規則は display を宣言しない）が保たれている", () => {
  // Arrange: ベース規則（[hidden] を含まない .riddle-popover 規則）の宣言ブロックと、
  //   [hidden] を含むセレクタの規則の有無を、それぞれ CSS ソースから取り出す。
  const baseRuleBlocks = extractBaseRuleBlocks(css);
  const hiddenRuleHasDisplayNone =
    /\[hidden\][^{}]*\{[^}]*\bdisplay\s*:\s*none\b[^}]*\}/i.test(css);

  // Assert: ベース規則が存在すること（前提）。
  assert.ok(
    baseRuleBlocks.length > 0,
    ".riddle-popover の基本規則（[hidden] を含まない）が見つからない",
  );

  // Act: ベース規則のいずれかに bare な display 宣言があるか調べる。
  const baseDeclaresDisplay = baseRuleBlocks.some((block) =>
    /\bdisplay\s*:/i.test(block),
  );

  // Assert (A): [hidden] セレクタが display: none を指定していること。
  assert.ok(
    hiddenRuleHasDisplayNone,
    "[hidden] を含むセレクタで display: none を指定する規則が見つからない（hidden トグルの受け皿が壊れている）",
  );

  // Assert (B): ベース規則が display を宣言していないこと（(A) を上書きしない）。
  assert.ok(
    !baseDeclaresDisplay,
    ".riddle-popover のベース規則が display を宣言しており [hidden] の display:none を上書きしうる（var() 追記で display が混入していないか確認）",
  );
});

// 項目 t10: `npm run lint`（ESLint）が riddle.css を JS として解釈してエラーに
//   しないこと（CSS は lint 対象外であるべき）。lint スクリプトは
//   `eslint src/sphinx_riddle_whisper/static tests/js` でディレクトリを渡すため、
//   そこに含まれる riddle.css を ESLint が JS パーサで解釈すると fatal な
//   パースエラーになり lint が赤くなって Green/CI を止めてしまう。
//   ここでは `npm run lint` と同じ対象ディレクトリを ESLint Node API で lint し、
//   riddle.css に起因する fatal エラー（パース失敗）が発生しないことを assert する。
test("riddle.css: ESLint が静的ディレクトリの .css を JS として解釈し fatal エラーにしない", async () => {
  // Arrange: `npm run lint` と同じ対象（static ディレクトリ）を lint する。
  //   設定ファイル（eslint.config.mjs）を尊重して挙動を再現する。
  const eslint = new ESLint();
  const targetDir = fileURLToPath(
    new URL("../../src/sphinx_riddle_whisper/static", import.meta.url),
  );

  // Act: ディレクトリを渡して lint した結果から、riddle.css に対する結果を探す。
  const results = await eslint.lintFiles([targetDir]);
  const cssResults = results.filter((r) => r.filePath.endsWith("riddle.css"));

  // Act: riddle.css に紐づく fatal メッセージ（JS パース失敗）を収集する。
  const fatalMessages = cssResults.flatMap((r) =>
    r.messages.filter((m) => m.fatal),
  );

  // Assert: riddle.css に対する fatal なパースエラーが 1 件も無いこと。
  //   （ESLint が CSS を JS として解釈してしまうと fatal メッセージが出る。
  //    CSS が lint 対象外なら結果に現れないか、現れても fatal は 0 件になる。）
  assert.deepEqual(
    fatalMessages.map((m) => m.message),
    [],
    `ESLint が riddle.css を JS として解釈し fatal エラーを出した: ${JSON.stringify(
      fatalMessages.map((m) => m.message),
    )}`,
  );

  // Assert: riddle.css に対する error も 0 件（lint 対象外＝エラー源にならない）。
  const cssErrorCount = cssResults.reduce((sum, r) => sum + r.errorCount, 0);
  assert.equal(
    cssErrorCount,
    0,
    `ESLint が riddle.css に lint エラーを報告した（CSS は lint 対象外であるべき）: ${cssErrorCount} 件`,
  );
});

// 項目 t2（コントラスト修正の回帰捕捉・境界観点）: ポップオーバが配下コンテンツの
//   配色を « 所有 » するための包括リセット `.riddle-popover *`（::before/::after 含む）や
//   アクセント `.riddle-popover th` / `.riddle-popover pre` 等の複合/子孫セレクタ規則を
//   実際の riddle.css に追加した « 後 » でも、extractBaseRuleBlocks(css) が素のベース規則
//   `.riddle-popover { … }` を « ちょうど1つ » だけ返し、複合/子孫セレクタを base に
//   数えないことを、実 CSS（擬似 CSS ではなく本物の css 定数）に対して固定する。
//   既存の擬似 CSS テスト（先頭の t1 系）はヘルパ単体の挙動を保証するが、本テストは
//   « 実際に出荷される riddle.css » に複合セレクタが入った状態でベース規則が1つに
//   保たれていること（= t6 系の「ちょうど1つ」要求が偽の回帰を起こさないこと）を
//   境界で担保する。実 CSS に複合/子孫セレクタが入っていることも前提として確認する。
test("riddle.css: 包括リセット等の複合/子孫セレクタ追加後も実 CSS の素のベース規則 .riddle-popover { … } はちょうど1つに保たれる", () => {
  // Arrange: 前提として、実 riddle.css に « 複合/子孫セレクタ »（.riddle-popover に
  //   続けて空白以外のセレクタが連なる規則。例 `.riddle-popover *` / `.riddle-popover th`）
  //   が少なくとも1つ存在することを確認する。これが無ければ「base に数えない」検証が
  //   空振り（vacuous）になるため、前提として明示的に固定する。
  const compositeSelectorCount = [
    ...css.matchAll(/\.riddle-popover\b([^{}]*)\{[^}]*\}/gi),
  ].filter((m) => m[1].trim() !== "").length;
  assert.ok(
    compositeSelectorCount > 0,
    "実 riddle.css に .riddle-popover の複合/子孫セレクタ規則（例 .riddle-popover *）が見つからない（包括リセットが追加されていないか、検証が空振りになる）",
  );

  // Act: 実 CSS から素のベース規則ブロックを抽出する。
  const baseRuleBlocks = extractBaseRuleBlocks(css);

  // Assert: 実 CSS の素のベース規則は « ちょうど1つ »（複合/子孫セレクタを数えない）。
  assert.equal(
    baseRuleBlocks.length,
    1,
    `実 riddle.css の素のベース規則 .riddle-popover { … } がちょうど1つでない（検出数: ${baseRuleBlocks.length}、複合/子孫セレクタを base に数えていないか確認すること）`,
  );

  // Assert: 抽出された唯一の base 本体が素のベース規則であること
  //   （position: fixed と外観 var() を持ち、複合/子孫セレクタ由来の !important /
  //    transparent を含まない）。
  const [baseBlock] = baseRuleBlocks;
  assert.ok(
    /\bposition\s*:\s*fixed\b/i.test(baseBlock),
    `抽出された base 本体が素の .riddle-popover 規則でない（本体: ${JSON.stringify(baseBlock)}）`,
  );
  assert.ok(
    !/!important|\btransparent\b/i.test(baseBlock),
    `抽出された base 本体に複合/子孫セレクタ（包括リセット等）由来の宣言が混入している（本体: ${JSON.stringify(baseBlock)}）`,
  );
});

// Task 7 / 項目 t2（--riddle-backdrop の 2 スコープ定義・境界観点）:
//   ライトボックスの半透明暗転を制御する CSS カスタムプロパティ --riddle-backdrop が、
//   「トップレベル（@media dark の外）の :root」と「@media (prefers-color-scheme: dark) 内の :root」
//   の両方に非空値で定義されていること。spec の方針は『ライトを既定、ダークをメディアクエリで
//   上書き』であり、--riddle-backdrop もこの方針に従う（ライト既定が欠落するとライト環境で
//   var() が解決されず暗転が機能しない；ダーク上書きが欠落するとダーク環境の暗転濃度が
//   ライトと同じになる）。テーブル駆動で光/暗の 2 スコープを集約して検証する。
const BACKDROP_SCOPE_CASES = [
  {
    label: "トップレベル（@media dark の外）の :root",
    extractBlocks: (cssText) => extractTopLevelRootBlocks(cssText),
    missingMsg:
      "--riddle-backdrop のライト既定が @media dark の外のトップレベル :root に定義されていない",
  },
  {
    label: "@media (prefers-color-scheme: dark) 内の :root",
    extractBlocks: (cssText) => {
      // dark メディアクエリブロック本体（1 段ネスト分）を取り出し、その中の :root ブロックを抽出。
      const darkBlockMatch =
        /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/i.exec(
          cssText,
        );
      if (darkBlockMatch === null) return [];
      return [...darkBlockMatch[1].matchAll(/:root\b[^{}]*\{([^}]*)\}/gi)].map(
        (m) => m[1],
      );
    },
    missingMsg:
      "--riddle-backdrop のダーク上書きが @media (prefers-color-scheme: dark) 内の :root に定義されていない",
  },
];

for (const { label, extractBlocks, missingMsg } of BACKDROP_SCOPE_CASES) {
  test(`riddle.css: --riddle-backdrop が ${label} に非空値で定義されている`, () => {
    // Arrange / Act: 対象スコープの :root ブロック本体群を抽出する。
    const rootBlocks = extractBlocks(css);

    // Assert: 対象スコープの :root が存在すること（スコープ自体が無ければ Red）。
    assert.ok(
      rootBlocks.length > 0,
      `${label} が見つからない（--riddle-backdrop 定義のスコープが無い）`,
    );

    // Act: いずれかのブロックに --riddle-backdrop の非空値宣言があるか調べる。
    const defined = rootBlocks.some((block) =>
      /--riddle-backdrop\s*:\s*[^;}]+/.test(block),
    );

    // Assert: --riddle-backdrop が非空値で定義されていること（未定義なら Red）。
    assert.ok(defined, missingMsg);
  });
}

// Task 7（lightbox ベース規則・正常観点）: .riddle-lightbox のベース規則が存在し、
//   全画面オーバレイの骨格として position: fixed / inset: 0 / display: flex /
//   background: var(--riddle-backdrop) の4プロパティを持つこと。
//   - position: fixed: ビューポート全体を覆うための固定配置
//   - inset: 0: 上下左右すべて 0 でビューポート全体を充填
//   - display: flex: 内包コンテンツ（画像）を中央揃えするための flex コンテナ
//   - background: var(--riddle-backdrop): 半透明暗転のカスタムプロパティ参照
//   CSS ソーステキスト（正規表現）で検証し、computed style の実効きは spec #24 Playwright へ委譲する。
test("riddle.css: .riddle-lightbox のベース規則が position: fixed / inset: 0 / display: flex / background: var(--riddle-backdrop) を持つ（全画面オーバレイの骨格）", () => {
  // Arrange / Act: `.riddle-lightbox` のベース規則（追加修飾なし）の宣言ブロック本体を抽出する。
  //   セレクタ部がちょうど `.riddle-lightbox`（末尾スペースのみ）の規則を base とみなす。
  const lightboxBaseBlocks = [
    ...css.matchAll(/\.riddle-lightbox\b([^{}]*)\{([^}]*)\}/gi),
  ]
    .filter((m) => m[1].trim() === "")
    .map((m) => m[2]);

  // Assert: ベース規則が存在すること（未実装なら 0 件で Red）。
  assert.ok(
    lightboxBaseBlocks.length > 0,
    ".riddle-lightbox のベース規則が見つからない（未実装）",
  );

  const [baseBlock] = lightboxBaseBlocks;

  // Assert: position: fixed が指定されていること。
  assert.ok(
    /\bposition\s*:\s*fixed\b/i.test(baseBlock),
    `.riddle-lightbox のベース規則に position: fixed が指定されていない（本体: ${JSON.stringify(baseBlock.trim())}）`,
  );

  // Assert: inset: 0 が指定されていること。
  assert.ok(
    /\binset\s*:\s*0\b/i.test(baseBlock),
    `.riddle-lightbox のベース規則に inset: 0 が指定されていない（本体: ${JSON.stringify(baseBlock.trim())}）`,
  );

  // Assert: display: flex が指定されていること。
  assert.ok(
    /\bdisplay\s*:\s*flex\b/i.test(baseBlock),
    `.riddle-lightbox のベース規則に display: flex が指定されていない（本体: ${JSON.stringify(baseBlock.trim())}）`,
  );

  // Assert: background が var(--riddle-backdrop) を参照していること。
  const backgroundDecl = /\bbackground\s*:\s*([^;}]*)/i.exec(baseBlock);
  assert.ok(
    backgroundDecl !== null,
    ".riddle-lightbox のベース規則に background 宣言が見つからない",
  );
  assert.ok(
    /var\(\s*--riddle-backdrop\b[^)]*\)/i.test(backgroundDecl[1]),
    `.riddle-lightbox の background が var(--riddle-backdrop) を参照していない（値: ${JSON.stringify(backgroundDecl[1].trim())}）`,
  );
});

// Task 7 / 項目 t3（.riddle-lightbox img の画像クリップ・境界観点）:
//   ライトボックス内の画像（.riddle-lightbox img）が max-width: 90vw と max-height: 90vh を
//   持ち、ビューポートをはみ出さないこと。ユーザがどんな大きさの画像を埋め込んでも
//   ライトボックスの枠からはみ出さないよう、vw/vh 単位で上限を設ける。
//   CSS ソーステキスト（正規表現）で検証し、computed style の実効きは spec #24 Playwright へ委譲する。
test("riddle.css: .riddle-lightbox img が max-width: 90vw と max-height: 90vh を持ち画像がビューポートをはみ出さない", () => {
  // Arrange / Act: `.riddle-lightbox img` の宣言ブロック本体を抽出する。
  //   セレクタ部に `.riddle-lightbox` と `img` が含まれ（直後または子孫の img）、
  //   宣言ブロックを持つ規則を検索する。
  const imgRuleMatch = /\.riddle-lightbox\b[^{}]*img\b[^{}]*\{([^}]*)\}/i.exec(css);

  // Assert: .riddle-lightbox img の規則が存在すること（未実装なら null で Red）。
  assert.ok(
    imgRuleMatch !== null,
    ".riddle-lightbox img の規則が見つからない（未実装）",
  );

  const imgBlock = imgRuleMatch[1];

  // Act: max-width と max-height の宣言値を取り出す。
  const maxWidthDecl = /\bmax-width\s*:\s*([^;}]*)/i.exec(imgBlock);
  const maxHeightDecl = /\bmax-height\s*:\s*([^;}]*)/i.exec(imgBlock);

  // Assert: max-width: 90vw が指定されていること。
  assert.ok(
    maxWidthDecl !== null,
    ".riddle-lightbox img に max-width 宣言が見つからない",
  );
  assert.ok(
    /\b90vw\b/i.test(maxWidthDecl[1]),
    `.riddle-lightbox img の max-width が 90vw でない（値: ${JSON.stringify(maxWidthDecl[1].trim())}）`,
  );

  // Assert: max-height: 90vh が指定されていること。
  assert.ok(
    maxHeightDecl !== null,
    ".riddle-lightbox img に max-height 宣言が見つからない",
  );
  assert.ok(
    /\b90vh\b/i.test(maxHeightDecl[1]),
    `.riddle-lightbox img の max-height が 90vh でない（値: ${JSON.stringify(maxHeightDecl[1].trim())}）`,
  );
});

// Task 7 / 項目 t4（非表示・印刷除外の両経路・境界観点）: .riddle-lightbox[hidden] が
//   display: none を持つこと、かつ @media print 内で .riddle-lightbox の
//   display: none !important が指定されていること。
//   - [hidden] 経路: JS が hidden 属性を出し入れしてライトボックスを開閉する契約。
//     CSS は .riddle-lightbox[hidden] で display: none を当て、hidden 付与時に確実に
//     非表示にする受け皿を持たなければならない。
//   - @media print 経路: 印刷時はライトボックスのオーバレイを除外する。
//     ほかのスタイルに勝つため !important が必要。
//   テーブル駆動で 2 経路を集約して検証する（redundancy と symmetry を保証）。
const HIDDEN_AND_PRINT_CASES = [
  {
    label: ".riddle-lightbox[hidden] が display: none を持つ",
    test: (cssText) =>
      /\.riddle-lightbox\s*\[hidden\]\s*\{[^}]*\bdisplay\s*:\s*none\b[^}]*\}/i.test(
        cssText,
      ),
    failMsg:
      ".riddle-lightbox[hidden] セレクタに display: none が見つからない（hidden 属性でライトボックスが非表示にならない）",
  },
  {
    label: "@media print 内で .riddle-lightbox に display: none !important がある",
    test: (cssText) => {
      // @media print{...} ブロック本体（1 段ネスト分）を抽出し、その中に
      // .riddle-lightbox の display: none !important があるか確認する。
      const printBlockMatch =
        /@media\s+print\s*\{((?:[^{}]|\{[^{}]*\})*)\}/i.exec(cssText);
      if (printBlockMatch === null) return false;
      return /\.riddle-lightbox\b[^{}]*\{[^}]*\bdisplay\s*:\s*none\s*!important/i.test(
        printBlockMatch[1],
      );
    },
    failMsg:
      "@media print 内で .riddle-lightbox の display: none !important が見つからない（印刷時にライトボックスが除外されない）",
  },
  {
    // レビュー M-1 固定: popover は position: fixed ＋ 最高 z-index の通常スタイルの
    // まま印刷メディアにも当たるため、開いた状態（hidden が外れた状態）で印刷すると
    // 本文の上に重なって出力される。@media print で display: none !important を当て、
    // 開いている popover（ネスト popover も同じ class を持つ）を印刷から除外する。
    label: "@media print 内で .riddle-popover に display: none !important がある",
    test: (cssText) => {
      // @media print{...} ブロック本体（1 段ネスト分）を抽出し、その中に
      // .riddle-popover の display: none !important があるか確認する
      // （.riddle-lightbox とのセレクタリスト併記も許容する）。
      const printBlockMatch =
        /@media\s+print\s*\{((?:[^{}]|\{[^{}]*\})*)\}/i.exec(cssText);
      if (printBlockMatch === null) return false;
      return /\.riddle-popover\b[^{}]*\{[^}]*\bdisplay\s*:\s*none\s*!important/i.test(
        printBlockMatch[1],
      );
    },
    failMsg:
      "@media print 内で .riddle-popover の display: none !important が見つからない（開いた popover が印刷出力に残る）",
  },
];

for (const { label, test: checkFn, failMsg } of HIDDEN_AND_PRINT_CASES) {
  test(`riddle.css: ${label}`, () => {
    // Arrange / Act: CSS ソーステキストに対して検証関数を適用する。
    const result = checkFn(css);

    // Assert: 対象の規則が存在すること（未実装なら false で Red）。
    assert.ok(result, failMsg);
  });
}

// 項目 t5（境界観点）: .riddle-lightbox の z-index が整数 2147483646 であり、
//   既存 .riddle-popover の z-index（2147483647）よりちょうど 1 小さく
//   popover が上に重なる不変条件を満たすこと。
test(".riddle-lightbox の z-index が 2147483646 で .riddle-popover（2147483647）より 1 小さい", () => {
  // Arrange / Act: CSS ソーステキストから .riddle-lightbox と .riddle-popover の z-index 値を取得する。
  const lightboxZIndexMatch = css.match(
    /\.riddle-lightbox\s*\{[^}]*z-index\s*:\s*(\d+)/,
  );
  const popoverZIndexMatch = css.match(
    /\.riddle-popover\s*\{[^}]*z-index\s*:\s*(\d+)/,
  );

  // Assert: .riddle-lightbox に z-index 宣言が存在すること。
  assert.ok(
    lightboxZIndexMatch,
    ".riddle-lightbox ブロックに z-index 宣言が見つからない",
  );

  // Assert: .riddle-popover に z-index 宣言が存在すること。
  assert.ok(
    popoverZIndexMatch,
    ".riddle-popover ブロックに z-index 宣言が見つからない",
  );

  const lightboxZ = Number(lightboxZIndexMatch[1]);
  const popoverZ = Number(popoverZIndexMatch[1]);

  // Assert: .riddle-lightbox の z-index が整数 2147483646 であること。
  assert.strictEqual(lightboxZ, 2147483646, `.riddle-lightbox の z-index が 2147483646 でない（実際: ${lightboxZ}）`);

  // Assert: .riddle-popover の z-index（2147483647）より ちょうど 1 小さいこと。
  assert.strictEqual(
    popoverZ - lightboxZ,
    1,
    `.riddle-popover の z-index（${popoverZ}）と .riddle-lightbox の z-index（${lightboxZ}）の差がちょうど 1 でない`,
  );
});

// 項目 t7（CSS 隣接セキュリティ・異常観点）: コントラスト修正で追加した
//   `.riddle-popover` 配下の複合/子孫セレクタ規則（包括リセット `.riddle-popover *`、
//   アクセント `.riddle-popover th` / コード系 `.riddle-popover pre` 等）の宣言値は、
//   var()／transparent／キーワードのみで構成され、外部リソース取得や CSS インジェクション
//   隣接の危険構文を « 含まない » こと。具体的には url() / image-set()（外部フェッチ・
//   トラッキングや混在コンテンツの温床）、expression()・-moz-binding（レガシー CSS 実行）、
//   javascript: スキームを禁止する。ポップオーバは body 直下に append される共有ウィジェットで
//   注入定義を内包するため、配下スタイルが外部リソースを引かない（fail-closed）ことを境界で固定する。
test("riddle.css: コントラスト修正で追加した .riddle-popover 配下の規則が url()/image-set()/expression()/javascript: 等の外部取得・注入構文を含まない", () => {
  // Arrange: 実 riddle.css から « 複合/子孫セレクタ »（`.riddle-popover` に続けて空白以外の
  //   セレクタが連なる規則。包括リセット・アクセント背景が該当）の宣言ブロック本体を集める。
  const compositeRuleBodies = [
    ...css.matchAll(/\.riddle-popover\b([^{}]*)\{([^}]*)\}/gi),
  ]
    .filter((m) => m[1].trim() !== "")
    .map((m) => m[2]);

  // Assert: 対象規則が少なくとも1つ存在すること（無ければ検証が空振り＝vacuous）。
  assert.ok(
    compositeRuleBodies.length > 0,
    "コントラスト修正の複合/子孫セレクタ規則（例 .riddle-popover *）が見つからない（検証が空振りになる）",
  );

  // Act: 外部取得・注入隣接の危険構文を検出するパターン。
  //   url(...) / image-set(...) = 外部リソース取得、expression(...) / -moz-binding = レガシー実行、
  //   javascript: = 危険スキーム。
  const DANGEROUS_VALUE_RE =
    /\burl\s*\(|\bimage-set\s*\(|\bexpression\s*\(|-moz-binding|javascript\s*:/i;

  // Assert: いずれの規則本体にも危険構文が含まれないこと（fail-closed）。
  const offending = compositeRuleBodies.filter((body) =>
    DANGEROUS_VALUE_RE.test(body),
  );
  assert.deepEqual(
    offending,
    [],
    `.riddle-popover 配下の規則に外部取得・注入隣接の危険構文（url()/image-set()/expression()/-moz-binding/javascript:）が含まれている（該当本体: ${JSON.stringify(offending)}）`,
  );
});

// 項目 t7（M-4 閉じるボタン CSS・正常観点）: .riddle-lightbox__close の表示規則が
//   riddle.css に存在し、右上配置・backdrop に対するコントラスト・最小タップサイズ
//   の3要件を満たすこと。
//   - 右上配置: position: absolute かつ top / right の宣言（ライトボックス内の右上隅に固定）
//   - backdrop コントラスト: color または background(-color) が var() で色を参照する
//     （背景の暗転 backdrop に対して視認可能なコントラストを持つこと。
//      computed contrast は #24 Playwright へ委譲し、ここでは var() 参照の存在を確認する）
//   - 最小タップサイズ: min-width または min-height または width または height が
//     44px 以上（WCAG 2.5.5 の 44×44px 推奨、あるいは padding で確保）の宣言が
//     存在するか、padding が宣言されていること（ボタン周囲の余白でタップ領域を確保）
//   CSS ソーステキスト（正規表現）で検証し、computed style の実効きは spec #24 Playwright へ委譲する。
test("riddle.css: .riddle-lightbox__close の規則が右上配置・backdrop コントラスト・最小タップサイズを持つ", () => {
  // Arrange / Act: `.riddle-lightbox__close` の宣言ブロック本体を CSS ソースから抽出する。
  //   セレクタ部に `.riddle-lightbox__close` を含む規則（修飾なし＝ベース規則、または
  //   ライトボックス内の子孫規則として記述されている場合も許容）を全て収集する。
  const closeRuleMatches = [
    ...css.matchAll(/([^{}]*\.riddle-lightbox__close\b[^{}]*)\{([^}]*)\}/gi),
  ];

  // Assert: .riddle-lightbox__close の規則が存在すること（未実装なら 0 件で Red）。
  assert.ok(
    closeRuleMatches.length > 0,
    ".riddle-lightbox__close の CSS 規則が見つからない（未実装）",
  );

  // 全ての宣言ブロックを結合して検証（複数規則に分割して書かれている場合も許容）。
  const combinedBlock = closeRuleMatches.map((m) => m[2]).join("\n");

  // Assert: position: absolute が指定されていること（右上配置の前提）。
  assert.ok(
    /\bposition\s*:\s*absolute\b/i.test(combinedBlock),
    `.riddle-lightbox__close に position: absolute が指定されていない（右上配置に必要）（宣言ブロック: ${JSON.stringify(combinedBlock.trim())}）`,
  );

  // Assert: top が宣言されていること（上端からの配置）。
  assert.ok(
    /\btop\s*:/i.test(combinedBlock),
    `.riddle-lightbox__close に top の宣言が見つからない（右上配置の top 位置指定が必要）`,
  );

  // Assert: right が宣言されていること（右端からの配置）。
  assert.ok(
    /\bright\s*:/i.test(combinedBlock),
    `.riddle-lightbox__close に right の宣言が見つからない（右上配置の right 位置指定が必要）`,
  );

  // Assert: backdrop に対するコントラストを確保する色/背景宣言が存在すること。
  //   暗転した backdrop 上で視認できるよう、color か background(-color) が
  //   var() による色参照または明示的な色キーワード（white/rgba 等）を持つこと。
  const hasContrastDecl =
    /\bcolor\s*:\s*(?:var\([^)]*\)|white|#[0-9a-f]+|rgba?\s*\()/i.test(
      combinedBlock,
    ) ||
    /\bbackground(?:-color)?\s*:\s*(?:var\([^)]*\)|white|transparent|rgba?\s*\(|#[0-9a-f]+)/i.test(
      combinedBlock,
    );
  assert.ok(
    hasContrastDecl,
    `.riddle-lightbox__close に backdrop に対するコントラスト色宣言（color または background）が見つからない（暗転背景上での視認性に必要）`,
  );

  // Assert: 最小タップサイズを確保する宣言が存在すること。
  //   WCAG 2.5.5 の 44×44px 推奨に対応するため、width/height（44px 以上）または
  //   padding の宣言のいずれかがあること（padding で余白を確保してタップ領域を広げる方式も可）。
  const hasTapSizeDecl =
    /\b(?:min-width|min-height|width|height)\s*:\s*[^;}]*/i.test(
      combinedBlock,
    ) || /\bpadding\b\s*:/i.test(combinedBlock);
  assert.ok(
    hasTapSizeDecl,
    `.riddle-lightbox__close に最小タップサイズを確保する宣言（width/height/padding）が見つからない（WCAG 2.5.5 の 44×44px タップ領域に必要）`,
  );
});

// 項目 t1（ポップアップ内画像のアスペクト比維持・正常観点）: ポップアップ内の img に
//   対する規則が無いと、サニタイザを通過した width/height 属性とホストテーマの
//   `img { max-width: 100% }` の組み合わせで「幅だけ縮み高さが固定のまま」となり
//   アスペクト比が歪む。そこで `.riddle-popover img` が max-width: 100% と
//   height: auto をいずれも !important で宣言し、幅はポップアップに収めつつ
//   高さ指定を無効化して元の比率を常に維持する（!important はテーマの高特定度
//   img 規則に勝つため必須。既存のコントラスト規則と同じ設計契約）。
//   computed style の実効きは spec #24 Playwright へ委譲し、ここでは CSS ソースの
//   セレクタ・プロパティ・!important の存在を静的に検証する。
test("riddle.css: 画像規則 .riddle-popover img が max-width: 100% と height: auto をいずれも !important で指定している", () => {
  // Arrange / Act: セレクタ部に `.riddle-popover img`（子孫の画像）を含む規則の
  //   宣言ブロック本体を CSS ソースから抽出する。
  const imgRuleMatch = /\.riddle-popover\s+img\b[^{}]*\{([^}]*)\}/i.exec(css);

  // Assert: 画像規則 `.riddle-popover img` が存在すること（未追加なら null で Red）。
  assert.ok(
    imgRuleMatch !== null,
    "画像規則 .riddle-popover img（子孫の画像）が見つからない",
  );

  const imgBlock = imgRuleMatch[1];

  // Act: max-width 宣言の値部分を取り出す。
  const maxWidthDecl = /\bmax-width\s*:\s*([^;}]*)/i.exec(imgBlock);

  // Assert: max-width が 100% を !important で指定していること。
  assert.ok(
    maxWidthDecl !== null,
    ".riddle-popover img に max-width 宣言が見つからない",
  );
  assert.ok(
    /\b100%/.test(maxWidthDecl[1]),
    `.riddle-popover img の max-width が 100% でない（値: ${JSON.stringify(maxWidthDecl[1].trim())}）`,
  );
  assert.ok(
    /!important/i.test(maxWidthDecl[1]),
    `.riddle-popover img の max-width に !important が付いていない（値: ${JSON.stringify(maxWidthDecl[1].trim())}）`,
  );

  // Act: height 宣言の値部分を取り出す（max-height への部分一致を避けるため、
  //   プロパティ名直前に区切り（行頭/空白/`;`/`{`）を要求する）。
  const heightDecl = /(?:^|[;{\s])height\s*:\s*([^;}]*)/i.exec(imgBlock);

  // Assert: height が auto を !important で指定していること
  //   （width/height 属性由来の固定高さを無効化しアスペクト比を維持する核）。
  assert.ok(
    heightDecl !== null,
    ".riddle-popover img に height 宣言が見つからない",
  );
  assert.ok(
    /\bauto\b/i.test(heightDecl[1]),
    `.riddle-popover img の height が auto でない（値: ${JSON.stringify(heightDecl[1].trim())}）`,
  );
  assert.ok(
    /!important/i.test(heightDecl[1]),
    `.riddle-popover img の height に !important が付いていない（値: ${JSON.stringify(heightDecl[1].trim())}）`,
  );
});
