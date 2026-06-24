// #17 template 取得と検証（getRiddleTemplate）の単体テスト。
// riddle.js から export された純関数 getRiddleTemplate を import し、
// `riddle-tip--{termId}` の id を getElementById で引いたとき、
// その要素が HTMLTemplateElement のときだけ要素を返し、
// 他要素（div 等・DOM clobbering）や不在のときは null を返す（fail-closed）ことを検証する。
//
// ページ末尾に注入される <template id="riddle-tip--term-0"> の DOM 契約を消費する。
// term-id は querySelector へ文字列補間せず getElementById のみで引く前提。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { getRiddleTemplate } from "../../src/sphinx_riddle_whisper/static/riddle.js";

/**
 * 与えた body HTML を持つ document を JSDOM で組んで返す。
 * @param {string} bodyHtml body 内に置く HTML
 * @returns {Document}
 */
function docWithBody(bodyHtml) {
  const dom = new JSDOM("<!DOCTYPE html><body>" + bodyHtml + "</body>");
  return dom.window.document;
}

// 正常系: id が HTMLTemplateElement なら、その template 要素を返す。
test("template 検証: id が HTMLTemplateElement のときその template を返す", () => {
  // Arrange: DOM 契約どおり <template id="riddle-tip--term-0"> を置く
  const doc = docWithBody(
    '<template id="riddle-tip--term-0"><p>定義</p></template>',
  );
  const expected = doc.getElementById("riddle-tip--term-0");

  // Act
  const result = getRiddleTemplate(doc, "term-0");

  // Assert: 取得した template 要素そのものを返す
  assert.equal(result, expected);
  assert.ok(
    result instanceof doc.defaultView.HTMLTemplateElement,
    "返り値は HTMLTemplateElement であるべき",
  );
});

// 異常系（DOM clobbering 耐性・fail-closed）: 同 id が template 以外の要素なら null。
// 攻撃者が <div id="riddle-tip--term-0"> 等を本文に紛れ込ませても、
// 無検査で content を読まないことを保証する。
const NON_TEMPLATE_ELEMENTS = [
  ["div", '<div id="riddle-tip--term-0"><p>偽装</p></div>'],
  ["span", '<span id="riddle-tip--term-0">偽装</span>'],
  ["form", '<form id="riddle-tip--term-0"></form>'],
  ["a", '<a id="riddle-tip--term-0" href="../x.html">偽装</a>'],
];

for (const [tag, html] of NON_TEMPLATE_ELEMENTS) {
  test(`template 検証: 同 id が <${tag}>（template 以外）なら null を返す（DOM clobbering 耐性）`, () => {
    // Arrange: template ではない要素を contract の id で配置する
    const doc = docWithBody(html);
    assert.ok(
      doc.getElementById("riddle-tip--term-0"),
      "前提が崩れている: その id の要素は存在するべき",
    );

    // Act
    const result = getRiddleTemplate(doc, "term-0");

    // Assert: template 以外は無視して null（fail-closed）
    assert.equal(result, null);
  });
}

// 境界系: 該当 id の要素が存在しなければ null を返す。
test("template 検証: 該当 id の要素が存在しないとき null を返す", () => {
  // Arrange: contract の id を持つ要素を一切置かない
  const doc = docWithBody("<p>無関係な本文</p>");

  // Act
  const result = getRiddleTemplate(doc, "term-0");

  // Assert
  assert.equal(result, null);
});
