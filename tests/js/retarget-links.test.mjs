// ポップオーバー挿入前の fragment 内リンクへ新タブ属性を付与する
// retargetFragmentLinks の単体テスト。riddle.js から export された関数を import し、
// a[href] への target/rel 付与・画像リンク除外・href 無し除外・冪等性を検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { retargetFragmentLinks } from "../../src/sphinx_riddle_whisper/static/riddle.js";

/**
 * 与えた tip 本文 HTML を持つ template を JSDOM で組み、
 * その content を clone した DocumentFragment を返す。
 * （ページ末尾に注入される <template id="riddle-tip--term-0"> の DOM 契約を再現）
 * @param {string} tipBodyHtml template 内に置く本文 HTML
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

// 正常系: a[href] へ target="_blank" と rel="noopener noreferrer" が同時付与される。
test("retarget: a[href] へ target=_blank と rel=noopener noreferrer が付与される", () => {
  // Arrange
  const frag = cloneTipFragment(
    '<p>定義 <a href="../other.html">内部リンク</a> と <a href="https://example.com/">外部リンク</a></p>',
  );

  // Act
  retargetFragmentLinks(frag);

  // Assert: すべての a[href] に両属性が付く
  for (const anchor of frag.querySelectorAll("a[href]")) {
    assert.equal(anchor.getAttribute("target"), "_blank");
    assert.equal(anchor.getAttribute("rel"), "noopener noreferrer");
  }
});

// 除外: img 子孫を持つアンカー（画像リンク＝ライトボックス対象）には付与しない。
test("retarget: img 子孫を持つアンカーには target を付与しない（画像除外）", () => {
  // Arrange
  const frag = cloneTipFragment(
    '<p><a class="image-reference" href="img.png"><img src="img.png" alt=""></a>' +
      ' <a href="page.html">通常リンク</a></p>',
  );

  // Act
  retargetFragmentLinks(frag);

  // Assert: 画像アンカーは無変更、通常リンクのみ付与
  const imageAnchor = frag.querySelector("a.image-reference");
  assert.equal(imageAnchor.hasAttribute("target"), false, "画像リンクへは付与しない");
  assert.equal(imageAnchor.hasAttribute("rel"), false, "画像リンクへは rel も付与しない");
  assert.equal(
    frag.querySelector('a[href="page.html"]').getAttribute("target"),
    "_blank",
  );
});

// 除外: href 無しアンカーには付与しない（a[href] のみ対象）。
test("retarget: href 無しアンカーには付与しない", () => {
  // Arrange
  const frag = cloneTipFragment("<p><a name=\"anchor\">href 無し</a></p>");

  // Act
  retargetFragmentLinks(frag);

  // Assert
  const anchor = frag.querySelector("a");
  assert.equal(anchor.hasAttribute("target"), false);
  assert.equal(anchor.hasAttribute("rel"), false);
});

// 冪等性: 2回適用しても結果が変わらない（属性値が壊れない）。
test("retarget: 2回適用しても target/rel は同じ値のまま（冪等）", () => {
  // Arrange
  const frag = cloneTipFragment('<p><a href="page.html">リンク</a></p>');

  // Act
  retargetFragmentLinks(retargetFragmentLinks(frag));

  // Assert
  const anchor = frag.querySelector("a");
  assert.equal(anchor.getAttribute("target"), "_blank");
  assert.equal(anchor.getAttribute("rel"), "noopener noreferrer");
});

// 戻り値: sanitizeFragment と同じ流儀で走査済みの frag 自身を返す。
test("retarget: 引数の frag 自身を返す", () => {
  // Arrange
  const frag = cloneTipFragment("<p>リンク無し</p>");

  // Act / Assert
  assert.equal(retargetFragmentLinks(frag), frag);
});

// rel マージ: 既存の rel トークンを保持したまま noopener / noreferrer を追加する。
test("retarget: 既存 rel は上書きせず noopener noreferrer をマージする", () => {
  // Arrange
  const frag = cloneTipFragment(
    '<p><a href="page.html" rel="nofollow">リンク</a></p>',
  );

  // Act
  retargetFragmentLinks(frag);

  // Assert
  assert.equal(
    frag.querySelector("a").getAttribute("rel"),
    "nofollow noopener noreferrer",
  );
});

// rel マージ冪等: 再適用しても rel トークンが重複しない。
test("retarget: rel マージは冪等（再適用で重複しない）", () => {
  // Arrange
  const frag = cloneTipFragment(
    '<p><a href="page.html" rel="nofollow">リンク</a></p>',
  );

  // Act
  retargetFragmentLinks(retargetFragmentLinks(frag));

  // Assert
  assert.equal(
    frag.querySelector("a").getAttribute("rel"),
    "nofollow noopener noreferrer",
  );
});
