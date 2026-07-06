// ネストポップ（レベル2）の開く経路の単体テスト。
// レベル1ポップ内の :term: トリガだけがレベル2を開き、レベル2内・脚注参照・
// nested=false では開かない（fail-closed）ことを検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installRiddlePopover } from "../../src/sphinx_riddle_whisper/static/riddle.js";

const LEVEL1_SELECTOR = ".riddle-popover:not(.riddle-popover--nested)";
const NESTED_SELECTOR = ".riddle-popover--nested";

/**
 * ネスト参照構造（A → B → C、A は自己参照と脚注参照も持つ）の document を組む。
 * @returns {Document}
 */
function docWithNestedTerms() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a href="#term-a">用語A</a>' +
      '<template id="riddle-tip--term-a">' +
      '<p>定義A <a href="#term-b">用語B</a> <a href="#term-a">自己参照A</a>' +
      ' <a class="footnote-reference" href="#fnbody">[1]</a></p>' +
      "</template>" +
      '<template id="riddle-tip--term-b"><p>定義B <a href="#term-c">用語C</a></p></template>' +
      '<template id="riddle-tip--term-c"><p>定義C</p></template>' +
      '<aside class="footnote" id="fnbody">' +
      '<span class="label"><a class="fn-backref" href="#">1</a></span><p>脚注本体</p>' +
      "</aside>" +
      "</body>",
  );
  return dom.window.document;
}

/** click イベントをバブリング付きで dispatch する。 */
function click(doc, el) {
  el.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

/** トップレベルの用語Aを click してレベル1ポップを開き、その要素を返す。 */
function openLevel1(doc) {
  click(doc, doc.querySelector('a[href="#term-a"]'));
  return doc.querySelector(LEVEL1_SELECTOR);
}

// 正常系: レベル1ポップ内の term click でレベル2が開き、両方同時に表示される。
test("ネスト: レベル1ポップ内の term click でレベル2ポップが開き両方表示される", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc);
  const level1 = openLevel1(doc);

  // Act: レベル1ポップ内の用語Bリンクを click
  click(doc, level1.querySelector('a[href="#term-b"]'));

  // Assert: レベル2が生成・表示され、レベル1も開いたまま
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.notEqual(nested, null, "レベル2ポップが生成されるべき");
  assert.equal(nested.hasAttribute("hidden"), false, "レベル2は表示状態であるべき");
  assert.equal(nested.textContent.includes("定義B"), true);
  assert.equal(level1.hasAttribute("hidden"), false, "レベル1は開いたままであるべき");
  assert.equal(level1.textContent.includes("定義A"), true);
});

// 固定2段: レベル2ポップ内の term click では何も開かない。
test("ネスト: レベル2ポップ内の term click では3段目が開かない", () => {
  // Arrange: レベル1 → レベル2（定義B）まで開く
  const doc = docWithNestedTerms();
  installRiddlePopover(doc);
  const level1 = openLevel1(doc);
  click(doc, level1.querySelector('a[href="#term-b"]'));
  const nested = doc.querySelector(NESTED_SELECTOR);

  // Act: レベル2ポップ内の用語Cリンクを click
  click(doc, nested.querySelector('a[href="#term-c"]'));

  // Assert: ポップは2つのまま・レベル2の内容は定義Bのまま
  assert.equal(doc.querySelectorAll(".riddle-popover").length, 2);
  assert.equal(nested.textContent.includes("定義C"), false);
  assert.equal(nested.textContent.includes("定義B"), true);
});

// ガード: レベル1ポップ内の脚注参照はトリガにならない。
test("ネスト: レベル1ポップ内の脚注参照ではレベル2が開かない", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc);
  const level1 = openLevel1(doc);

  // Act: ポップ内の脚注参照を click
  click(doc, level1.querySelector("a.footnote-reference"));

  // Assert: レベル2は表示されず、レベル1の内容も差し替わらない
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.equal(
    nested === null || nested.hasAttribute("hidden"),
    true,
    "脚注参照でレベル2が開いてはならない",
  );
  assert.equal(level1.textContent.includes("定義A"), true);
});

// 設定: nested=false ではポップ内 term が現行どおり無反応。
test("ネスト: nested=false ではレベル1ポップ内の term が無反応", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc, { nested: false });
  const level1 = openLevel1(doc);

  // Act
  click(doc, level1.querySelector('a[href="#term-b"]'));

  // Assert: レベル2は生成すらされない
  assert.equal(doc.querySelector(NESTED_SELECTOR), null);
});

// 同一 term 抑止: レベル1表示中の term と同じ termId ではレベル2を開かない。
test("ネスト: レベル1と同じ term へのリンクではレベル2が開かない", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc);
  const level1 = openLevel1(doc);

  // Act: 定義A内の自己参照（#term-a）を click
  click(doc, level1.querySelector('a[href="#term-a"]'));

  // Assert
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.equal(
    nested === null || nested.hasAttribute("hidden"),
    true,
    "同一 term の重複表示は抑止されるべき",
  );
});

// a11y: レベル2の id / role とポップ内トリガの aria-describedby。
test("ネスト: レベル2は id=riddle-popover-2 の tooltip でトリガに aria-describedby が付く", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc);
  const level1 = openLevel1(doc);
  const nestedTrigger = level1.querySelector('a[href="#term-b"]');

  // Act
  click(doc, nestedTrigger);

  // Assert
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.equal(nested.getAttribute("id"), "riddle-popover-2");
  assert.equal(nested.getAttribute("role"), "tooltip");
  assert.equal(nestedTrigger.getAttribute("aria-describedby"), "riddle-popover-2");
});
