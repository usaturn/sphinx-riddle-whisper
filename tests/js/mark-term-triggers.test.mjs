// :term: トリガの視覚マーキング（markTermTriggers）の単体テスト。
// riddle.js から export される markTermTriggers / TERM_MARK_CLASS を検証する。
//
// 観点:
// - 「実際にポップする」= 定義 template が実在する :term: リンクだけをマークする
//   （ポップ開閉経路と同じ判定部品 deriveTermId / getRiddleTemplate の再利用契約）。
// - template 不在・非 term リンク・popover 配下・DOM clobbering ではマークしない
//   （fail-closed）。再実行してもクラスが重複しない（冪等）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  markTermTriggers,
  TERM_MARK_CLASS,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

/**
 * body HTML から document を組む。
 * @param {string} bodyHtml
 * @returns {Document}
 */
function docFromBody(bodyHtml) {
  return new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`).window.document;
}

// DOM 契約どおりの定義 template（term-0 用）。
const TEMPLATE_TERM_0 =
  '<template id="riddle-tip--term-0"><p>定義</p></template>';

test("markTermTriggers: template が実在する term リンクに riddle-term を付与し 1 を返す", () => {
  // Arrange: term リンクと対応する template を持つ document を組む
  const doc = docFromBody(
    `<a id="t" href="#term-0">用語</a>${TEMPLATE_TERM_0}`,
  );

  // Act
  const marked = markTermTriggers(doc);

  // Assert: アンカーへ TERM_MARK_CLASS が付与され、マーク数 1 が返る
  assert.equal(marked, 1);
  assert.ok(doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: クロスページ形 href（../index.html#term-0）でもマークする", () => {
  // Arrange: クロスページ参照形の href と対応 template
  const doc = docFromBody(
    `<a id="t" href="../index.html#term-0">用語</a>${TEMPLATE_TERM_0}`,
  );

  // Act
  const marked = markTermTriggers(doc);

  // Assert
  assert.equal(marked, 1);
  assert.ok(doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: singlehtml の二重フラグメント形（#document-index#term-0）でもマークする", () => {
  // Arrange: singlehtml 特有の href 形（deriveTermId は最後のセグメントを termId とする）
  const doc = docFromBody(
    `<a id="t" href="#document-index#term-0">用語</a>${TEMPLATE_TERM_0}`,
  );

  // Act
  const marked = markTermTriggers(doc);

  // Assert
  assert.equal(marked, 1);
  assert.ok(doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: template が不在の term リンクはマークしない（fail-closed）", () => {
  // Arrange: term リンクはあるが対応 template が無い
  const doc = docFromBody('<a id="t" href="#term-0">用語</a>');

  // Act
  const marked = markTermTriggers(doc);

  // Assert: マークされずマーク数 0
  assert.equal(marked, 0);
  assert.ok(!doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: 同 id が template 以外（DOM clobbering）ならマークしない（fail-closed）", () => {
  // Arrange: contract の id を持つ div（clobbering 狙い）を置く
  const doc = docFromBody(
    '<a id="t" href="#term-0">用語</a>' +
      '<div id="riddle-tip--term-0"><p>偽装</p></div>',
  );

  // Act
  const marked = markTermTriggers(doc);

  // Assert
  assert.equal(marked, 0);
  assert.ok(!doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: '#term-' を含まない通常リンクはマークしない", () => {
  // Arrange: 通常の内部/外部リンクのみ（template はあっても対象外）
  const doc = docFromBody(
    '<a id="t1" href="other.html">通常</a>' +
      '<a id="t2" href="#section-1">節</a>' +
      TEMPLATE_TERM_0,
  );

  // Act
  const marked = markTermTriggers(doc);

  // Assert
  assert.equal(marked, 0);
  assert.ok(!doc.getElementById("t1").classList.contains(TERM_MARK_CLASS));
  assert.ok(!doc.getElementById("t2").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: popover 配下の term リンクはマークしない（再帰防止の既存方針と同じ）", () => {
  // Arrange: 共有ポップ .riddle-popover の中に term リンクを置く
  const doc = docFromBody(
    '<div class="riddle-popover"><a id="t" href="#term-0">用語</a></div>' +
      TEMPLATE_TERM_0,
  );

  // Act
  const marked = markTermTriggers(doc);

  // Assert
  assert.equal(marked, 0);
  assert.ok(!doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("markTermTriggers: 2 回呼んでもクラスが重複しない（冪等）", () => {
  // Arrange
  const doc = docFromBody(
    `<a id="t" href="#term-0">用語</a>${TEMPLATE_TERM_0}`,
  );

  // Act: 2 回実行する
  markTermTriggers(doc);
  markTermTriggers(doc);

  // Assert: className に TERM_MARK_CLASS がちょうど 1 回だけ現れる
  const occurrences = doc
    .getElementById("t")
    .className.split(/\s+/)
    .filter((cls) => cls === TERM_MARK_CLASS).length;
  assert.equal(occurrences, 1);
});
