// 画像ライトボックス（純関数・委譲・開閉）の単体/統合テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  isSafeImageHref,
  resolveImageSrc,
  installRiddlePopover,
  LIGHTBOX_FALLBACK_LABEL,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";
import { JAVASCRIPT_ALERT } from "./fixtures/dangerous-urls.js";

// 非画像 href の click（preventDefault しない）で jsdom が出す
// 「Not implemented: navigation」のノイズを握り潰す（機能には影響しない）。
const silentConsole = new VirtualConsole();
silentConsole.on("jsdomError", () => {});

/**
 * 画像トリガ等を持つ document を組む（baseURI 付き）。
 * @returns {Document}
 */
function docWithImages() {
  return new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="reference external image-reference" href="https://example.com/full.png">' +
      '<img src="pic.png" alt="サンプル図"></a>' +
      '<a class="reference external image-reference" href="../other/doc.html">' +
      '<img src="thumb.png" alt="別ページ"></a>' +
      '<a class="footnote-reference" href="#fn1">1</a>' +
      "</body>",
    { url: BASE, virtualConsole: silentConsole },
  ).window.document;
}

function clickFirst(doc, selector) {
  const el = doc.querySelector(selector);
  const ev = new doc.defaultView.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
}

const BASE = "https://example.test/dir/page.html";

/**
 * body HTML から最初の <a> を返す（トリガ用）。
 * @param {string} bodyHtml
 * @returns {Element}
 */
function triggerFromBody(bodyHtml) {
  const doc = new JSDOM(
    `<!DOCTYPE html><body>${bodyHtml}</body>`,
    { url: BASE },
  ).window.document;
  return doc.querySelector("a");
}

test("isSafeImageHref: 画像拡張子＋安全スキームは true", () => {
  assert.equal(isSafeImageHref("https://example.com/full.png", BASE), true);
  assert.equal(isSafeImageHref("pic.jpg", BASE), true);
  assert.equal(isSafeImageHref("../img/a.svg", BASE), true);
  assert.equal(isSafeImageHref("photo.jpeg", BASE), true);
  assert.equal(isSafeImageHref("anim.gif", BASE), true);
  assert.equal(isSafeImageHref("hero.webp", BASE), true);
  assert.equal(isSafeImageHref("pic.avif", BASE), true);
});

test("isSafeImageHref: 非画像・アンカー・危険スキームは false", () => {
  assert.equal(isSafeImageHref("#anchor", BASE), false);
  assert.equal(isSafeImageHref("../other/doc.html", BASE), false);
  assert.equal(isSafeImageHref("https://example.com/page", BASE), false);
  assert.equal(isSafeImageHref(JAVASCRIPT_ALERT, BASE), false);
  assert.equal(isSafeImageHref("data:text/html,evil", BASE), false);
  // data:image/svg+xml は拡張子ではなく「許可スキーム外」のため isSafeUrl で fail-closed（拡張子判定に到達しない）。
  assert.equal(isSafeImageHref("data:image/svg+xml,<svg/>", BASE), false);
});

test("resolveImageSrc: img 子＋安全画像 href なら href を返す", () => {
  const trigger = triggerFromBody(
    '<a class="image-reference" href="https://example.com/full.png"><img src="pic.png" alt="図"></a>',
  );
  assert.equal(resolveImageSrc(trigger, BASE), "https://example.com/full.png");
});

test("resolveImageSrc: img 子が無ければ null", () => {
  const trigger = triggerFromBody(
    '<a class="image-reference" href="https://example.com/full.png">テキスト</a>',
  );
  assert.equal(resolveImageSrc(trigger, BASE), null);
});

test("resolveImageSrc: 非画像 href なら null（通常遷移へ委ねる）", () => {
  const trigger = triggerFromBody(
    '<a class="image-reference" href="../other/doc.html"><img src="pic.png"></a>',
  );
  assert.equal(resolveImageSrc(trigger, BASE), null);
});

test("クリックで開く: 画像トリガ click で preventDefault しライトボックスが表示される", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });

  const ev = clickFirst(doc, 'a[href="https://example.com/full.png"]');

  assert.equal(ev.defaultPrevented, true, "画像トリガ click は preventDefault されるべき");
  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.ok(lightbox, "ライトボックス要素が生成されていない");
  assert.equal(lightbox.hasAttribute("hidden"), false, "ライトボックスが表示されていない");
  assert.equal(
    lightbox.querySelector("img").getAttribute("src"),
    "https://example.com/full.png",
    "ライトボックス img の src がリンク先画像になっていない",
  );
});

test("クリックで開く: 非画像 href の image-reference は preventDefault せず通常遷移へ委ねる", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });

  const ev = clickFirst(doc, 'a[href="../other/doc.html"]');

  assert.equal(ev.defaultPrevented, false, "非画像 href は preventDefault されてはならない");
  assert.equal(
    doc.querySelector(".riddle-lightbox:not([hidden])"),
    null,
    "非画像 href でライトボックスが開いてはならない",
  );
});

test("クリックで開く: imagePopup 無効時は画像トリガでもライトボックスを開かない", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: false, footnotes: false });

  const ev = clickFirst(doc, 'a[href="https://example.com/full.png"]');

  assert.equal(ev.defaultPrevented, false);
  assert.equal(doc.querySelector(".riddle-lightbox:not([hidden])"), null);
});

test("委譲リスナ: imagePopup 有効でも document への click リスナはちょうど1つ", () => {
  const doc = docWithImages();
  const calls = [];
  const original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, listener, options) => {
    calls.push(type);
    return original(type, listener, options);
  };

  installRiddlePopover(doc, { imagePopup: true });

  assert.equal(calls.filter((t) => t === "click").length, 1);
});

test("閉じる: ESC キーでライトボックスが閉じる", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });
  clickFirst(doc, 'a[href="https://example.com/full.png"]');
  const lightbox = doc.querySelector(".riddle-lightbox");

  doc.dispatchEvent(
    new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  assert.equal(lightbox.hasAttribute("hidden"), true, "ESC で閉じるべき");
});

test("閉じる: 閉じると起点トリガへ focus が戻る", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });
  const trigger = doc.querySelector('a[href="https://example.com/full.png"]');
  clickFirst(doc, 'a[href="https://example.com/full.png"]');

  doc.dispatchEvent(
    new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  assert.equal(doc.activeElement, trigger, "閉時にトリガへ focus が戻るべき");
});

test("閉じる: 閉じるボタン click で既存閉じ経路（isLightboxOpen 早期 closeLightbox）が通り、ライトボックスが hidden になりトリガへ focus が戻る", () => {
  // Arrange
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });
  const trigger = doc.querySelector('a[href="https://example.com/full.png"]');
  clickFirst(doc, 'a[href="https://example.com/full.png"]');
  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.equal(lightbox.hasAttribute("hidden"), false, "前提: 開いている");
  const closeBtn = lightbox.querySelector(".riddle-lightbox__close");
  assert.ok(closeBtn, "前提: 閉じるボタンが存在する");

  // Act: 閉じるボタンをクリック（委譲リスナ経由で closeLightbox が呼ばれるはず）
  closeBtn.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: ライトボックスが閉じている
  assert.equal(lightbox.hasAttribute("hidden"), true, "閉じるボタン click でライトボックスが閉じるべき");
  // Assert: トリガへ focus が戻っている
  assert.equal(doc.activeElement, trigger, "閉じるボタン click 後にトリガへ focus が戻るべき");
});

test("閉じる: 表示中はライトボックス上の任意クリックで閉じる（要件②）", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });
  clickFirst(doc, 'a[href="https://example.com/full.png"]');
  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.equal(lightbox.hasAttribute("hidden"), false, "前提: 開いている");

  // ライトボックス（画像含む）をクリック
  lightbox.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  assert.equal(lightbox.hasAttribute("hidden"), true, "任意クリックで閉じるべき");
});

test("focus trap: ライトボックス表示中の Tab / Shift+Tab は preventDefault され閉じるボタンへ focus が循環する", () => {
  // Arrange
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });
  clickFirst(doc, 'a[href="https://example.com/full.png"]');
  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.equal(lightbox.hasAttribute("hidden"), false, "前提: ライトボックスが開いている");
  const closeBtn = lightbox.querySelector(".riddle-lightbox__close");
  assert.ok(closeBtn, "前提: 閉じるボタンが存在する");

  // テーブル駆動: Tab と Shift+Tab の両方を検証
  const cases = [
    { key: "Tab", shiftKey: false, label: "Tab" },
    { key: "Tab", shiftKey: true, label: "Shift+Tab" },
  ];

  for (const { key, shiftKey, label } of cases) {
    // 前提として focus を閉じるボタンから外し（lightbox 自身へ退避）、
    // Tab ハンドラが「実際に」閉じるボタンへ focus を循環させることを検証する。
    // （初期 focus が既に閉じるボタンだと、ハンドラが何もしなくても通る空虚な検証になるため）
    lightbox.focus();
    assert.notEqual(
      doc.activeElement,
      closeBtn,
      `${label}: 前提として focus を閉じるボタンから外しておく`,
    );

    const ev = new doc.defaultView.KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    // Act
    doc.dispatchEvent(ev);
    // Assert: preventDefault が呼ばれ背景へ抜けない
    assert.equal(ev.defaultPrevented, true, `${label}: preventDefault されるべき`);
    // Assert: focus が閉じるボタンへ循環している（退避先から戻っている）
    assert.equal(
      doc.activeElement,
      closeBtn,
      `${label}: focus が閉じるボタンへ循環するべき`,
    );
  }
});

test("focus trap (inert): openLightbox で lightbox 以外の body 直下要素に inert と aria-hidden=true が付き、closeLightbox で記録分のみ解除される（事前 inert 付き要素は除外）", () => {
  // Arrange: body に事前 inert 要素を追加した document を組む。
  const doc = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="reference external image-reference" href="https://example.com/full.png">' +
      '<img src="pic.png" alt="サンプル図"></a>' +
      '<nav id="pre-inert" inert aria-hidden="true">ナビ</nav>' +
      '<section id="normal">本文</section>' +
      "</body>",
    { url: BASE, virtualConsole: silentConsole },
  ).window.document;

  installRiddlePopover(doc, { imagePopup: true, footnotes: false });

  // openLightbox を起動
  clickFirst(doc, 'a[href="https://example.com/full.png"]');

  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.equal(lightbox.hasAttribute("hidden"), false, "前提: ライトボックスが開いている");

  const trigger = doc.querySelector('a[href="https://example.com/full.png"]');
  const preInertEl = doc.getElementById("pre-inert");
  const normalEl = doc.getElementById("normal");

  // Act (open 後の検証):
  // normalEl（事前 inert なし）には inert と aria-hidden が付いているはず。
  assert.equal(
    normalEl.hasAttribute("inert"),
    true,
    "openLightbox: body 直下の通常要素に inert が付与されるべき",
  );
  assert.equal(
    normalEl.getAttribute("aria-hidden"),
    "true",
    "openLightbox: body 直下の通常要素に aria-hidden='true' が付与されるべき",
  );
  // trigger（<a> 要素）にも付与される（lightbox でない body 直下要素）。
  assert.equal(
    trigger.hasAttribute("inert"),
    true,
    "openLightbox: トリガ <a> にも inert が付与されるべき",
  );
  // preInertEl は事前 inert 付きなので今回の記録外 → すでに inert 済みだが属性はそのまま。
  // （付与しなかった = 解除対象に入っていない、を closeLightbox 後で確認する）

  // Act: ESC でライトボックスを閉じる
  doc.dispatchEvent(
    new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  // Assert (close 後):
  // normalEl の inert / aria-hidden は解除されているはず。
  assert.equal(
    normalEl.hasAttribute("inert"),
    false,
    "closeLightbox: 付与した inert は解除されるべき",
  );
  assert.equal(
    normalEl.hasAttribute("aria-hidden"),
    false,
    "closeLightbox: 付与した aria-hidden は解除されるべき",
  );
  // preInertEl は記録外なので inert / aria-hidden が維持されているはず。
  assert.equal(
    preInertEl.hasAttribute("inert"),
    true,
    "closeLightbox: 事前 inert 要素の inert は解除されてはならない",
  );
  assert.equal(
    preInertEl.getAttribute("aria-hidden"),
    "true",
    "closeLightbox: 事前 inert 要素の aria-hidden は解除されてはならない",
  );
});

test("閉じる: 開閉を繰り返しても例外を出さず冪等に動く", () => {
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });
  const open = () => clickFirst(doc, 'a[href="https://example.com/full.png"]');
  const close = () =>
    doc.dispatchEvent(
      new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

  // 開く→閉じる を 2 サイクル。表示中クリックは閉じ経路へ入るため open/close を交互に行う。
  assert.doesNotThrow(() => {
    open();
    close();
    open();
    close();
  });
});

test("openLightbox: 初期 focus が lightbox 自身ではなく閉じるボタン（.riddle-lightbox__close）に当たる", () => {
  // Arrange
  const doc = docWithImages();
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });

  // Act: ライトボックスを開く
  clickFirst(doc, 'a[href="https://example.com/full.png"]');

  const lightbox = doc.querySelector(".riddle-lightbox");
  assert.ok(lightbox, "前提: ライトボックスが生成されている");
  assert.equal(lightbox.hasAttribute("hidden"), false, "前提: ライトボックスが開いている");

  const closeBtn = lightbox.querySelector(".riddle-lightbox__close");
  assert.ok(closeBtn, "閉じるボタン（.riddle-lightbox__close）が lightbox 内に存在するべき");

  // Assert: dialog 内で唯一の操作要素として非空のアクセシブルネーム（aria-label）を持つ
  assert.equal(
    closeBtn.getAttribute("aria-label"),
    "閉じる",
    "閉じるボタンは非空の aria-label（アクセシブルネーム）を持つべき",
  );

  // Assert: tabindex が設定されていて focusable である
  // （button 要素はデフォルト focusable だが tabindex 属性が付いていることも確認）
  assert.notEqual(
    closeBtn.getAttribute("tabindex"),
    "-1",
    "閉じるボタンは tabindex=-1 でなく focusable であるべき",
  );

  // Assert: 初期 focus が lightbox 自身ではなく閉じるボタンに当たっている
  assert.equal(
    doc.activeElement,
    closeBtn,
    "openLightbox 後の activeElement は lightbox ではなく閉じるボタンであるべき",
  );
});

test("scroll-lock: openLightbox で documentElement.style.overflow が保存され hidden に設定され、closeLightbox で元値へ復元される", () => {
  // Arrange: overflow の初期値を明示的に設定しておく（元値の復元を厳密に検証するため）。
  const doc = docWithImages();
  doc.documentElement.style.overflow = "auto";
  installRiddlePopover(doc, { imagePopup: true, footnotes: false });

  // Act: ライトボックスを開く
  clickFirst(doc, 'a[href="https://example.com/full.png"]');

  // Assert: 開いた直後は overflow が "hidden" に設定されているべき
  assert.equal(
    doc.documentElement.style.overflow,
    "hidden",
    "openLightbox 後に documentElement.style.overflow が 'hidden' になるべき",
  );

  // Act: ESC でライトボックスを閉じる
  doc.dispatchEvent(
    new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  // Assert: 閉じた後は元値へ復元されているべき
  assert.equal(
    doc.documentElement.style.overflow,
    "auto",
    "closeLightbox 後に documentElement.style.overflow が元値 'auto' へ復元されるべき",
  );
});

test("aria-label フォールバック: alt に応じて aria-label が決まる（テーブル駆動）", () => {
  // テーブル駆動: 非空 alt はその値、空 alt / alt 属性なし は LIGHTBOX_FALLBACK_LABEL を使う。
  const cases = [
    {
      label: "非空 alt はそのまま aria-label になる",
      bodyHtml:
        '<a class="reference external image-reference" href="https://example.com/full.png">' +
        '<img src="pic.png" alt="サンプル図"></a>',
      expectedAriaLabel: "サンプル図",
      expectedImgAlt: "サンプル図",
    },
    {
      label: "空文字 alt のときは LIGHTBOX_FALLBACK_LABEL が aria-label になる",
      bodyHtml:
        '<a class="reference external image-reference" href="https://example.com/full.png">' +
        '<img src="pic.png" alt=""></a>',
      expectedAriaLabel: LIGHTBOX_FALLBACK_LABEL,
      expectedImgAlt: "",
    },
    {
      label: "alt 属性なしのときは LIGHTBOX_FALLBACK_LABEL が aria-label になる",
      bodyHtml:
        '<a class="reference external image-reference" href="https://example.com/full.png">' +
        '<img src="pic.png"></a>',
      expectedAriaLabel: LIGHTBOX_FALLBACK_LABEL,
      expectedImgAlt: "",
    },
  ];

  for (const { label, bodyHtml, expectedAriaLabel, expectedImgAlt } of cases) {
    const doc = new JSDOM(
      `<!DOCTYPE html><body>${bodyHtml}</body>`,
      { url: BASE, virtualConsole: silentConsole },
    ).window.document;

    installRiddlePopover(doc, { imagePopup: true, footnotes: false });
    clickFirst(doc, 'a[href="https://example.com/full.png"]');

    const lightbox = doc.querySelector(".riddle-lightbox");
    assert.ok(lightbox, `${label}: ライトボックスが存在する`);
    assert.equal(lightbox.hasAttribute("hidden"), false, `${label}: ライトボックスが開いている`);

    // aria-label の検証（空 alt 時はフォールバック名が使われるべき）。
    assert.equal(
      lightbox.getAttribute("aria-label"),
      expectedAriaLabel,
      `${label}: aria-label が期待値と一致するべき`,
    );

    // img.alt は実 alt のまま（装飾画像で空は妥当）。
    const lightboxImg = lightbox.querySelector("img");
    assert.equal(
      lightboxImg.getAttribute("alt"),
      expectedImgAlt,
      `${label}: img.alt は実 alt のまま`,
    );
  }
});
