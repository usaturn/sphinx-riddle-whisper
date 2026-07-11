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

/** fake timer 注入で install し、その timers を返す（options は透過）。 */
function installWithTimers(doc, options = {}) {
  const timers = makeFakeTimers();
  installRiddlePopover(doc, {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...options,
  });
  return timers;
}

/** レベル1ポップ内の term トリガへ mouseenter → tick してレベル2を開き、その要素を返す。 */
function hoverOpenNested(doc, timers, level1, selector = 'a[href="#term-b"]') {
  level1.querySelector(selector).dispatchEvent(
    new doc.defaultView.MouseEvent("mouseenter", {
      bubbles: false,
      cancelable: true,
    }),
  );
  timers.tick();
  return doc.querySelector(NESTED_SELECTOR);
}

// 新タブのみ: レベル1ポップ内の term click ではレベル2を開かず、
// target=_blank による新タブ遷移（ブラウザ既定動作）へ委ねる（preventDefault しない）。
test("ネスト: レベル1ポップ内の term click はレベル2を開かず新タブ遷移に委ねる", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc);
  const level1 = openLevel1(doc);
  const link = level1.querySelector('a[href="#term-b"]');

  // Act: cancelable な click を dispatch し、イベントを保持して検証する
  const event = new doc.defaultView.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(event);

  // Assert: レベル2は開かず、既定動作は生きており、新タブ属性が付与済み
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.equal(
    nested === null || nested.hasAttribute("hidden"),
    true,
    "click ではレベル2を開かない",
  );
  assert.equal(event.defaultPrevented, false, "既定動作（新タブ遷移）を殺さない");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(level1.hasAttribute("hidden"), false, "レベル1は開いたまま");
});

// trigger="click" でも同じ合成挙動（クリックが唯一の開閉手段の設定）。
test("ネスト: trigger=click でもポップ内 term click は新タブのみでレベル2は開かない", () => {
  // Arrange
  const doc = docWithNestedTerms();
  installRiddlePopover(doc, { trigger: "click" });
  const level1 = openLevel1(doc);
  const link = level1.querySelector('a[href="#term-b"]');

  // Act
  const event = new doc.defaultView.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  link.dispatchEvent(event);

  // Assert
  assert.equal(doc.querySelector(NESTED_SELECTOR), null, "レベル2は生成されない");
  assert.equal(event.defaultPrevented, false);
});

// hover で開いた古いレベル2は、ポップ内 term click（新タブ遷移）で閉じる。
test("ネスト: hover で開いたレベル2はポップ内 term click で閉じる", () => {
  // Arrange: hover でレベル2まで開く
  const doc = docWithNestedTerms();
  const timers = installWithTimers(doc);
  const level1 = openLevel1(doc);
  const nested = hoverOpenNested(doc, timers, level1);
  assert.equal(nested.hasAttribute("hidden"), false, "前提: レベル2が開いている");

  // Act
  click(doc, level1.querySelector('a[href="#term-b"]'));

  // Assert: レベル2は閉じ、レベル1は残る
  assert.equal(nested.hasAttribute("hidden"), true);
  assert.equal(level1.hasAttribute("hidden"), false);
});

// 固定2段: レベル2ポップ内の term click では何も開かない。
test("ネスト: レベル2ポップ内の term click では3段目が開かない", () => {
  // Arrange: レベル1 → レベル2（定義B）まで開く
  const doc = docWithNestedTerms();
  const timers = installWithTimers(doc);
  const level1 = openLevel1(doc);
  const nested = hoverOpenNested(doc, timers, level1);

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
  const timers = installWithTimers(doc);
  const level1 = openLevel1(doc);

  // Act: 定義A内の自己参照（#term-a）へ hover
  const nested = hoverOpenNested(doc, timers, level1, 'a[href="#term-a"]');

  // Assert
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
  const timers = installWithTimers(doc);
  const level1 = openLevel1(doc);
  const nestedTrigger = level1.querySelector('a[href="#term-b"]');

  // Act: hover でレベル2を開く
  const nested = hoverOpenNested(doc, timers, level1);

  // Assert
  assert.equal(nested.getAttribute("id"), "riddle-popover-2");
  assert.equal(nested.getAttribute("role"), "tooltip");
  assert.equal(nestedTrigger.getAttribute("aria-describedby"), "riddle-popover-2");
});

/** Escape の keydown を document へ dispatch する。 */
function pressEscape(doc) {
  doc.dispatchEvent(
    new doc.defaultView.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** fake timer 注入で install し、click でレベル1・hover でレベル2を開く。 */
function openBothLevels(doc, options = {}) {
  const timers = installWithTimers(doc, options);
  const level1 = openLevel1(doc);
  const nested = hoverOpenNested(doc, timers, level1);
  return { timers, level1, nested };
}

// Esc: 1回目でレベル2のみ閉じ、2回目でレベル1も閉じる（内側から順）。
test("閉じる: Esc は内側から順に閉じる（1回目レベル2・2回目レベル1）", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { level1, nested } = openBothLevels(doc);

  // Act 1 & Assert: 1回目の Esc でレベル2だけ閉じる
  pressEscape(doc);
  assert.equal(nested.hasAttribute("hidden"), true, "1回目の Esc でレベル2は閉じる");
  assert.equal(level1.hasAttribute("hidden"), false, "1回目の Esc でレベル1は残る");

  // Act 2 & Assert: 2回目の Esc でレベル1も閉じる
  pressEscape(doc);
  assert.equal(level1.hasAttribute("hidden"), true, "2回目の Esc でレベル1も閉じる");
});

/**
 * docWithNestedTerms と同じネスト構造に、画像ライトボックス用の画像トリガを足した document を組む
 * （image-lightbox.test.mjs の docWithImages と同じ流儀: image-reference アンカー＋img 子）。
 * @returns {Document}
 */
function docWithNestedTermsAndImage() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a href="#term-a">用語A</a>' +
      '<template id="riddle-tip--term-a">' +
      '<p>定義A <a href="#term-b">用語B</a></p>' +
      "</template>" +
      '<template id="riddle-tip--term-b"><p>定義B</p></template>' +
      '<a class="reference external image-reference" href="https://example.com/full.png">' +
      '<img src="pic.png" alt="サンプル図"></a>' +
      "</body>",
  );
  return dom.window.document;
}

// 回帰: レベル2ポップ表示中にライトボックスも開いていると、1回目の Esc は
// 最前面のライトボックスを（ポップも含め）全閉するべき（v1.0.0 の挙動への回帰防止）。
test("閉じる: ライトボックス表示中の Esc はネスト表示中でもライトボックス優先で閉じる", () => {
  // Arrange: レベル1・レベル2ポップを開いた上でライトボックスも開く
  const doc = docWithNestedTermsAndImage();
  const { level1, nested } = openBothLevels(doc, { imagePopup: true });
  click(doc, doc.querySelector("a.image-reference"));
  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.equal(lightbox.hasAttribute("hidden"), false, "前提: ライトボックスが開いている");
  assert.equal(nested.hasAttribute("hidden"), false, "前提: レベル2ポップが開いている");

  // Act: 1回目の Esc
  pressEscape(doc);

  // Assert: ライトボックスが閉じ、ポップも（v1.0.0 同様）全閉し、モーダルが残らない
  assert.equal(lightbox.hasAttribute("hidden"), true, "1回目の Esc でライトボックスが閉じるべき");
  assert.equal(nested.hasAttribute("hidden"), true, "1回目の Esc でレベル2も閉じるべき");
  assert.equal(level1.hasAttribute("hidden"), true, "1回目の Esc でレベル1も閉じるべき");
});

// 外側クリック: 両ポップの外なら全レベル閉じる。
test("閉じる: 外側クリックでレベル1・レベル2とも閉じる", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { level1, nested } = openBothLevels(doc);

  // Act: ポップ外（body 直下の脚注本体）を click
  click(doc, doc.getElementById("fnbody"));

  // Assert
  assert.equal(nested.hasAttribute("hidden"), true);
  assert.equal(level1.hasAttribute("hidden"), true);
});

// レベル1ポップ内（トリガ以外）のクリックはレベル2のみ閉じる。
test("閉じる: レベル1ポップ内のトリガ以外クリックはレベル2のみ閉じる", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { level1, nested } = openBothLevels(doc);

  // Act: レベル1ポップ内の p 要素（リンク外）を click
  click(doc, level1.querySelector("p"));

  // Assert
  assert.equal(nested.hasAttribute("hidden"), true, "レベル2は閉じる");
  assert.equal(level1.hasAttribute("hidden"), false, "レベル1は開いたまま");
});

// レベル2ポップ内（トリガ以外）のクリックでは何も閉じない。
test("閉じる: レベル2ポップ内のクリックではどのレベルも閉じない", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { level1, nested } = openBothLevels(doc);

  // Act
  click(doc, nested.querySelector("p"));

  // Assert
  assert.equal(nested.hasAttribute("hidden"), false);
  assert.equal(level1.hasAttribute("hidden"), false);
});

// レベル1を開き直すと古いレベル2は閉じ、aria-describedby も除去される。
test("閉じる: レベル1の開き直しで古いレベル2が閉じ aria が除去される", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { level1, nested } = openBothLevels(doc);
  const nestedTrigger = level1.querySelector('a[href="#term-b"]');

  // Act: トップレベルの用語Aを再 click（レベル1の開き直し）
  click(doc, doc.querySelector('a[href="#term-a"]'));

  // Assert
  assert.equal(nested.hasAttribute("hidden"), true, "古いレベル2は閉じる");
  assert.equal(level1.hasAttribute("hidden"), false, "レベル1は表示中");
  assert.equal(
    nestedTrigger.hasAttribute("aria-describedby"),
    false,
    "閉じたレベル2の aria-describedby は除去されるべき",
  );
});

// 制御可能な fake timer ハーネス（install-popover.test.mjs の makeFakeTimers と同形）。
function makeFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    // 保留中タイマーをすべて発火する（時間経過の代わり）。
    tick() {
      const snapshot = [...pending.entries()];
      for (const [id, timer] of snapshot) {
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

// hover: レベル1ポップ内 term の mouseenter でもレベル2が開く（hover 経路）。
test("hover: レベル1ポップ内 term の mouseenter でレベル2が開く", () => {
  // Arrange: fake timer で install し、レベル1だけ開く
  const doc = docWithNestedTerms();
  const timers = makeFakeTimers();
  installRiddlePopover(doc, {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const level1 = openLevel1(doc);
  const { MouseEvent } = doc.defaultView;

  // Act: ポップ内の用語Bへ mouseenter → openDelay 経過
  level1
    .querySelector('a[href="#term-b"]')
    .dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.notEqual(nested, null);
  assert.equal(nested.hasAttribute("hidden"), false);
});

// focus: レベル1ポップ内 term の focusin でもレベル2が開く（focus 経路の回帰防止）。
// mouseenter 版（直上のテスト）と同じ流儀で、開く起点イベントだけ focusin に差し替える。
// jsdom は FocusEvent の dispatch に難があるため、他の focusin テスト（install-popover.test.mjs）
// に倣い、plain Event で代替する。
test("focus: レベル1ポップ内 term の focusin でレベル2が開く", () => {
  // Arrange: fake timer で install し、レベル1だけ開く
  const doc = docWithNestedTerms();
  const timers = installWithTimers(doc);
  const level1 = openLevel1(doc);
  const { Event } = doc.defaultView;

  // Act: ポップ内の用語Bへ focusin → openDelay 経過
  level1
    .querySelector('a[href="#term-b"]')
    .dispatchEvent(new Event("focusin", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert
  const nested = doc.querySelector(NESTED_SELECTOR);
  assert.notEqual(nested, null);
  assert.equal(nested.hasAttribute("hidden"), false);
});

// hover: レベル1ポップ → レベル2ポップへのポインタ移動では両方開いたまま。
test("hover: レベル1からレベル2ポップへの移動では閉じない", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { timers, level1, nested } = openBothLevels(doc);
  const { MouseEvent } = doc.defaultView;

  // Act: レベル1を離れ（close(1) 予約）、レベル2に入る（保留 close 取り消し）
  level1.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }));
  nested.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert: 両方開いたまま
  assert.equal(level1.hasAttribute("hidden"), false);
  assert.equal(nested.hasAttribute("hidden"), false);
});

// hover: レベル1ポップからの離脱（レベル2にも入らない）で全レベル閉じる。
test("hover: レベル1ポップからの離脱で全レベル閉じる", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { timers, level1, nested } = openBothLevels(doc);
  const { MouseEvent } = doc.defaultView;

  // Act: レベル1を離れて closeDelay 経過
  level1.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert
  assert.equal(level1.hasAttribute("hidden"), true);
  assert.equal(nested.hasAttribute("hidden"), true);
});

// hover: ポップ内 term トリガからの mouseleave はレベル2だけを閉じる。
test("hover: レベル2トリガからの離脱ではレベル2のみ閉じる", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { timers, level1, nested } = openBothLevels(doc);
  const { MouseEvent } = doc.defaultView;

  // Act: ポップ内の用語Bトリガから mouseleave → closeDelay 経過
  level1
    .querySelector('a[href="#term-b"]')
    .dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert: レベル2だけ閉じ、レベル1は残る
  assert.equal(nested.hasAttribute("hidden"), true);
  assert.equal(level1.hasAttribute("hidden"), false);
});

// hover: レベル2ポップ本体（トリガではなくポップ要素自身）からの離脱で、
// レベル1へ戻らない（背景へ直接抜ける）場合は全レベルが閉じる。
test("hover: レベル2ポップからの離脱（レベル1にも入らない）で全レベル閉じる", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { timers, level1, nested } = openBothLevels(doc);
  const { MouseEvent } = doc.defaultView;

  // Act: レベル2ポップへ入り（保留 close 取り消し）、そのまま背景へ抜けて closeDelay 経過
  nested.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
  nested.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert: レベル1・レベル2とも閉じる
  assert.equal(nested.hasAttribute("hidden"), true);
  assert.equal(level1.hasAttribute("hidden"), true);
});

// hover: レベル2ポップからレベル1ポップへ戻る移動では、レベル1の mouseenter が
// 予約された全閉を取り消すため両方開いたままになる。
test("hover: レベル2からレベル1ポップへ戻る移動では閉じない", () => {
  // Arrange
  const doc = docWithNestedTerms();
  const { timers, level1, nested } = openBothLevels(doc);
  const { MouseEvent } = doc.defaultView;

  // Act: レベル2ポップを離れ（close(1) 予約）、レベル1ポップへ戻る（予約取り消し）
  nested.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }));
  level1.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
  timers.tick();

  // Assert: 両方開いたまま
  assert.equal(nested.hasAttribute("hidden"), false);
  assert.equal(level1.hasAttribute("hidden"), false);
});

// 新タブ化（結合）: レベル2ポップ内のリンクにも target=_blank + rel が付与される
// （レベル1・2 とも同じ openFromTrigger 経路を通ることの確認）。
test("結合: レベル2ポップ内のリンクへ target=_blank と rel が付与される", () => {
  // Arrange: レベル1 → レベル2（定義B: 用語Cリンクを含む）まで開く
  const doc = docWithNestedTerms();
  const { nested } = openBothLevels(doc);

  // Assert: レベル2内の用語Cリンクへ新タブ属性が付与されている
  const nestedLink = nested.querySelector('a[href="#term-c"]');
  assert.equal(nestedLink.getAttribute("target"), "_blank");
  assert.equal(nestedLink.getAttribute("rel"), "noopener noreferrer");
});
