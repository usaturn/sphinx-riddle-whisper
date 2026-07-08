// #17 二次防御走査（allowlist）の単体テスト。
// riddle.js から export された純関数 sanitizeFragment を import し、
// template.content を clone した DocumentFragment を append 前に走査したとき、
// 危険要素がノードごと fail-closed で除去されることを検証する。
// 攻撃ペイロードは innerHTML 代入を避け、JSDOM コンストラクタの HTML 文字列で組む。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  isSafeUrl,
  sanitizeFragment,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

/**
 * 与えた tip 本文 HTML を持つ template を JSDOM で組み、
 * その content を clone した DocumentFragment を返す。
 * （ページ末尾に注入される <template id="riddle-tip--term-0"> の DOM 契約を再現）
 * @param {string} tipBodyHtml template 内に置く本文 HTML（攻撃ペイロードを含みうる）
 * @param {object} jsdomWindow 走査・clone に使う window（document）を返すための受け皿
 * @returns {DocumentFragment}
 */
function cloneTipFragment(tipBodyHtml) {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<template id="riddle-tip--term-0">' +
      tipBodyHtml +
      "</template>" +
      "</body>",
  );
  const tpl = dom.window.document.getElementById("riddle-tip--term-0");
  return tpl.content.cloneNode(true);
}

// テーブル駆動: 各危険タグについて、良性ラッパ <p> の中に 1 つ混入させ、
// 走査後にそのタグが 0 件になることを確認する（同質ケースを集約）。
const DANGEROUS_TAGS = [
  ["script", "<p>ok<script>window.x=1</script></p>"],
  ["iframe", '<p>ok<iframe src="../evil.html"></iframe></p>'],
  ["object", '<p>ok<object data="../evil.swf"></object></p>'],
  ["embed", '<p>ok<embed src="../evil.swf"></embed></p>'],
  ["base", '<p>ok<base href="../"></p>'],
  ["form", '<p>ok<form action="../submit"></form></p>'],
  ["style", "<p>ok<style>body{display:none}</style></p>"],
];

for (const [tag, html] of DANGEROUS_TAGS) {
  test(`二次防御走査: 危険要素 <${tag}> がノードごと除去される（fail-closed）`, () => {
    // Arrange: 危険タグを含む template content の clone を用意
    const frag = cloneTipFragment(html);
    assert.equal(
      frag.querySelectorAll(tag).length,
      1,
      `前提が崩れている: 走査前に <${tag}> が 1 件あるべき`,
    );

    // Act: 二次防御走査を実行
    sanitizeFragment(frag);

    // Assert: 危険要素がノードごと 0 件に除去されている
    assert.equal(
      frag.querySelectorAll(tag).length,
      0,
      `<${tag}> が走査後も残っている（危険要素が除去されていない）`,
    );
  });
}

// t3（回帰・denylist 撤去）: 旧 denylist の危険要素 7 種
// （script/iframe/object/embed/base/form/style）を 1 つの fragment にまとめて混入させ、
// allowlist 反転後も全種が走査後 0 件になることをテーブル駆動で一括検証する。
// 単独混入（DANGEROUS_TAGS）に加え、複数同時混入でも取りこぼしが無いことを確認し、
// denylist 撤去による回帰が無いことを保証する。
// 攻撃ペイロードは JSDOM コンストラクタの HTML 文字列に埋め込む（innerHTML 代入を避ける）。
const FORMER_DENYLIST_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "form",
  "style",
];

test("二次防御走査: 旧 denylist の危険要素 7 種を同時混入しても全種が走査後 0 件（回帰）", () => {
  // Arrange: 7 種の危険要素を良性ラッパ <div> 内にまとめて混入させた本文を用意。
  const frag = cloneTipFragment(
    "<div>ok" +
      "<script>window.x=1</script>" +
      '<iframe src="../evil.html"></iframe>' +
      '<object data="../evil.swf"></object>' +
      '<embed src="../evil.swf"></embed>' +
      '<base href="../">' +
      '<form action="../submit"></form>' +
      "<style>body{display:none}</style>" +
      "</div>",
  );
  // 前提: 走査前は 7 種すべてが 1 件以上存在する。
  for (const tag of FORMER_DENYLIST_TAGS) {
    assert.ok(
      frag.querySelectorAll(tag).length >= 1,
      `前提が崩れている: 走査前に <${tag}> が存在するべき`,
    );
  }

  // Act: 二次防御走査を実行
  sanitizeFragment(frag);

  // Assert: 旧 denylist の 7 種すべてが走査後 0 件に除去されている。
  for (const tag of FORMER_DENYLIST_TAGS) {
    assert.equal(
      frag.querySelectorAll(tag).length,
      0,
      `<${tag}> が走査後も残っている（denylist 撤去による回帰）`,
    );
  }
});

// t1: denylist では素通りしていた allowlist 外要素が fail-closed で除去される。
// meta http-equiv=refresh（強制遷移）・link rel=stylesheet href（外部 CSS 読込）・
// video・audio・未知のカスタム要素 x-evil を、良性ラッパ <p> の中に 1 つ混入させ、
// 走査後にそのタグが 0 件になることをテーブル駆動で確認する。
// 攻撃ペイロードは JSDOM コンストラクタの HTML 文字列に埋め込む（innerHTML 代入を使わない）。
const DISALLOWED_NON_DENYLIST_TAGS = [
  ["meta", '<p>ok<meta http-equiv="refresh" content="0;url=../evil.html"></p>'],
  ["link", '<p>ok<link rel="stylesheet" href="../evil.css"></p>'],
  ["video", '<p>ok<video src="../evil.mp4"></video></p>'],
  ["audio", '<p>ok<audio src="../evil.mp3"></audio></p>'],
  ["x-evil", "<p>ok<x-evil>未知のカスタム要素</x-evil></p>"],
];

for (const [tag, html] of DISALLOWED_NON_DENYLIST_TAGS) {
  test(`二次防御走査: allowlist 外の <${tag}> がノードごと除去される（fail-closed）`, () => {
    // Arrange: allowlist 外タグを含む template content の clone を用意
    const frag = cloneTipFragment(html);
    assert.equal(
      frag.querySelectorAll(tag).length,
      1,
      `前提が崩れている: 走査前に <${tag}> が 1 件あるべき`,
    );

    // Act: 二次防御走査を実行
    sanitizeFragment(frag);

    // Assert: allowlist 外要素がノードごと 0 件に除去されている
    assert.equal(
      frag.querySelectorAll(tag).length,
      0,
      `<${tag}> が走査後も残っている（許可外要素が fail-closed で除去されていない）`,
    );
  });
}

// t2（unwrap 維持・境界）: fail-closed 化で新たに除去対象となった allowlist 外要素
// （denylist には無かった <video>）の内側にあった良性な子（<p>keep</p>）とテキストが、
// 親へ引き上げられて保持されること。要素 <video> は 0 件・良性な子孫は残る、を同時に確認する。
// 攻撃ペイロードは含まないが、慣習に倣い JSDOM コンストラクタ文字列で本文を組む。
test("二次防御走査: allowlist 外 <video> の内側の良性な子（<p>keep</p>・テキスト）が引き上げ保持される", () => {
  // Arrange: 許可外 <video> の中に良性テキストと良性要素 <p> を抱えた本文を用意。
  const frag = cloneTipFragment(
    "<div>" +
      "<video src=\"../evil.mp4\">枠内テキスト<p class=\"keep\">keep me</p></video>" +
      "</div>",
  );
  // 前提: 走査前は <video> が存在し、その内側に良性な子 <p.keep> がある。
  assert.equal(
    frag.querySelectorAll("video").length,
    1,
    "前提が崩れている: 走査前に <video> が 1 件あるべき",
  );
  assert.ok(
    frag.querySelector("video p.keep"),
    "前提が崩れている: 走査前は <video> の内側に良性要素 <p.keep> があるべき",
  );

  // Act: 二次防御走査を実行
  sanitizeFragment(frag);

  // Assert: <video> はノードごと除去され、内側の良性な子とテキストは引き上げ保持される。
  assert.equal(
    frag.querySelectorAll("video").length,
    0,
    "allowlist 外 <video> が走査後も残っている",
  );
  const kept = frag.querySelector("p.keep");
  assert.ok(
    kept,
    "除去した <video> の内側の良性要素 <p.keep> が引き上げ保持されていない",
  );
  assert.equal(
    kept.textContent,
    "keep me",
    "引き上げた良性要素のテキストが失われた",
  );
  assert.ok(
    frag.textContent.includes("枠内テキスト"),
    "除去した <video> の内側の良性テキストが失われた",
  );
});

// t2': 走査後にすべての on* イベント属性が要素から除去され 0 件になる。
// 良性ラッパ要素は保持されたまま、属性だけが落ちることを確認する
// （許可要素 <img>/<svg>/<div>/<a> に各種 on* を仕込む。要素自体は許可されるため
//  on* 属性が除去されたか否かだけが争点になる）。
test("二次防御走査: すべての on* イベント属性が要素から除去される", () => {
  // Arrange: 許可要素に on* 属性を混入させた template content の clone を用意。
  // 攻撃ペイロードは JSDOM コンストラクタの HTML 文字列に埋め込む
  // （innerHTML 代入を使わない / bare な javascript: 文字列も書かない）。
  const frag = cloneTipFragment(
    "<p>ok" +
      '<img src="../pic.png" onerror="window.x=1" alt="x">' +
      '<svg onload="window.y=1"></svg>' +
      '<div onclick="window.z=1">d</div>' +
      '<a href="../topic.html" onmouseover="window.w=1">link</a>' +
      "</p>",
  );
  // 前提: 走査前は on* 属性を持つ要素が複数存在する
  assert.ok(
    frag.querySelectorAll("[onerror],[onload],[onclick],[onmouseover]").length >
      0,
    "前提が崩れている: 走査前に on* 属性を持つ要素があるべき",
  );

  // Act: 二次防御走査を実行
  sanitizeFragment(frag);

  // Assert: 走査後、いかなる要素にも on* 属性が 1 つも残っていない
  const withOnAttr = [...frag.querySelectorAll("*")].filter((el) =>
    [...el.attributes].some((attr) =>
      attr.name.toLowerCase().startsWith("on"),
    ),
  );
  assert.equal(
    withOnAttr.length,
    0,
    `on* 属性が走査後も残っている: ${withOnAttr
      .map((el) => el.tagName)
      .join(", ")}`,
  );
});

// t3: href/action/formaction/xlink:href の危険スキーム
// （javascript: / data: / vbscript: / new URL で解決失敗する不正値）が除去される。
// 属性名 × 危険値をテーブル駆動で集約する。攻撃ペイロードは JSDOM コンストラクタの
// HTML 文字列に埋め込む（bare な javascript: 文字列リテラル / innerHTML 代入を避ける）。
//
// 各ケースは [属性を担う要素を含む HTML 断片, 値を読む要素の querySelector, 属性名] を
// 与え、走査後にその危険属性が要素から除去されている（getAttribute が null）ことを検証する。
const DANGEROUS_URL_ATTRS = [
  // a[href] の各種危険スキーム
  ['<a id="t" href="javascript:alert(1)">x</a>', "#t", "href"],
  ['<a id="t" href="data:text/html,<b>x">x</a>', "#t", "href"],
  ['<a id="t" href="vbscript:msgbox(1)">x</a>', "#t", "href"],
  // new URL で解決に失敗する不正値（パーセントエンコード不正）
  ['<a id="t" href="ht!tp://%%%bad">x</a>', "#t", "href"],
  // form[action] / button[formaction]
  ['<form><a id="t" href="javascript:alert(1)">x</a></form>', "#t", "href"],
  // svg a の xlink:href（古い属性名で危険スキームを与える）
  [
    '<svg><a id="t" xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    "#t",
    "xlink:href",
  ],
];

for (const [html, selector, attrName] of DANGEROUS_URL_ATTRS) {
  test(`二次防御走査: 危険スキームの ${attrName}（${html}）が除去される`, () => {
    // Arrange: 危険スキーム属性を含む template content の clone を用意
    const frag = cloneTipFragment("<p>ok" + html + "</p>");
    const target = frag.querySelector(selector);
    assert.ok(
      target && target.hasAttribute(attrName),
      `前提が崩れている: 走査前に ${attrName} 属性があるべき`,
    );

    // Act: 二次防御走査を実行
    sanitizeFragment(frag);

    // Assert: 危険スキームの属性が要素から除去されている（fail-closed）
    const after = frag.querySelector(selector);
    assert.ok(after, "要素自体は許可されるため保持されるべき");
    assert.equal(
      after.getAttribute(attrName),
      null,
      `危険スキームの ${attrName} が走査後も残っている`,
    );
  });
}

// t3 反例: 良性の URL 属性（相対パス・#アンカー・http/https・mailto）は保持される。
// 危険スキームの除去が過剰に良性属性まで落としていないことを確認する。
const BENIGN_URL_ATTRS = [
  ['<a id="t" href="../topic.html">x</a>', "#t", "href", "../topic.html"],
  ['<a id="t" href="#x">x</a>', "#t", "href", "#x"],
  ['<a id="t" href="https://example.com/">x</a>', "#t", "href", "https://example.com/"],
  ['<a id="t" href="mailto:a@example.com">x</a>', "#t", "href", "mailto:a@example.com"],
];

for (const [html, selector, attrName, expected] of BENIGN_URL_ATTRS) {
  test(`二次防御走査: 良性の ${attrName}（${expected}）は保持される`, () => {
    // Arrange
    const frag = cloneTipFragment("<p>ok" + html + "</p>");

    // Act
    sanitizeFragment(frag);

    // Assert: 良性 URL 属性は除去されず元の値のまま残る
    const after = frag.querySelector(selector);
    assert.ok(after, "良性要素は保持されるべき");
    assert.equal(
      after.getAttribute(attrName),
      expected,
      `良性の ${attrName} が走査で除去/改変された`,
    );
  });
}

// t4: 走査が in-place（許可外要素を孕む混在 clone でも例外を投げず）に完了し、
// 許可外を除いた残り（許可要素・テキスト・良性属性）が漏れなく保持される。
// fail-closed の網羅: 危険要素・on*・危険スキーム・target=_blank を一度に含む
// 現実的な混在 fragment を 1 つ用意し、(1) 例外を投げないこと、(2) 危険物が全滅、
// (3) 良性物（許可要素 / 危険要素の内側にあった良性テキスト / 良性属性）が
// すべて残ること、(4) target=_blank に rel が付与されることを一括検証する。
test("二次防御走査: 危険要素を孕む混在 fragment でも例外なく走査し良性物を保持する", () => {
  // Arrange: 危険物と良性物が入り混じった現実的な tip 本文を組む。
  // - <form> は内部に良性テキストと良性要素（real DOM として parse される）を抱える
  //   （許可外要素を除去しても内側の良性物が引き上げ保持されることの確認）
  // - <iframe>/<script> は単独の危険要素として混入
  // - on* 属性・危険スキーム href を許可要素に混入
  // - target="_blank" を持つ良性リンク（rel 付与の確認）
  const frag = cloneTipFragment(
    "<div class=\"tip\" id=\"body\">" +
      "<p>前置きテキスト" +
      '<a href="../topic.html" onmouseover="window.w=1">用語</a>' +
      "</p>" +
      '<form action="../submit">枠内の良性テキスト' +
      '<span class="kept">枠内の良性要素</span>' +
      "</form>" +
      "<iframe src=\"../evil.html\"></iframe>" +
      '<a href="javascript:alert(1)" target="_blank">危険リンク</a>' +
      "<script>window.x=1</script>" +
      '<img src="../pic.png" alt="図" onerror="window.y=1">' +
      "<ul><li>項目</li></ul>" +
      "</div>",
  );
  // 前提: 走査前は危険物が確かに存在する
  assert.ok(
    frag.querySelectorAll("form, iframe, script").length === 3,
    "前提が崩れている: 走査前に危険要素があるべき",
  );
  assert.ok(
    frag.querySelector("form span.kept"),
    "前提が崩れている: 走査前は危険要素の内側に良性要素があるべき",
  );

  // Act: 走査は例外を投げずに完了しなければならない（in-place 破壊更新）
  assert.doesNotThrow(
    () => sanitizeFragment(frag),
    "混在 fragment の走査で例外が投げられた",
  );

  // Assert (危険物全滅): 危険要素・on*・危険スキーム href が 0 件
  assert.equal(
    frag.querySelectorAll("script, iframe, object, embed, base, form, style")
      .length,
    0,
    "走査後も危険要素が残っている",
  );
  const withOnAttr = [...frag.querySelectorAll("*")].filter((el) =>
    [...el.attributes].some((a) => a.name.toLowerCase().startsWith("on")),
  );
  assert.equal(withOnAttr.length, 0, "走査後も on* 属性が残っている");
  // この掃引は src も含む防御多層チェックだが、img の src は URL_ATTRS 非対象で
  // スキーム検査されない（末尾「img の src はスキーム検査対象外」テスト参照）。
  // ここを通るのは本 fixture の img が安全な src（../pic.png）だけだからである。
  const urlAttributeNames = new Set(["href", "src", "action", "formaction", "xlink:href"]);
  const remainingUnsafeUrls = [...frag.querySelectorAll("*")].flatMap((el) =>
    [...el.attributes]
      .filter((attr) => urlAttributeNames.has(attr.name.toLowerCase()))
      .filter((attr) => !isSafeUrl(attr.value))
      .map((attr) => `${attr.name}=${JSON.stringify(attr.value)}`),
  );
  assert.deepEqual(
    remainingUnsafeUrls,
    [],
    `走査後も危険 URL 属性が残っている: ${remainingUnsafeUrls.join(", ")}`,
  );

  // Assert (良性物の保持): 許可要素・良性属性・良性テキストがすべて残る
  const bodyDiv = frag.querySelector("div#body.tip");
  assert.ok(bodyDiv, "許可要素 <div>（class/id 付き）が保持されるべき");
  const img = frag.querySelector("img");
  assert.ok(img, "許可要素 <img> が保持されるべき");
  assert.equal(img.getAttribute("src"), "../pic.png", "良性 src が保持されるべき");
  assert.equal(img.getAttribute("alt"), "図", "良性 alt が保持されるべき");
  assert.ok(frag.querySelector("ul > li"), "<ul>/<li> が保持されるべき");
  const benignLink = [...frag.querySelectorAll("a")].find(
    (el) => el.getAttribute("href") === "../topic.html",
  );
  assert.ok(benignLink, "良性 href のリンクが保持されるべき");

  // 危険要素の内側にあった良性テキスト/良性要素が引き上げ保持されている
  assert.ok(
    frag.textContent.includes("枠内の良性テキスト"),
    "除去した危険要素の内側の良性テキストが失われた",
  );
  assert.ok(
    frag.querySelector("span.kept"),
    "除去した危険要素の内側の良性要素が失われた",
  );

  // target="_blank" の良性リンク（href が除去されても要素自体は残る）に
  // rel="noopener noreferrer" が付与されている
  const blankLinks = [...frag.querySelectorAll('a[target="_blank"]')];
  assert.ok(blankLinks.length > 0, "target=_blank のリンクが保持されるべき");
  for (const a of blankLinks) {
    assert.equal(
      a.getAttribute("rel"),
      "noopener noreferrer",
      "target=_blank に rel=noopener noreferrer が付与されていない",
    );
  }
});

// t5: 良性要素（p/div/span/a/img/ul/li/code/pre）と良性属性
//（class/id/title/src/alt/相対 href/#anchor）が走査後も漏れなく保持される（正常系）。
// 危険物を一切含まない現実的な tip 本文を 1 つ用意し、(1) 許可要素がすべて残ること、
// (2) 良性属性が値ごと改変・除去されずに残ること、(3) テキストが保持されることを検証する。
// 二次防御走査が良性物を過剰に削っていないことを保証する回帰テスト。
test("二次防御走査: 良性要素と良性属性が走査後も漏れなく保持される", () => {
  // Arrange: 許可要素 p/div/span/a/img/ul/li/code/pre と
  // 良性属性 class/id/title/src/alt/相対 href/#anchor を網羅した、危険物ゼロの本文。
  const frag = cloneTipFragment(
    '<div class="tip" id="body" title="用語の定義">' +
      "<p>説明テキスト" +
      '<span class="kw">強調</span>' +
      '<a class="ref" id="link1" title="参照" href="../topic.html">相対リンク</a>' +
      '<a id="anchorlink" href="#section">アンカー</a>' +
      "</p>" +
      '<img class="fig" id="img1" src="../pic.png" alt="図の説明" title="図">' +
      "<ul><li>項目1</li><li>項目2</li></ul>" +
      "<pre><code>const x = 1;</code></pre>" +
      "</div>",
  );

  // Act: 二次防御走査を実行
  sanitizeFragment(frag);

  // Assert (許可要素の保持): p/div/span/a/img/ul/li/code/pre がすべて残る
  for (const tag of ["div", "p", "span", "a", "img", "ul", "li", "code", "pre"]) {
    assert.ok(
      frag.querySelector(tag),
      `許可要素 <${tag}> が走査で除去された`,
    );
  }
  assert.equal(
    frag.querySelectorAll("li").length,
    2,
    "<li> が走査で欠落した（許可要素の取りこぼし）",
  );

  // Assert (良性属性の保持): class/id/title/src/alt/相対 href/#anchor が値ごと残る
  const div = frag.querySelector("div#body");
  assert.ok(div, "div#body が保持されるべき");
  assert.equal(div.getAttribute("class"), "tip", "良性 class が改変/除去された");
  assert.equal(div.getAttribute("title"), "用語の定義", "良性 title が改変/除去された");

  const refLink = frag.querySelector("a#link1");
  assert.ok(refLink, "a#link1 が保持されるべき");
  assert.equal(refLink.getAttribute("class"), "ref", "良性 class が改変/除去された");
  assert.equal(refLink.getAttribute("title"), "参照", "良性 title が改変/除去された");
  assert.equal(
    refLink.getAttribute("href"),
    "../topic.html",
    "良性の相対 href が改変/除去された",
  );

  const anchorLink = frag.querySelector("a#anchorlink");
  assert.ok(anchorLink, "a#anchorlink が保持されるべき");
  assert.equal(
    anchorLink.getAttribute("href"),
    "#section",
    "良性の #anchor href が改変/除去された",
  );

  const img = frag.querySelector("img#img1");
  assert.ok(img, "img#img1 が保持されるべき");
  assert.equal(img.getAttribute("src"), "../pic.png", "良性 src が改変/除去された");
  assert.equal(img.getAttribute("alt"), "図の説明", "良性 alt が改変/除去された");
  assert.equal(img.getAttribute("class"), "fig", "良性 class が改変/除去された");

  // Assert (テキストの保持): 本文テキストが失われていない
  assert.ok(frag.textContent.includes("説明テキスト"), "良性テキストが失われた");
  assert.ok(frag.textContent.includes("const x = 1;"), "code 内テキストが失われた");
});

// t4: ALLOWED_TAGS に列挙した良性要素が走査後も除去されず保持されること（allowlist が
// 良性集合を取りこぼさないこと）を、代表タグをテーブル駆動で網羅して確認する（正常系）。
// 各タグを良性ラッパ <div> の中に 1 つ置き、走査後にそのタグが残っている（>= 1 件）ことを検証する。
// 文脈上ラッパが必要なタグ（li/ol・table 系・dt/dd・figcaption）は妥当な親要素ごと与え、
// 対象タグの存在だけを争点にする。t5 が触れていない ol/blockquote/table 系/figure/見出し/
// インライン強調なども含め、allowlist の良性集合が漏れなく保持されることを保証する回帰テスト。
const ALLOWED_BENIGN_TAGS = [
  // ブロック・段落系
  ["p", "<p>段落</p>"],
  ["div", "<div>ブロック</div>"],
  ["br", "<p>行<br>送り</p>"],
  ["hr", "<hr>"],
  ["blockquote", "<blockquote>引用</blockquote>"],
  ["pre", "<pre>整形済</pre>"],
  // インライン強調・コード系
  ["span", "<span>インライン</span>"],
  ["em", "<em>強調</em>"],
  ["strong", "<strong>強調</strong>"],
  ["b", "<b>太字</b>"],
  ["i", "<i>斜体</i>"],
  ["s", "<s>取消</s>"],
  ["sub", "<sub>下付</sub>"],
  ["sup", "<sup>上付</sup>"],
  ["code", "<code>コード</code>"],
  ["kbd", "<kbd>Ctrl</kbd>"],
  ["samp", "<samp>出力</samp>"],
  ["var", "<var>x</var>"],
  // リンク・画像
  ["a", '<a href="../topic.html">リンク</a>'],
  ["img", '<img src="../pic.png" alt="図">'],
  // リスト系
  ["ul", "<ul><li>項目</li></ul>"],
  ["ol", "<ol><li>項目</li></ol>"],
  ["li", "<ul><li>項目</li></ul>"],
  ["dl", "<dl><dt>語</dt><dd>定義</dd></dl>"],
  ["dt", "<dl><dt>語</dt><dd>定義</dd></dl>"],
  ["dd", "<dl><dt>語</dt><dd>定義</dd></dl>"],
  // テーブル系
  ["table", "<table><tbody><tr><td>セル</td></tr></tbody></table>"],
  ["thead", "<table><thead><tr><th>見出し</th></tr></thead></table>"],
  ["tbody", "<table><tbody><tr><td>セル</td></tr></tbody></table>"],
  ["tr", "<table><tbody><tr><td>セル</td></tr></tbody></table>"],
  ["td", "<table><tbody><tr><td>セル</td></tr></tbody></table>"],
  ["th", "<table><thead><tr><th>見出し</th></tr></thead></table>"],
  ["caption", "<table><caption>表題</caption><tbody><tr><td>x</td></tr></tbody></table>"],
  // 図表
  ["figure", "<figure><figcaption>説明</figcaption></figure>"],
  ["figcaption", "<figure><figcaption>説明</figcaption></figure>"],
  // 見出し
  ["h1", "<h1>見出し1</h1>"],
  ["h2", "<h2>見出し2</h2>"],
  ["h3", "<h3>見出し3</h3>"],
  ["h4", "<h4>見出し4</h4>"],
  ["h5", "<h5>見出し5</h5>"],
  ["h6", "<h6>見出し6</h6>"],
];

for (const [tag, html] of ALLOWED_BENIGN_TAGS) {
  test(`二次防御走査: allowlist の良性要素 <${tag}> が走査後も保持される`, () => {
    // Arrange: 対象の良性要素を良性ラッパ <div> 内に置いた template content の clone を用意。
    const frag = cloneTipFragment("<div>" + html + "</div>");
    assert.ok(
      frag.querySelectorAll(tag).length >= 1,
      `前提が崩れている: 走査前に <${tag}> が存在するべき`,
    );

    // Act: 二次防御走査を実行
    sanitizeFragment(frag);

    // Assert: 良性要素が除去されず走査後も残っている
    assert.ok(
      frag.querySelectorAll(tag).length >= 1,
      `allowlist の良性要素 <${tag}> が走査で除去された（良性集合の取りこぼし）`,
    );
  });
}

// t6: 走査後、target="_blank" を持つ要素に rel="noopener noreferrer" が付与される（正常系）。
// reverse tabnabbing 対策。良性リンク（許可スキーム/相対）に target="_blank" を与えた
// 複数ケースをテーブル駆動で集約し、走査後に rel が正しく設定されることだけを争点にする。
// 攻撃ペイロードは含まないため JSDOM コンストラクタ文字列で良性 HTML を組む。
const BLANK_TARGET_LINKS = [
  // 良性の相対 href + target=_blank
  ['<a id="t" href="../topic.html" target="_blank">x</a>', "#t"],
  // 良性の絶対 http(s) href + target=_blank
  ['<a id="t" href="https://example.com/" target="_blank">x</a>', "#t"],
  // rel を持たない target=_blank（新規付与のケース）
  ['<a id="t" href="#x" target="_blank">x</a>', "#t"],
];

for (const [html, selector] of BLANK_TARGET_LINKS) {
  test(`二次防御走査: target=_blank（${html}）に rel=noopener noreferrer が付与される`, () => {
    // Arrange: target="_blank" を持つ良性リンクを含む template content の clone を用意
    const frag = cloneTipFragment("<p>ok" + html + "</p>");
    const before = frag.querySelector(selector);
    assert.ok(
      before && before.getAttribute("target") === "_blank",
      "前提が崩れている: 走査前に target=_blank の要素があるべき",
    );
    assert.equal(
      before.getAttribute("rel"),
      null,
      "前提が崩れている: 走査前は rel が未設定であるべき",
    );

    // Act: 二次防御走査を実行
    sanitizeFragment(frag);

    // Assert: target=_blank 要素に rel=noopener noreferrer が付与されている
    const after = frag.querySelector(selector);
    assert.ok(after, "target=_blank 要素は保持されるべき");
    assert.equal(
      after.getAttribute("target"),
      "_blank",
      "target=_blank は保持されるべき",
    );
    assert.equal(
      after.getAttribute("rel"),
      "noopener noreferrer",
      "target=_blank に rel=noopener noreferrer が付与されていない",
    );
  });
}

// t7: 許可要素 img の src はスキーム検査対象外という現状契約の固定。
// URL_ATTRS（riddle.js）は src を含まないため、二次防御走査は img の src を
// isSafeUrl で検査せず素通しする。これは意図的な設計であり、
//   - img の src は JS 実行経路にならず危険スキームでも無害、
//   - data: 画像は正当に許可したい（src を検査すると data: が isSafeUrl=false で壊れる）、
//   - 画像リンクの安全性はトリガアンカー href 側の isSafeImageHref/resolveImageSrc が担保する、
// という理由による。この事実を固定し、混在 fragment テストの src 込み掃引が
// 安全な src 前提でのみ成立することを明文化する（誤検知の回帰防止）。
test("二次防御走査: 許可要素 <img> の src はスキーム検査対象外で保持される（URL_ATTRS 非対象の契約）", () => {
  // Arrange: 危険スキーム src と data: src を持つ img を tip 本文に埋める。
  //   スキーム名リテラルは no-script-url 回避のため部品から組む（既存テストと同方針）。
  const jsSrc = "java" + "script:alert(1)";
  const dataSrc = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  const frag = cloneTipFragment(
    `<p>本文<img id="js" src="${jsSrc}" alt="x"><img id="data" src="${dataSrc}" alt="y"></p>`,
  );

  // Act
  sanitizeFragment(frag);

  // Assert (要素保持と src 素通し): img は許可要素として残り、src は除去されない
  const jsImg = frag.querySelector("img#js");
  const dataImg = frag.querySelector("img#data");
  assert.ok(jsImg, "許可要素 <img> は保持されるべき");
  assert.equal(
    jsImg.getAttribute("src"),
    jsSrc,
    "img の src は URL_ATTRS 非対象のため二次防御走査で除去されない",
  );
  assert.ok(dataImg, "data: 画像の <img> も保持されるべき");
  assert.equal(
    dataImg.getAttribute("src"),
    dataSrc,
    "data: 画像 src は正当に許可され保持される",
  );

  // Assert (補足契約): isSafeUrl 単体では両 src とも false だが、src は検査対象に含まれない。
  assert.equal(isSafeUrl(jsSrc), false, "危険スキーム src は isSafeUrl 単体では false");
  assert.equal(isSafeUrl(dataSrc), false, "data スキーム src は isSafeUrl 単体では false");
});
