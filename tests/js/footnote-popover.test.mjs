// 脚注/引用参照ポップアップの単体・結合テスト。
// deriveFragmentId / resolveFootnoteContent と、installRiddlePopover の
// 脚注ディスパッチ・無効化・共有・セキュリティを検証する。
// 攻撃ペイロードは innerHTML 代入を避け、JSDOM コンストラクタの HTML 文字列で組む
// （bare な javascript: 文字列リテラルも書かない＝no-script-url 回避）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  deriveFragmentId,
  resolveFootnoteContent,
  installRiddlePopover,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

/**
 * 脚注参照＋本体 aside を含む document を組む。
 * （docutils 0.22 HTML5 の DOM 契約を再現）
 * @param {string} bodyAsideHtml 末尾に置く本体 aside の HTML（攻撃ペイロードを含みうる）
 * @returns {Document}
 */
function docWithFootnote(bodyAsideHtml) {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<p>本文<a class="footnote-reference brackets" href="#id3" id="id1">[1]</a></p>' +
      bodyAsideHtml +
      "</body>",
  );
  return dom.window.document;
}

// t8（境界）: deriveFragmentId は href の `#` 以降（必要なら decodeURIComponent 済み）を返し、
// 異常入力（`#` 無し・空フラグメント・decodeURIComponent が例外を投げる不正エンコード）は
// いずれも null を返す。同質な異常入力はテーブル駆動で1項目にまとめて検証する。
test("deriveFragmentId: # 以降を返し、# 無し・空フラグメント・不正エンコードは null", () => {
  // Arrange: 入力 href と期待値の対応表（正常系＋同質な異常系）。
  const cases = [
    { href: "#id3", expected: "id3" }, // 単純なフラグメント
    { href: "../page.html#cite-x", expected: "cite-x" }, // 相対パス付き
    { href: "#term%20a", expected: "term a" }, // パーセントエンコードはデコードして返す
    { href: "no-hash", expected: null }, // # 無し
    { href: "#", expected: null }, // 空フラグメント
    { href: "#%E0%A4%A", expected: null }, // 不正な % エンコード → decodeURIComponent が例外
  ];

  // Act / Assert: 各入力について導出結果が期待値と一致すること。
  for (const { href, expected } of cases) {
    assert.equal(
      deriveFragmentId(href),
      expected,
      `deriveFragmentId(${JSON.stringify(href)}) は ${JSON.stringify(expected)} を返すべき`,
    );
  }
});

// t1（セキュリティ）: 敵対的本体（img onerror / a href=javascript: / 混在 script）を
// 解決後、危険要素・on* 属性・javascript: スキームが fragment に一切残らないこと。
// 既存 sanitizeFragment 再利用による二次防御が脚注経路でも効いていることを保証する。
test("resolveFootnoteContent: 敵対的本体は sanitize され危険要素・on*・javascript: が残らない", () => {
  // Arrange: 危険要素を孕む脚注本体 aside を JSDOM コンストラクタ文字列で組む。
  const doc = docWithFootnote(
    '<aside class="footnote" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">[1]</a></span>' +
      '<p>悪意<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a></p>' +
      "<script>alert(2)</script></aside>",
  );
  const trigger = doc.querySelector("a.footnote-reference");

  // Act: 脚注参照トリガから本体を解決する。
  const result = resolveFootnoteContent(doc, trigger);

  // Assert: 解決結果の fragment に危険要素・on*・javascript: が一切残っていない。
  assert.ok(result, "結果が null（解決できていない）");
  const tmp = doc.createElement("div");
  tmp.appendChild(result.fragment);

  assert.equal(tmp.querySelector("script"), null, "script が残っている");
  const img = tmp.querySelector("img");
  assert.equal(
    img && img.hasAttribute("onerror"),
    false,
    "onerror が残っている",
  );
  // 危険スキーム名はリテラルを避けて部品から組む（no-script-url 回避）。
  const dangerScheme = "java" + "script:";
  const a = tmp.querySelector("a[href]");
  assert.equal(
    a ? new RegExp(dangerScheme, "i").test(a.getAttribute("href")) : false,
    false,
    "危険スキーム（js:）が残っている",
  );
});

// t2（異常）: getElementById で得た要素が ASIDE 以外（同一 id を持つ div=DOM clobbering）や
// 本体不在のとき null を返す（fail-closed・厳密 tagName 判定）。
test("resolveFootnoteContent: 本体不在のとき null（fail-closed）", () => {
  // Arrange: 参照アンカーはあるが、対応する本体 aside は存在しない document。
  const doc = docWithFootnote("");
  const trigger = doc.querySelector("a.footnote-reference");

  // Act / Assert: 本体が引けないので解決は null。
  assert.equal(resolveFootnoteContent(doc, trigger), null);
});

test("resolveFootnoteContent: id が ASIDE 以外（DOM clobbering の div）なら null", () => {
  // Arrange: 参照 href="#id3" と同一 id を持つが ASIDE ではない偽要素を置く。
  const doc = docWithFootnote('<div id="id3" class="footnote"><p>偽の本体</p></div>');
  const trigger = doc.querySelector("a.footnote-reference");

  // Act / Assert: tag!=="ASIDE" のため厳密判定で弾かれ null（class が一致しても採用しない）。
  assert.equal(resolveFootnoteContent(doc, trigger), null);
});

// t3（正常）: 脚注本体を clone し戻りリンク span.label（配下 .fn-backref 含む）を全除去し、
// aside ラッパは含めず本体子ノードのテキストだけを fragment へ移すこと。
test("resolveFootnoteContent: 本体をcloneしspan.label（配下.fn-backref含む）を全除去し、asideラッパは含めず本体子ノードだけをfragmentへ移す", () => {
  // Arrange: label（戻りリンク .fn-backref を内包）＋本体段落を持つ通常の脚注本体。
  const doc = docWithFootnote(
    '<aside class="footnote brackets" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">1</a></span>' +
      '<p>脚注の本文テキスト</p></aside>',
  );
  const trigger = doc.querySelector("a.footnote-reference");

  // Act: 脚注参照トリガから本体を解決する。
  const result = resolveFootnoteContent(doc, trigger);

  // Assert: 解決結果が得られ、fragment の中身を検査用 div に移して走査する。
  assert.ok(result, "結果が null（解決できていない）");
  const tmp = doc.createElement("div");
  tmp.appendChild(result.fragment);

  // 戻りリンク span.label と配下の .fn-backref は全除去されている。
  assert.equal(tmp.querySelector(".label"), null, "span.label が残っている");
  assert.equal(tmp.querySelector(".fn-backref"), null, ".fn-backref が残っている");
  // aside ラッパ自体は fragment に含まれない（本体子ノードだけが移されている）。
  assert.equal(tmp.querySelector("aside"), null, "aside ラッパが含まれている");
  // 本体段落とそのテキストは保持されている。
  const paragraph = tmp.querySelector("p");
  assert.ok(paragraph, "本体段落 p が失われている");
  assert.equal(paragraph.textContent, "脚注の本文テキスト");
});

// t7（正常）: citation 本体（<aside class="citation">）も footnote と同じ経路で
// 解決でき、本体テキストを返す。FOOTNOTE_BODY_CLASSES に citation が含まれることで、
// 引用参照（a.citation-reference）も脚注と同一の resolve 経路に乗ることを保証する。
test("resolveFootnoteContent: citation 本体（aside class=citation）も解決し本体テキストを返す", () => {
  // Arrange: 引用参照アンカー＋本体 aside.citation を DOM 契約どおりに組む。
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<p>本文<a class="citation-reference" href="#cite-x" id="cid1">[CIT]</a></p>' +
      '<aside class="citation" id="cite-x" role="doc-cite">' +
      '<span class="label"><a class="fn-backref" href="#cid1">CIT</a></span>' +
      "<p>引用の本文テキスト</p></aside>" +
      "</body>",
  );
  const doc = dom.window.document;
  const trigger = doc.querySelector("a.citation-reference");

  // Act: 引用参照トリガから本体を解決する。
  const result = resolveFootnoteContent(doc, trigger);

  // Assert: 解決結果が得られ、本体段落のテキストが保持されている。
  assert.ok(result, "結果が null（citation 本体を解決できていない）");
  const tmp = doc.createElement("div");
  tmp.appendChild(result.fragment);
  const paragraph = tmp.querySelector("p");
  assert.ok(paragraph, "本体段落 p が失われている");
  assert.equal(paragraph.textContent, "引用の本文テキスト");
});

// t4（正常・結合配線）: 脚注参照を click すると、委譲経路で resolveFootnoteContent が
// 呼ばれ、戻りリンクを除去した本体子ノードが共有 .riddle-popover へ一括挿入され、
// 表示される（hidden が外れる）までが通る。term 経路と同一の resolve → 表示配線が
// 脚注参照（a.footnote-reference / a.citation-reference）でも効いていることを保証する。
// 実描画・実 click 起点の computed style は #24 Playwright へ委譲し、ここでは
// 挿入内容と hidden 状態のみを検証する。
test("結合: 脚注参照 click で本体が共有 .riddle-popover へ挿入され表示される（hidden が外れる）", () => {
  // Arrange: 脚注参照＋本体 aside の DOM 契約を組み、footnotes 有効で委譲リスナを張る。
  const doc = docWithFootnote(
    '<aside class="footnote brackets" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">1</a></span>' +
      "<p>脚注の本文テキスト</p></aside>",
  );
  installRiddlePopover(doc, { footnotes: true });
  const trigger = doc.querySelector("a.footnote-reference");

  // Act: 脚注参照トリガを実 click（document への委譲リスナが拾う）。
  trigger.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 共有 .riddle-popover がちょうど1つ存在し、脚注本体の内容を持ち、表示されている。
  const popovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(popovers.length, 1, "共有 .riddle-popover はちょうど1つであるべき");
  const popover = popovers[0];
  assert.equal(
    popover.textContent.includes("脚注の本文テキスト"),
    true,
    "脚注本体の内容が popover へ挿入されているべき",
  );
  // 戻りリンク（.label / .fn-backref）はポップアップでは除去されている。
  assert.equal(popover.querySelector(".fn-backref"), null, "戻りリンクが残っている");
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "click 後の popover は表示状態（hidden が外れている）であるべき",
  );
});

// t5（正常・共有ディスパッチ）: term リンク → 脚注参照の順に click しても、
// 共有 .riddle-popover は1個のまま再利用され（再生成されない）、内容だけが
// term の定義 → 脚注本体へ差し替わる。term 経路（resolveTermContent）と脚注経路
// （resolveFootnoteContent）が、同一 options・同一委譲リスナ・同一共有 popover を
// 共有していることを保証する（handleTriggerForElement のディスパッチ共有）。
// 実描画は #24 Playwright へ委譲し、ここでは popover の個数・同一インスタンス性・
// 挿入内容（差し替え）のみを検証する。
test("共有: term と脚注を続けて click しても .riddle-popover は1個のまま再利用され内容だけ差し替わる", () => {
  // Arrange: term トリガ＋定義 template と、脚注参照＋本体 aside を1つの document に混在させ、
  // footnotes 有効（既定）で委譲リスナを張る。
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>' +
      '<p>本文<a class="footnote-reference brackets" href="#id3" id="id1">[1]</a></p>' +
      '<aside class="footnote brackets" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">1</a></span>' +
      "<p>脚注の本文テキスト</p></aside>" +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc, { trigger: "click" });
  const { MouseEvent } = doc.defaultView;
  const click = (selector) =>
    doc
      .querySelector(selector)
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  // Act 1: term リンクを click → term 経路で定義0 が挿入される。
  click('a[href="#term-0"]');
  const firstPopovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(
    firstPopovers.length,
    1,
    "term click 後、共有 .riddle-popover はちょうど1つであるべき",
  );
  const sharedInstance = firstPopovers[0];
  assert.equal(
    sharedInstance.textContent.includes("定義0"),
    true,
    "term click 後は term-0 の定義（定義0）が挿入されているべき",
  );

  // Act 2: 続けて脚注参照を click → 脚注経路で本体テキストへ差し替わる。
  click("a.footnote-reference");

  // Assert: popover は依然ちょうど1つで、term 時と同一インスタンスを再利用している（再生成しない）。
  const secondPopovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(
    secondPopovers.length,
    1,
    "脚注 click 後も共有 .riddle-popover はちょうど1つであるべき（種別をまたいでも再生成しない）",
  );
  assert.equal(
    secondPopovers[0],
    sharedInstance,
    "term と脚注は同一の共有 .riddle-popover インスタンスを再利用すべき",
  );

  // Assert: 内容は脚注本体へ差し替わり、前回（term）の定義0 は残らない。
  assert.equal(
    sharedInstance.textContent.includes("脚注の本文テキスト"),
    true,
    "脚注 click 後は脚注本体テキストへ内容が差し替わっているべき",
  );
  assert.equal(
    sharedInstance.textContent.includes("定義0"),
    false,
    "差し替えで前回トリガ（term）の定義0 は残らないべき",
  );
});

// t6（境界・無効化）: installRiddlePopover に footnotes=false を渡すと、脚注参照を
// click しても popover は開かない（無効時 triggerSelector が term のみへ絞られ、
// 脚注参照 a.footnote-reference は委譲リスナのトリガ判定にヒットしない）。
// term リンクは引き続き開く対照は t4/t5 等で担保済みのため、ここでは「脚注参照は
// 開かない」という無効化の境界だけを検証する。実描画は #24 Playwright へ委譲し、
// ここでは表示中 .riddle-popover の不在のみを確認する。
test("境界: footnotes=false なら脚注参照を click しても popover は開かない（無効時は term のみ）", () => {
  // Arrange: 脚注参照＋本体 aside の DOM 契約を組み、footnotes 無効で委譲リスナを張る。
  const doc = docWithFootnote(
    '<aside class="footnote brackets" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">1</a></span>' +
      "<p>脚注の本文テキスト</p></aside>",
  );
  installRiddlePopover(doc, { footnotes: false });
  const trigger = doc.querySelector("a.footnote-reference");

  // Act: 脚注参照トリガを実 click（委譲リスナは拾うが footnotes 無効で無視するはず）。
  trigger.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 表示中の .riddle-popover は存在しない（脚注参照では開かない）。
  assert.equal(
    doc.querySelector(".riddle-popover:not([hidden])"),
    null,
    "footnotes=false では脚注参照 click で popover が開いてはならない",
  );
});

// 新タブ化（結合）: 脚注ポップ内のリンクにも target=_blank + rel が付与される。
test("結合: 脚注 popover 内のリンクへ target=_blank と rel が付与される", () => {
  // Arrange: リンクを含む脚注本体 aside
  const doc = docWithFootnote(
    '<aside class="footnote" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">1</a></span>' +
      '<p>脚注本文 <a href="https://example.com/">参考</a></p></aside>',
  );
  installRiddlePopover(doc);

  // Act: 脚注参照を click してポップを表示する
  doc.querySelector("a.footnote-reference").dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert
  const link = doc
    .querySelector(".riddle-popover")
    .querySelector('a[href="https://example.com/"]');
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
});
