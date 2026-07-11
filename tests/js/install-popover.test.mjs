// #17 委譲リスナ登録（installRiddlePopover）の単体テスト。
// riddle.js から export された installRiddlePopover を import し、
// document へ click 委譲リスナを「1つだけ」張ること、
// リンク（a[href*="#term-"]）ごとに個別リスナを登録しないことを検証する。
//
// 実ブラウザ依存（実 click からの表示・focus・computed style）は #24 へ委譲し、
// ここでは addEventListener の呼び出し回数／登録経路（委譲か個別か）のみを検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  installRiddlePopover,
  computePopoverPosition,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

/**
 * 複数のトリガリンクと定義断片 template を持つ document を JSDOM で組んで返す。
 * （ビルド時パイプラインが生成する DOM 契約を再現）
 * @returns {Document}
 */
function docWithTriggers() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#term-0">用語0</a>' +
      '<a class="t" href="../index.html#term-1">用語1</a>' +
      '<a class="t" href="#term-2">用語2</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>' +
      '<template id="riddle-tip--term-1"><p>定義1</p></template>' +
      '<template id="riddle-tip--term-2"><p>定義2</p></template>' +
      "</body>",
  );
  return dom.window.document;
}

// 正常系: installRiddlePopover は document へ click リスナを「ちょうど1つ」張る。
test("委譲リスナ: installRiddlePopover は document へ click リスナを1つだけ張る", () => {
  // Arrange: document.addEventListener を spy で包み、click 登録回数を数える
  const doc = docWithTriggers();
  const calls = [];
  const original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, listener, options) => {
    calls.push(type);
    return original(type, listener, options);
  };

  // Act
  installRiddlePopover(doc);

  // Assert: document への click 登録はちょうど1回
  const clickCalls = calls.filter((type) => type === "click");
  assert.equal(
    clickCalls.length,
    1,
    "document への click 委譲リスナはちょうど1つであるべき",
  );
});

// 正常系: リンク（トリガ）ごとの個別リスナを登録しない（委譲のみ）。
test("委譲リスナ: トリガリンクごとの個別リスナを登録しない", () => {
  // Arrange: 各トリガ a 要素の addEventListener を spy で包む
  const doc = docWithTriggers();
  const triggers = [...doc.querySelectorAll("a.t")];
  const perLinkCalls = [];
  for (const a of triggers) {
    a.addEventListener = (type) => {
      perLinkCalls.push(type);
    };
  }

  // Act
  installRiddlePopover(doc);

  // Assert: リンク個別へのリスナ登録は一切ない
  assert.equal(
    perLinkCalls.length,
    0,
    "リンクごとの個別リスナ登録は禁止（document への単一委譲のみ）",
  );
});

// 正常系（結合・t11）: install 後にトリガを click すると、委譲経路で
// term-id 導出 → template 取得 → 走査済み fragment が共有 .riddle-popover へ
// 一括挿入され、表示される（hidden が外れる）までが通る。
test("結合: トリガ click で走査済み fragment が共有 .riddle-popover へ挿入され表示される", () => {
  // Arrange: DOM 契約（トリガと定義断片 template）を組み、委譲リスナを張る
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const trigger = doc.querySelector('a[href="#term-0"]');

  // Act: トリガを実 click（document への委譲リスナが拾う）
  trigger.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 共有 .riddle-popover がちょうど1つ存在し、template の中身を持ち、表示されている
  const popovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(popovers.length, 1, "共有 .riddle-popover はちょうど1つであるべき");
  const popover = popovers[0];
  assert.equal(
    popover.textContent.includes("定義0"),
    true,
    "term-0 の template 内容（定義0）が popover へ挿入されているべき",
  );
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "click 後の popover は表示状態（hidden が外れている）であるべき",
  );
});

test("結合: encoded singlehtml term link の click で popover が表示される", () => {
  // Arrange: singlehtml の 2 つ目の # が %23 として encode された href を再現する。
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#document-index%23term-0">用語0</a>' +
      '<template id="riddle-tip--term-0"><p>encoded 定義</p></template>' +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc);
  const trigger = doc.querySelector('a[href="#document-index%23term-0"]');

  // Act: document への委譲リスナが encoded href のトリガを拾うことを確認する。
  trigger.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: deriveTermId() へ到達し、term-0 の template が表示される。
  const popover = doc.querySelector(".riddle-popover:not([hidden])");
  assert.notEqual(
    popover,
    null,
    "encoded singlehtml link の click 後に表示中 popover が存在するべき",
  );
  assert.equal(
    popover.textContent.includes("encoded 定義"),
    true,
    "encoded href から term-0 が導出され template 内容が挿入されるべき",
  );
});

test("結合: query 内 %23term- を含む通常リンク click は term トリガ扱いせず外側クリックとして閉じる", () => {
  // Arrange: 通常 term リンクで popover を開いた後、query に %23term- を含む通常リンクを click する。
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#term-0">用語0</a>' +
      '<a class="ordinary" href="/search?q=%23term-0">ordinary</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>' +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc);
  const trigger = doc.querySelector('a[href="#term-0"]');
  const ordinary = doc.querySelector('a[href="/search?q=%23term-0"]');
  const { MouseEvent } = doc.defaultView;

  // Act 1: まず term トリガ click で popover を表示する。
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "前提: term click 後に共有 popover が生成されるべき");
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "前提: term click 後は popover が表示状態であるべき",
  );

  // Act 2: query に %23term- を含む通常リンクを click する。
  ordinary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  // Assert: 通常リンクは term トリガ扱いされず、外側クリック経路で popover が閉じる。
  assert.equal(
    popover.hasAttribute("hidden"),
    true,
    "query 内 %23term- を含む通常リンク click では popover が閉じるべき",
  );
});

// 境界（t12）: 共有 .riddle-popover は JS が生成した単一要素をキャッシュ保持し、
// 複数トリガをまたいで click しても再生成されず（DOM 内は常に1個・同一インスタンス）、
// 内容だけが後続トリガの定義へ差し替わる。
test("境界: 複数トリガを click しても共有 .riddle-popover は再生成されず同一要素のまま内容が差し替わる", () => {
  // Arrange: DOM 契約（複数トリガと定義断片 template）を組み、委譲リスナを張る
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const { MouseEvent } = doc.defaultView;
  const clickTrigger = (selector) => {
    doc
      .querySelector(selector)
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  };

  // Act: 1つ目のトリガ（term-0）を click し、生成された popover インスタンスを捕捉
  clickTrigger('a[href="#term-0"]');
  const firstPopovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(
    firstPopovers.length,
    1,
    "1回目の click 後、共有 .riddle-popover はちょうど1つであるべき",
  );
  const firstInstance = firstPopovers[0];
  assert.equal(
    firstInstance.textContent.includes("定義0"),
    true,
    "1回目は term-0 の定義（定義0）が挿入されているべき",
  );

  // Act: 2つ目の別トリガ（term-1）を click
  clickTrigger('a[href="../index.html#term-1"]');

  // Assert: popover は依然ちょうど1つ（再生成されていない）
  const secondPopovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(
    secondPopovers.length,
    1,
    "2回目の click 後も共有 .riddle-popover はちょうど1つであるべき（再生成しない）",
  );
  // Assert: 同一インスタンスが使い回されている（新規生成ではない）
  assert.equal(
    secondPopovers[0],
    firstInstance,
    "共有 .riddle-popover はキャッシュされた同一インスタンスであるべき",
  );
  // Assert: 内容は term-1 の定義へ差し替わり、前回（term-0）の内容は残らない
  assert.equal(
    firstInstance.textContent.includes("定義1"),
    true,
    "2回目は term-1 の定義（定義1）へ内容が差し替わっているべき",
  );
  assert.equal(
    firstInstance.textContent.includes("定義0"),
    false,
    "前回トリガ（term-0）の内容は差し替えで残らないべき",
  );
});

// 異常（t13・fail-closed 結合観点）: term-id 導出不能・template 不在/不正な要素を
// 指すトリガを click しても、例外を出さず・表示もしない（.riddle-popover は出ない）。
// 同質の fail-closed ケースをテーブル駆動で集約する。
//   - case 1: href に "#term-" フラグメントが無い（導出不能）
//   - case 2: 対応する template が存在しない（取得失敗）
//   - case 3: id が template ではない別要素（DOM clobbering / 不正）
const FAIL_CLOSED_CASES = [
  {
    name: "term-id 導出不能（href に #term- が無い）",
    body:
      '<a class="t" href="#section">節へ</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>',
    selector: 'a[href="#section"]',
  },
  {
    name: "template 不在（対応する定義断片が無い）",
    body: '<a class="t" href="#term-99">用語99</a>',
    selector: 'a[href="#term-99"]',
  },
  {
    name: "id が template ではない別要素（DOM clobbering）",
    body:
      '<a class="t" href="#term-0">用語0</a>' +
      '<div id="riddle-tip--term-0"><p>偽の定義</p></div>',
    selector: 'a[href="#term-0"]',
  },
];

for (const { name, body, selector } of FAIL_CLOSED_CASES) {
  test(`異常（fail-closed）: ${name} の click は例外を出さず表示もしない`, () => {
    // Arrange: 当該 fail-closed ケースの DOM 契約を組み、委譲リスナを張る
    const dom = new JSDOM(`<!DOCTYPE html><body>${body}</body>`);
    const doc = dom.window.document;
    installRiddlePopover(doc);
    const trigger = doc.querySelector(selector);
    const { MouseEvent } = doc.defaultView;

    // Act: トリガを click（委譲リスナが拾うが fail-closed で何もしないはず）。
    //      例外が漏れないこと自体を検証対象にする。
    assert.doesNotThrow(() => {
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    }, "fail-closed の click でハンドラから例外が漏れてはならない");

    // Assert: 共有 .riddle-popover は生成も表示もされない。
    const visiblePopover = doc.querySelector(".riddle-popover:not([hidden])");
    assert.equal(
      visiblePopover,
      null,
      "fail-closed の click では表示中の .riddle-popover が存在してはならない",
    );
  });
}

// 正常系（配線・t1）: トリガ click で表示する際、トリガの getBoundingClientRect が
// 読まれ、computePopoverPosition の算出結果が applyPopoverPosition 経由で
// popover.style.top / style.left へ 'px' 付き数値として書き込まれる
// （左上 0,0 のままでない＝座標適用が installRiddlePopover に配線されている確認）。
// 実配置の computed style は #24 Playwright へ委譲し、ここでは getBoundingClientRect を
// 既知 rect にスタブして CSSOM プロパティ（style.top/left）の値だけを検証する。
test("配線: トリガ click 表示時に computePopoverPosition の結果が popover.style.top/left へ px で適用される", () => {
  // Arrange: DOM 契約を組み、ビューポート寸法とトリガ rect・popover 寸法を既知値へ固定する
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const win = doc.defaultView;
  // ビューポート寸法（jsdom 既定に依らず固定する）
  Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });

  const trigger = doc.querySelector('a[href="#term-0"]');
  // トリガの矩形を既知の rect へスタブ（jsdom は実レイアウトを持たず常に 0 を返すため）
  const triggerRect = {
    top: 100,
    left: 200,
    bottom: 120,
    right: 260,
    width: 60,
    height: 20,
  };
  trigger.getBoundingClientRect = () => triggerRect;

  // popover の寸法を既知値へスタブする。popover は click 時に遅延生成されるため、
  // HTMLElement プロトタイプ上に offsetWidth/offsetHeight を定義して継承させる
  // （jsdom はレイアウトを持たず offset* は既定 0 のため）。
  const POP_WIDTH = 300;
  const POP_HEIGHT = 150;
  const proto = win.HTMLElement.prototype;
  Object.defineProperty(proto, "offsetWidth", {
    value: POP_WIDTH,
    configurable: true,
  });
  Object.defineProperty(proto, "offsetHeight", {
    value: POP_HEIGHT,
    configurable: true,
  });

  // 期待座標は配線先の純関数（computePopoverPosition）で算出する＝同じ契約で照合する
  const expected = computePopoverPosition({
    triggerRect,
    popWidth: POP_WIDTH,
    popHeight: POP_HEIGHT,
    viewportWidth: 1000,
    viewportHeight: 800,
  });

  // Act: トリガを実 click（委譲リスナが表示処理を実行する）
  trigger.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 左上 0,0 のままではなく、computePopoverPosition の結果が px 付きで適用されている
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "click 後に共有 .riddle-popover が生成されているべき");
  assert.equal(
    popover.style.top,
    `${expected.top}px`,
    "popover.style.top に computePopoverPosition の top が px 付きで適用されているべき",
  );
  assert.equal(
    popover.style.left,
    `${expected.left}px`,
    "popover.style.left に computePopoverPosition の left が px 付きで適用されているべき",
  );
});

// 正常系（配線・t2）: トリガ click で表示する際、トリガ要素の getBoundingClientRect が
// 「実際に呼ばれる」（spy で呼び出し回数を確認）。さらに spy が返した既知 rect に基づいて
// computePopoverPosition が算出した座標が popover.style.top / style.left へ適用される。
// t1 が「結果が px で書かれる」事実を見るのに対し、本 t2 は「getBoundingClientRect が
// 読まれて、その rect が compute へ渡る」配線の入力側を spy で明示的に検証する。
test("配線: トリガ click 表示時に getBoundingClientRect が読まれ、その rect から算出した座標が適用される", () => {
  // Arrange: DOM 契約を組み、ビューポート寸法・popover 寸法を既知値へ固定する
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const win = doc.defaultView;
  Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });

  // popover の寸法を既知値へスタブ（jsdom はレイアウトを持たず offset* は既定 0 のため）
  const POP_WIDTH = 300;
  const POP_HEIGHT = 150;
  const proto = win.HTMLElement.prototype;
  Object.defineProperty(proto, "offsetWidth", {
    value: POP_WIDTH,
    configurable: true,
  });
  Object.defineProperty(proto, "offsetHeight", {
    value: POP_HEIGHT,
    configurable: true,
  });

  const trigger = doc.querySelector('a[href="#term-0"]');
  // トリガの getBoundingClientRect を spy で包み、呼び出し回数を数えつつ既知 rect を返す
  const triggerRect = {
    top: 300,
    left: 400,
    bottom: 320,
    right: 460,
    width: 60,
    height: 20,
  };
  let rectCalls = 0;
  trigger.getBoundingClientRect = () => {
    rectCalls += 1;
    return triggerRect;
  };

  // 期待座標は配線先の純関数で算出する＝spy が返した rect が compute へ渡る契約で照合する
  const expected = computePopoverPosition({
    triggerRect,
    popWidth: POP_WIDTH,
    popHeight: POP_HEIGHT,
    viewportWidth: 1000,
    viewportHeight: 800,
  });

  // Act: トリガを実 click（委譲リスナが表示処理を実行する）
  trigger.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: getBoundingClientRect が表示処理中に実際に読まれている（配線の入力側）
  assert.ok(
    rectCalls >= 1,
    "表示時にトリガの getBoundingClientRect が読まれているべき",
  );

  // Assert: spy が返した rect から算出した座標が popover.style.top/left へ px で適用されている
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "click 後に共有 .riddle-popover が生成されているべき");
  assert.equal(
    popover.style.top,
    `${expected.top}px`,
    "spy が返した rect 由来の top が popover.style.top へ px 付きで適用されているべき",
  );
  assert.equal(
    popover.style.left,
    `${expected.left}px`,
    "spy が返した rect 由来の left が popover.style.left へ px 付きで適用されているべき",
  );
});

// 正常系（配線・t3）: トリガ click で表示する際、追従再配置のために
// doc.defaultView（window）へ scroll と resize のリスナが passive: true で登録される。
// 実際の再配置の効きや rAF スロットルは別項目／#24 へ委譲し、ここでは
// view.addEventListener を spy して 'scroll'/'resize' の登録と options（passive）だけを検証する。
test("配線: トリガ click 表示時に doc.defaultView へ scroll/resize リスナが passive:true で登録される", () => {
  // Arrange: DOM 契約を組み、委譲リスナを張る。
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const win = doc.defaultView;

  // popover の寸法と getBoundingClientRect は表示処理が例外なく通れば足りるので
  // 既知値へ固定する（jsdom はレイアウトを持たないため）。
  Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
  const proto = win.HTMLElement.prototype;
  Object.defineProperty(proto, "offsetWidth", { value: 300, configurable: true });
  Object.defineProperty(proto, "offsetHeight", { value: 150, configurable: true });

  const trigger = doc.querySelector('a[href="#term-0"]');
  trigger.getBoundingClientRect = () => ({
    top: 100,
    left: 200,
    bottom: 120,
    right: 260,
    width: 60,
    height: 20,
  });

  // window.addEventListener を spy で包み、type と options を記録する。
  const winCalls = [];
  const originalWinAdd = win.addEventListener.bind(win);
  win.addEventListener = (type, listener, options) => {
    winCalls.push({ type, options });
    return originalWinAdd(type, listener, options);
  };

  // Act: トリガを実 click（委譲リスナが表示処理を実行する）。
  trigger.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: window へ scroll リスナが passive: true で登録されている。
  const scrollCall = winCalls.find((c) => c.type === "scroll");
  assert.notEqual(
    scrollCall,
    undefined,
    "表示時に doc.defaultView へ scroll リスナが登録されているべき",
  );
  assert.equal(
    typeof scrollCall.options === "object" && scrollCall.options !== null
      ? scrollCall.options.passive
      : undefined,
    true,
    "scroll リスナは passive: true で登録されているべき",
  );

  // Assert: window へ resize リスナが passive: true で登録されている。
  const resizeCall = winCalls.find((c) => c.type === "resize");
  assert.notEqual(
    resizeCall,
    undefined,
    "表示時に doc.defaultView へ resize リスナが登録されているべき",
  );
  assert.equal(
    typeof resizeCall.options === "object" && resizeCall.options !== null
      ? resizeCall.options.passive
      : undefined,
    true,
    "resize リスナは passive: true で登録されているべき",
  );
});

// 正常系（配線・t4）: 表示中に scroll（または resize）が発火すると、
// createRepositionScheduler 経由で doc.defaultView.requestAnimationFrame が呼ばれ、
// その rAF コールバック内で再配置（再度 applyPopoverPosition で popover.style.top/left を更新）が走る。
// rAF をスタブしてコールバックを捕捉し、手動で実行して検証する（jsdom は実 rAF を回さないため）。
// t3 が「scroll/resize リスナが登録される」入口を見るのに対し、本 t4 は
// 「scroll 発火 → rAF 呼び出し → rAF 内で再 apply」という追従の出口（再配置の実行）を検証する。
test("配線: scroll 発火で requestAnimationFrame が呼ばれ、その rAF コールバック内で再配置（再 apply）が走る", () => {
  // Arrange: DOM 契約を組み、ビューポート寸法・popover 寸法を既知値へ固定する
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const win = doc.defaultView;
  Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });

  const POP_WIDTH = 300;
  const POP_HEIGHT = 150;
  const proto = win.HTMLElement.prototype;
  Object.defineProperty(proto, "offsetWidth", {
    value: POP_WIDTH,
    configurable: true,
  });
  Object.defineProperty(proto, "offsetHeight", {
    value: POP_HEIGHT,
    configurable: true,
  });

  // requestAnimationFrame をスタブし、コールバックを捕捉する（自動実行はしない）。
  const rafCallbacks = [];
  win.requestAnimationFrame = (callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };

  // トリガの矩形を返す getBoundingClientRect をスタブ。表示時と再配置時で
  // 異なる rect を返すようにして、再配置で「新しい rect 由来の座標」へ更新されることを区別する。
  const trigger = doc.querySelector('a[href="#term-0"]');
  const initialRect = {
    top: 100,
    left: 200,
    bottom: 120,
    right: 260,
    width: 60,
    height: 20,
  };
  const scrolledRect = {
    top: 300,
    left: 400,
    bottom: 320,
    right: 460,
    width: 60,
    height: 20,
  };
  let rectCalls = 0;
  trigger.getBoundingClientRect = () => {
    rectCalls += 1;
    // 1 回目（表示時）は initialRect、2 回目以降（再配置時）は scrolledRect。
    return rectCalls === 1 ? initialRect : scrolledRect;
  };

  // Act: トリガを click して表示（初回配置は initialRect で行われる）。
  trigger.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "click 後に共有 .riddle-popover が生成されているべき");

  // 初回配置の座標（initialRect 由来）を確認しておく＝再配置前のスナップショット。
  const initialPos = computePopoverPosition({
    triggerRect: initialRect,
    popWidth: POP_WIDTH,
    popHeight: POP_HEIGHT,
    viewportWidth: 1000,
    viewportHeight: 800,
  });
  assert.equal(
    popover.style.top,
    `${initialPos.top}px`,
    "表示直後は initialRect 由来の top が適用されているべき",
  );

  // Act: scroll を発火させる（追従リスナが schedule を呼び、rAF が呼ばれるはず）。
  const rafBefore = rafCallbacks.length;
  win.dispatchEvent(new win.Event("scroll"));

  // Assert: scroll 発火で requestAnimationFrame が（少なくとも 1 回）呼ばれている。
  assert.ok(
    rafCallbacks.length > rafBefore,
    "scroll 発火で requestAnimationFrame が呼ばれているべき（再配置スケジュール）",
  );

  // Act: 捕捉した rAF コールバックを手動実行する（jsdom は rAF を回さないため）。
  const callback = rafCallbacks[rafCallbacks.length - 1];
  callback();

  // Assert: 再配置で scrolledRect 由来の新しい座標へ popover.style.top/left が更新されている。
  const repositioned = computePopoverPosition({
    triggerRect: scrolledRect,
    popWidth: POP_WIDTH,
    popHeight: POP_HEIGHT,
    viewportWidth: 1000,
    viewportHeight: 800,
  });
  assert.equal(
    popover.style.top,
    `${repositioned.top}px`,
    "rAF コールバック内の再配置で scrolledRect 由来の top へ更新されているべき",
  );
  assert.equal(
    popover.style.left,
    `${repositioned.left}px`,
    "rAF コールバック内の再配置で scrolledRect 由来の left へ更新されているべき",
  );
});

// 境界（配線・t5）: 別トリガへ切替表示するとき、古い scroll/resize リスナが
// removeEventListener で解除されてから新トリガ用に再登録され、リスナが多重登録・
// リークしない。doc.defaultView の add/remove を spy し、同種 'scroll'/'resize' の
// 純増（登録回数 − 解除回数）が高々 1 組であることを検証する。
// （createRepositionScheduler 単体の rAF スロットルとは別に、ここでは「切替時に
//  古いリスナが確実に外れる」配線＝リークしないことを確認する。）
test("境界: 別トリガへ切替表示しても古い scroll/resize リスナが解除され純増は高々1組（リークしない）", () => {
  // Arrange: 複数トリガの DOM 契約を組み、委譲リスナを張る。
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const win = doc.defaultView;
  Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
  const proto = win.HTMLElement.prototype;
  Object.defineProperty(proto, "offsetWidth", { value: 300, configurable: true });
  Object.defineProperty(proto, "offsetHeight", { value: 150, configurable: true });

  // 全トリガに既知 rect を与えて表示処理が例外なく通るようにする。
  for (const a of doc.querySelectorAll("a.t")) {
    a.getBoundingClientRect = () => ({
      top: 100,
      left: 200,
      bottom: 120,
      right: 260,
      width: 60,
      height: 20,
    });
  }

  // window の add/remove を spy し、scroll/resize の登録・解除回数を別々に数える。
  const added = { scroll: 0, resize: 0 };
  const removed = { scroll: 0, resize: 0 };
  const originalAdd = win.addEventListener.bind(win);
  const originalRemove = win.removeEventListener.bind(win);
  win.addEventListener = (type, listener, options) => {
    if (type === "scroll" || type === "resize") {
      added[type] += 1;
    }
    return originalAdd(type, listener, options);
  };
  win.removeEventListener = (type, listener, options) => {
    if (type === "scroll" || type === "resize") {
      removed[type] += 1;
    }
    return originalRemove(type, listener, options);
  };

  const { MouseEvent } = win;
  const clickTrigger = (selector) => {
    doc
      .querySelector(selector)
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  };

  // Act: トリガ A（term-0）を表示 → 別トリガ B（term-1）へ切替表示。
  clickTrigger('a[href="#term-0"]');
  clickTrigger('a[href="../index.html#term-1"]');

  // Assert: 切替時に古いリスナが外れている。scroll の純増（add − remove）が高々 1。
  assert.ok(
    added.scroll - removed.scroll <= 1,
    `scroll リスナが多重登録・リークしている（add=${added.scroll}, remove=${removed.scroll}）`,
  );
  // Assert: resize の純増（add − remove）が高々 1。
  assert.ok(
    added.resize - removed.resize <= 1,
    `resize リスナが多重登録・リークしている（add=${added.resize}, remove=${removed.resize}）`,
  );
  // Assert: 切替で古いリスナの解除が実際に呼ばれている（A 表示 → B 切替で各1回以上）。
  assert.ok(
    removed.scroll >= 1,
    "別トリガ切替時に古い scroll リスナが removeEventListener で解除されているべき",
  );
  assert.ok(
    removed.resize >= 1,
    "別トリガ切替時に古い resize リスナが removeEventListener で解除されているべき",
  );
});

const closeRepositionCases = [
  {
    name: "外側クリック",
    close: (doc, win) => {
      doc.body.dispatchEvent(
        new win.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    },
  },
  {
    name: "Esc",
    close: (doc, win) => {
      doc.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    },
  },
];

for (const { name, close } of closeRepositionCases) {
  test(`境界: ${name}で閉じると scroll/resize 追従リスナが解除され純増0になる`, () => {
    // Arrange: 表示時に scroll/resize リスナが登録される DOM 契約を組む。
    const doc = docWithTriggers();
    const win = doc.defaultView;
    Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
    const proto = win.HTMLElement.prototype;
    Object.defineProperty(proto, "offsetWidth", { value: 300, configurable: true });
    Object.defineProperty(proto, "offsetHeight", { value: 150, configurable: true });
    const trigger = doc.querySelector('a[href="#term-0"]');
    trigger.getBoundingClientRect = () => ({
      top: 100,
      left: 200,
      bottom: 120,
      right: 260,
      width: 60,
      height: 20,
    });

    const added = { scroll: 0, resize: 0 };
    const removed = { scroll: 0, resize: 0 };
    const originalAdd = win.addEventListener.bind(win);
    const originalRemove = win.removeEventListener.bind(win);
    win.addEventListener = (type, listener, options) => {
      if (type === "scroll" || type === "resize") {
        added[type] += 1;
      }
      return originalAdd(type, listener, options);
    };
    win.removeEventListener = (type, listener, options) => {
      if (type === "scroll" || type === "resize") {
        removed[type] += 1;
      }
      return originalRemove(type, listener, options);
    };

    installRiddlePopover(doc, { trigger: "click" });
    trigger.dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    // Act: 表示中の popover を閉じる。
    close(doc, win);

    // Assert: 表示時に張った scroll/resize リスナが閉じる時点で完全に解除される。
    assert.equal(added.scroll, 1, "表示時に scroll リスナが1回登録されるべき");
    assert.equal(added.resize, 1, "表示時に resize リスナが1回登録されるべき");
    assert.equal(removed.scroll, 1, "閉じる時に scroll リスナが解除されるべき");
    assert.equal(removed.resize, 1, "閉じる時に resize リスナが解除されるべき");
    assert.equal(added.scroll - removed.scroll, 0, "scroll リスナの純増は0であるべき");
    assert.equal(added.resize - removed.resize, 0, "resize リスナの純増は0であるべき");
  });
}

// 異常（配線・t6・fail-safe）: doc.defaultView（window）が無いケースでも、
// click ハンドラは例外を出さず、走査済み fragment の挿入と hidden 解除までは行い、
// 配置・追従配線（positionPopover / attachRepositionListeners）は安全にスキップする。
// view が無いと getBoundingClientRect/innerWidth/addEventListener へ到達できないため、
// 座標適用（popover.style.top/left）は行われず未設定のままであることを検証する
// （実描画は #24 へ委譲。ここでは「view 不在でも壊れず・配置だけ飛ばす」fail-safe 配線を見る）。
test("異常（fail-safe）: doc.defaultView が無くても例外を出さず挿入と hidden 解除は行い配置はスキップする", () => {
  // Arrange: DOM 契約を組み委譲リスナを張る。dispatch 用に MouseEvent を退避してから
  // doc.defaultView を null へ差し替える（window 不在の異常環境を再現）。
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const { MouseEvent } = doc.defaultView;
  const trigger = doc.querySelector('a[href="#term-0"]');
  Object.defineProperty(doc, "defaultView", { value: null, configurable: true });

  // Act: トリガを click。view 不在でもハンドラから例外が漏れないこと自体を検証対象にする。
  assert.doesNotThrow(() => {
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }, "doc.defaultView 不在の click でハンドラから例外が漏れてはならない");

  // Assert: 挿入と hidden 解除までは行われる（fail-safe で表示自体は止めない）。
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(
    popover,
    null,
    "defaultView 不在でも共有 .riddle-popover は生成されるべき",
  );
  assert.equal(
    popover.textContent.includes("定義0"),
    true,
    "defaultView 不在でも term-0 の template 内容（定義0）が挿入されているべき",
  );
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "defaultView 不在でも click 後の popover は hidden が外れているべき",
  );

  // Assert: 配置はスキップされ、座標（style.top/left）は適用されず未設定のまま。
  assert.equal(
    popover.style.top,
    "",
    "defaultView 不在では配置をスキップし popover.style.top は未設定のままであるべき",
  );
  assert.equal(
    popover.style.left,
    "",
    "defaultView 不在では配置をスキップし popover.style.left は未設定のままであるべき",
  );
});

// 異常（fail-safe・t7）: トリガの getBoundingClientRect が呼ぶと例外を投げるケースでも、
// click ハンドラはその例外を内部で受け止め、配置だけをスキップして表示の後続処理を継続する。
// 「例外漏れの有無」は jsdom の dispatchEvent がリスナ例外を内部で握り潰す（reportException）
// ため doesNotThrow では観測できない。代わりに、例外で後続が中断していないことを
// 「scroll/resize 追従リスナの登録（配置の後段で行う処理）が実行された」で観測する。
test("異常（fail-safe）: トリガの getBoundingClientRect が例外を投げても表示の後続（scroll/resize 追従の登録）まで継続する", () => {
  // Arrange: DOM 契約を組み委譲リスナを張る。window の addEventListener を spy で包み、
  // scroll/resize の登録（配置より後段の処理）が行われるかを記録する。
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const { MouseEvent } = doc.defaultView;
  const win = doc.defaultView;
  const followTypes = [];
  const originalAdd = win.addEventListener.bind(win);
  win.addEventListener = (type, listener, options) => {
    if (type === "scroll" || type === "resize") {
      followTypes.push(type);
    }
    return originalAdd(type, listener, options);
  };

  // トリガの getBoundingClientRect を「呼ぶと throw する」関数へ差し替え、
  // 配置経路で例外が起きる異常環境を再現する。
  const trigger = doc.querySelector('a[href="#term-0"]');
  trigger.getBoundingClientRect = () => {
    throw new Error("getBoundingClientRect は失敗する");
  };

  // Act: トリガを click。
  trigger.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 配置で例外が起きても挿入と hidden 解除までは行われる（表示は止めない）。
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(
    popover,
    null,
    "getBoundingClientRect が throw しても共有 .riddle-popover は生成されるべき",
  );
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "getBoundingClientRect が throw しても click 後の popover は hidden が外れているべき",
  );

  // Assert（load-bearing）: 配置で例外が起きても後続の scroll/resize 追従登録まで到達する。
  // 現実装は positionPopover を try/catch せず呼ぶため、ここで例外が中断し
  // attachRepositionListeners へ到達せず scroll/resize が登録されない（=Red）。
  assert.ok(
    followTypes.includes("scroll"),
    "配置例外を握り潰して後続の scroll 追従リスナ登録まで継続すべき（fail-safe）",
  );
  assert.ok(
    followTypes.includes("resize"),
    "配置例外を握り潰して後続の resize 追従リスナ登録まで継続すべき（fail-safe）",
  );
});

// セキュリティ（t14・走査の結合 E2E）: 敵対 template（img onerror / svg onload /
// a href=javascript: / script / iframe / base を混在）が委譲経路（document への
// 単一 click リスナ → term-id 導出 → template 取得 → clone と二次防御走査 →
// 共有 .riddle-popover へ一括挿入）で挿入されても、挿入後の .riddle-popover 内に
// on* 属性・危険要素・危険スキーム href が 0 件であることを検証する。
// 攻撃ペイロードは innerHTML 代入や bare な javascript: 文字列リテラルを使わず、
// JSDOM コンストラクタの HTML 文字列の部分文字列として埋め込む
// （no-unsanitized / no-script-url を回避）。
test("セキュリティ: 敵対 template が委譲経路で挿入されても popover 内に on*・危険要素・危険スキームが 0 件", () => {
  // Arrange: 敵対ペイロードを混入させた template を持つ DOM 契約を JSDOM で組む。
  // a の href には危険スキームを与えたいが、HTML リテラルの内部に埋めることで
  // no-script-url を回避する（リテラル先頭が javascript: でなければ発火しない）。
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0">' +
      "<p>定義" +
      '<img src="../pic.png" onerror="window.x=1" alt="x">' +
      '<svg onload="window.y=1"></svg>' +
      '<a href="javascript:window.z=1">わな</a>' +
      "<script>window.s=1</script>" +
      '<iframe src="../evil.html"></iframe>' +
      '<base href="../">' +
      "</p>" +
      "</template>" +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc);
  const trigger = doc.querySelector('a[href="#term-0"]');
  const { MouseEvent } = doc.defaultView;

  // Act: トリガを実 click（document への委譲リスナが拾い、走査済み fragment を挿入）。
  trigger.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 挿入先の共有 .riddle-popover を取得（生成・表示されているはず）。
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "敵対 template でも popover 自体は挿入されるべき");

  // Assert（最重要）: popover 内に危険要素が 1 つも残っていない。
  assert.equal(
    popover.querySelectorAll("script, iframe, base, object, embed, form, style")
      .length,
    0,
    "危険要素が走査後の popover 内に残っている",
  );

  // Assert: on* イベント属性を持つ要素が 1 つも残っていない。
  assert.equal(
    popover.querySelectorAll("[onerror], [onload], [onclick], [onmouseover]")
      .length,
    0,
    "on* イベント属性が走査後の popover 内に残っている",
  );

  // Assert: 危険スキーム（javascript:）の href を持つ a が残っていない。
  for (const a of popover.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    assert.equal(
      href === null || /^\s*javascript:/i.test(href),
      href === null,
      "危険スキーム javascript: の href が走査後の popover 内に残っている",
    );
  }
});

// セキュリティ（配線・t8）: 座標適用は CSSOM プロパティ（el.style.top / el.style.left）
// のみを経由し、popover.setAttribute('style', …) と popover.style.cssText 代入を
// 一切使わない。インライン style を属性丸ごと（setAttribute）や cssText で書く経路は
// CSP style-src の文字列ブロックや既存スタイルの上書き事故の原因になるため禁止する。
// trigger の getBoundingClientRect・popover 寸法・ビューポート寸法を既知値へ固定し、
// 配置が確実に実行される状況で、popover の setAttribute と cssText setter を spy して
// style 経由の設定が呼ばれないことを担保する（top/left は CSSOM プロパティで書かれる）。
test("セキュリティ: 座標適用は CSSOM プロパティ経由のみで setAttribute('style') と style.cssText を使わない", () => {
  // Arrange: DOM 契約を組み、ビューポート寸法・トリガ rect・popover 寸法を既知値へ固定する
  const doc = docWithTriggers();
  installRiddlePopover(doc);
  const win = doc.defaultView;
  Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });

  const proto = win.HTMLElement.prototype;
  Object.defineProperty(proto, "offsetWidth", { value: 300, configurable: true });
  Object.defineProperty(proto, "offsetHeight", { value: 150, configurable: true });

  const trigger = doc.querySelector('a[href="#term-0"]');
  trigger.getBoundingClientRect = () => ({
    top: 100,
    left: 200,
    bottom: 120,
    right: 260,
    width: 60,
    height: 20,
  });

  // popover を先に生成して spy を仕込む（getPopover は無ければ生成しキャッシュするので、
  // ここで生成した同一インスタンスが click 時に使い回される）。
  const popover = doc.createElement("div");
  popover.className = "riddle-popover";
  popover.setAttribute("hidden", "");
  doc.body.appendChild(popover);

  // setAttribute を spy で包み、'style' 属性丸ごとの設定が呼ばれたら記録する。
  const styleAttrSets = [];
  const originalSetAttribute = popover.setAttribute.bind(popover);
  popover.setAttribute = (name, value) => {
    if (String(name).toLowerCase() === "style") {
      styleAttrSets.push(value);
    }
    return originalSetAttribute(name, value);
  };

  // style.cssText setter を spy で包み、代入が呼ばれたら記録する。
  const cssTextSets = [];
  const styleObj = popover.style;
  let cssTextDescriptor = null;
  for (
    let current = styleObj;
    current !== null;
    current = Object.getPrototypeOf(current)
  ) {
    cssTextDescriptor = Object.getOwnPropertyDescriptor(current, "cssText");
    if (cssTextDescriptor !== undefined) {
      break;
    }
  }
  const originalCssTextSet =
    typeof cssTextDescriptor?.set === "function"
      ? cssTextDescriptor.set.bind(styleObj)
      : null;
  const originalCssTextGet =
    typeof cssTextDescriptor?.get === "function"
      ? cssTextDescriptor.get.bind(styleObj)
      : null;
  let fallbackCssText = String(styleObj.cssText ?? "");
  Object.defineProperty(styleObj, "cssText", {
    configurable: true,
    get: () => originalCssTextGet?.() ?? fallbackCssText,
    set: (value) => {
      cssTextSets.push(value);
      if (originalCssTextSet !== null) {
        originalCssTextSet(value);
      } else {
        fallbackCssText = String(value);
      }
    },
  });

  // Act: トリガを実 click（委譲リスナが表示・配置を実行する）。
  trigger.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 座標は CSSOM プロパティで書かれており top/left に px が入っている（配置が実行された証跡）。
  assert.ok(
    /px$/.test(popover.style.top) && /px$/.test(popover.style.left),
    "配置が実行され popover.style.top/left に px 付きで座標が入っているべき（前提）",
  );

  // Assert（最重要）: style 属性丸ごとの setAttribute('style', …) は一切呼ばれていない。
  assert.equal(
    styleAttrSets.length,
    0,
    "座標適用で popover.setAttribute('style', …) を使ってはならない（CSSOM プロパティ経由のみ）",
  );

  // Assert（最重要）: style.cssText への代入も一切行われていない。
  assert.equal(
    cssTextSets.length,
    0,
    "座標適用で popover.style.cssText 代入を使ってはならない（CSSOM プロパティ経由のみ）",
  );
});

// #20 単一タイマー（t1・異常系）用の制御可能な fake timer ハーネスを作る。
// setTimeout/clearTimeout を installRiddlePopover に依存注入し、保留中タイマー数・
// clearTimeout 呼び出し回数を観測しつつ、tick() で任意に発火させて実時間に依存させない。
function makeFakeTimers() {
  let nextId = 1;
  // 保留中タイマー（id -> {callback, delay}）。clearTimeout で消える。
  const pending = new Map();
  let clearCount = 0;
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      clearCount++;
      pending.delete(id);
    },
    // 観測用: 現在保留中のタイマー数。
    pendingCount() {
      return pending.size;
    },
    // 観測用: clearTimeout が呼ばれた累計回数。
    clearCount() {
      return clearCount;
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

// 異常系（t1）: trigger='hover' で open 保留中に別イベントが来ると、既存の保留タイマーが
// clearTimeout され、保留タイマーが二重に走らず、時間経過後に open はちょうど一度だけ起きる。
test("単一タイマー: open 保留中に別イベントが来ると既存タイマーが clearTimeout され二重発火せず最終的に一度だけ開く", () => {
  // Arrange: DOM 契約を組み、fake timer を注入して hover トリガで委譲リスナを張る。
  const doc = docWithTriggers();
  const timers = makeFakeTimers();
  installRiddlePopover(doc, {
    trigger: "hover",
    openDelayMs: 150,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const trigger = doc.querySelector('a[href="#term-0"]');
  const { MouseEvent } = doc.defaultView;
  const enter = () =>
    trigger.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: false, cancelable: true }),
    );

  // Act 1: 1 回目の mouseenter で open タイマーが 1 本だけ張られる（まだ開かない）。
  enter();
  assert.equal(
    timers.pendingCount(),
    1,
    "mouseenter 1 回で open タイマーは 1 本だけ保留されるべき（遅延前なので未表示）",
  );
  assert.equal(
    doc.querySelector(".riddle-popover") === null ||
      doc.querySelector(".riddle-popover").hasAttribute("hidden"),
    true,
    "openDelay 経過前は popover はまだ表示されていないべき",
  );

  // Act 2: open 保留中に 2 回目の mouseenter（連打）。既存タイマーを clearTimeout して張り直す。
  enter();
  assert.ok(
    timers.clearCount() >= 1,
    "open 保留中の再イベントでは既存の保留タイマーを clearTimeout すべき（タイマーリーク防止）",
  );
  assert.equal(
    timers.pendingCount(),
    1,
    "再イベント後も保留タイマーは 1 本だけ（open タイマーが二重に走ってはならない）",
  );

  // Act 3: 時間経過（保留中タイマーをすべて発火）。
  timers.tick();

  // Assert: open はちょうど一度だけ起き、popover が単一・表示状態になっている。
  const popovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(popovers.length, 1, "open は一度だけで共有 popover はちょうど 1 つであるべき");
  assert.equal(
    popovers[0].hasAttribute("hidden"),
    false,
    "openDelay 経過後に popover は表示状態（hidden が外れている）であるべき",
  );
});

// 異常系（t2）: trigger='hover' で表示中、トリガからの mouseleave で close が遅延予約された
// 後（close 保留中）に、再び open 起点イベント（mouseenter）が来ると、その close タイマーが
// clearTimeout され、最終的に時間経過しても popover は閉じない（open/close タイマーが同時に
// 二重起動せず、単一タイマー状態で管理される）。
test("単一タイマー: close 保留中に再度 open 起点イベントが来ると close タイマーが clearTimeout されポップは閉じない", () => {
  // Arrange: DOM 契約を組み、fake timer を注入して hover トリガで委譲リスナを張る。
  const doc = docWithTriggers();
  const timers = makeFakeTimers();
  installRiddlePopover(doc, {
    trigger: "hover",
    openDelayMs: 150,
    closeDelayMs: 100,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const trigger = doc.querySelector('a[href="#term-0"]');
  const { MouseEvent } = doc.defaultView;
  const enter = () =>
    trigger.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: false, cancelable: true }),
    );
  const leave = () =>
    trigger.dispatchEvent(
      new MouseEvent("mouseleave", { bubbles: false, cancelable: true }),
    );

  // Arrange: まず開いた状態にする（mouseenter → openDelay 経過で表示）。
  enter();
  timers.tick();
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "前提: 表示処理で共有 popover が生成されているべき");
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "前提: 開いた直後は popover が表示状態であるべき",
  );

  // Act 1: トリガから mouseleave で close を遅延予約する（close 保留中・まだ閉じない）。
  leave();
  assert.equal(
    timers.pendingCount(),
    1,
    "mouseleave で close タイマーが 1 本だけ保留されるべき（closeDelay 経過前なので未クローズ）",
  );
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "closeDelay 経過前は popover はまだ閉じていないべき",
  );

  // Act 2: close 保留中に再び mouseenter（戻ってきた）。既存の close タイマーを clearTimeout する。
  const clearBefore = timers.clearCount();
  enter();
  assert.ok(
    timers.clearCount() > clearBefore,
    "close 保留中の再 open イベントでは保留中の close タイマーを clearTimeout すべき（二重起動防止）",
  );

  // Act 3: 時間経過（保留中タイマーをすべて発火）。
  timers.tick();

  // Assert（最重要）: close タイマーは取り消されたので popover は閉じていない（表示のまま）。
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "close 保留中に再 open イベントが来た場合、close は取り消され popover は閉じないべき",
  );
});

// 正常系（t3・テーブル駆動）: trigger='hover' で「開く起点イベント → openDelay 経過 →
// hidden が外れる（開く）」「閉じる起点イベント → closeDelay 経過 → hidden が付く（閉じる）」
// という同一の状態遷移を、開閉イベント対 (mouseenter/mouseleave) と (focusin/blur) の双方で検証する。
// fake timer を進めて遷移を観測し実時間に依存しない（実フォーカス移動・実ホバーは #24 へ委譲）。
const openCloseEventPairs = [
  { name: "mouseenter/mouseleave", openType: "mouseenter", closeType: "mouseleave" },
  { name: "focusin/blur", openType: "focusin", closeType: "blur" },
];

for (const { name, openType, closeType } of openCloseEventPairs) {
  test(`hover 遷移: ${name} で openDelay 経過後に開き(hidden 解除)、closeDelay 経過後に閉じる(hidden 付与)`, () => {
    // Arrange: DOM 契約を組み、fake timer を注入して hover トリガで委譲リスナを張る。
    const doc = docWithTriggers();
    const timers = makeFakeTimers();
    installRiddlePopover(doc, {
      trigger: "hover",
      openDelayMs: 150,
      closeDelayMs: 100,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const trigger = doc.querySelector('a[href="#term-0"]');
    const view = doc.defaultView;
    const dispatch = (type) =>
      trigger.dispatchEvent(
        new view.Event(type, { bubbles: false, cancelable: true }),
      );

    // Act 1: 開く起点イベント。openDelay 経過前はまだ開かない。
    dispatch(openType);
    assert.equal(
      doc.querySelector(".riddle-popover") === null ||
        doc.querySelector(".riddle-popover").hasAttribute("hidden"),
      true,
      `${openType} 直後（openDelay 経過前）は popover はまだ開いていないべき`,
    );

    // Act 2: openDelay 経過（保留タイマー発火）→ 開く（hidden が外れる）。
    timers.tick();
    const popover = doc.querySelector(".riddle-popover");
    assert.notEqual(popover, null, "open 後は共有 popover が存在すべき");
    assert.equal(
      popover.hasAttribute("hidden"),
      false,
      `${openType} → openDelay 経過後に popover は表示状態（hidden が外れている）であるべき`,
    );

    // Act 3: 閉じる起点イベント。closeDelay 経過前はまだ閉じない。
    dispatch(closeType);
    assert.equal(
      popover.hasAttribute("hidden"),
      false,
      `${closeType} 直後（closeDelay 経過前）は popover はまだ閉じていないべき`,
    );

    // Act 4: closeDelay 経過（保留タイマー発火）→ 閉じる（hidden が付く）。
    timers.tick();
    assert.equal(
      popover.hasAttribute("hidden"),
      true,
      `${closeType} → closeDelay 経過後に popover は閉状態（hidden が付いている）であるべき`,
    );
  });
}

// 境界（t4・テーブル駆動）: トリガ種別ゲート。trigger='hover'｜'click'｜'both' に対し、
// 開く起点となるイベント（click / mouseenter / focusin）が「その種別で開くべきか」を検証する。
//   - 'hover': click では開かず、mouseenter/focusin（hover/focus 起点）で開く。
//   - 'click': mouseenter/focusin（hover 起点）では開かず、click でのみ開く。
//   - 'both' : click でも mouseenter でも focusin でも開く。
// fake timer を注入し、イベント発火後に tick() してから hidden 状態で開閉を判定する
// （hover/focus 系は openDelay 経由・click は #17 既存経路で即時 open のため、いずれも
//  tick() を挟めば「開くべきケースは hidden が外れ・開かないべきケースは未表示」で観測できる）。
// 実フォーカス移動・実ホバーは #24 Playwright へ委譲し、ここでは状態遷移のみ検証する。
const triggerGateCases = [
  // trigger='hover'
  { trigger: "hover", eventType: "click", shouldOpen: false },
  { trigger: "hover", eventType: "mouseenter", shouldOpen: true },
  { trigger: "hover", eventType: "focusin", shouldOpen: true },
  // trigger='click'
  { trigger: "click", eventType: "click", shouldOpen: true },
  { trigger: "click", eventType: "mouseenter", shouldOpen: false },
  { trigger: "click", eventType: "focusin", shouldOpen: false },
  // trigger='both'
  { trigger: "both", eventType: "click", shouldOpen: true },
  { trigger: "both", eventType: "mouseenter", shouldOpen: true },
  { trigger: "both", eventType: "focusin", shouldOpen: true },
];

for (const { trigger, eventType, shouldOpen } of triggerGateCases) {
  const verb = shouldOpen ? "開く" : "開かない";
  test(`トリガ種別ゲート: trigger='${trigger}' で ${eventType} は ${verb}`, () => {
    // Arrange: DOM 契約を組み、fake timer を注入して当該 trigger 種別で委譲リスナを張る。
    const doc = docWithTriggers();
    const timers = makeFakeTimers();
    installRiddlePopover(doc, {
      trigger,
      openDelayMs: 150,
      closeDelayMs: 100,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const triggerEl = doc.querySelector('a[href="#term-0"]');
    const view = doc.defaultView;
    const EventCtor = eventType === "click" ? view.MouseEvent : view.Event;

    // Act: 開く起点イベントを発火し、（遅延経由のケースに備えて）保留タイマーを発火する。
    triggerEl.dispatchEvent(
      new EventCtor(eventType, { bubbles: eventType === "click", cancelable: true }),
    );
    timers.tick();

    // Assert: この (trigger, eventType) の組で開くべきか否かを hidden 状態で判定する。
    const popover = doc.querySelector(".riddle-popover");
    const isOpen = popover !== null && !popover.hasAttribute("hidden");
    assert.equal(
      isOpen,
      shouldOpen,
      `trigger='${trigger}' のとき ${eventType} は ${verb}べき（開いている=${isOpen}）`,
    );
  });
}

// セキュリティ（t5・再帰防止・テーブル駆動）: nested: false（v1.0.0 相当）では、
// 共有 .riddle-popover 配下のトリガリンク（a[href*='#term-']）は click / hover とも
// 常に不活性で、別 term のポップを新規に開かない（委譲リスナで event.target が
// .riddle-popover 配下なら無視する）。nested 有効（既定）時のポップ内 term 挙動
// （レベル2ネスト表示）は tests/js/nested-popover.test.mjs が検証する。
//
// 観測方法: 共有 .riddle-popover を「閉じた状態（hidden）」で先に用意し、その配下へ
// term-1 を指すリンクを置く。本文側トリガ（term-0）には触れず、ポップ内リンクへ
// click / mouseenter を発火 → tick() して状態を確認する。再帰防止が効いていれば、
// popover は hidden のまま・中身は term-1 の定義へ差し替わらない。
const recursionGuardCases = [
  { eventType: "click", bubbles: true },
  { eventType: "mouseenter", bubbles: false },
];

for (const { eventType, bubbles } of recursionGuardCases) {
  test(`再帰防止(nested無効): .riddle-popover 配下のトリガリンクへの ${eventType} では新規に開かない`, () => {
    // Arrange: 本文トリガ（term-0）と定義 template に加え、共有 .riddle-popover を
    // 「閉じた状態（hidden）」で用意し、その配下に term-1 を指すリンクを置く。
    const dom = new JSDOM(
      "<!DOCTYPE html><body>" +
        '<a class="t" href="#term-0">用語0</a>' +
        '<template id="riddle-tip--term-0"><p>定義0</p></template>' +
        '<template id="riddle-tip--term-1"><p>定義1</p></template>' +
        '<div class="riddle-popover" hidden>' +
        '<a class="inner" href="#term-1">用語1へのポップ内リンク</a>' +
        "</div>" +
        "</body>",
    );
    const doc = dom.window.document;
    const timers = makeFakeTimers();
    installRiddlePopover(doc, {
      trigger: "both",
      openDelayMs: 150,
      closeDelayMs: 100,
      nested: false,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const innerLink = doc.querySelector(".riddle-popover a.inner");
    const view = doc.defaultView;
    const EventCtor = eventType === "click" ? view.MouseEvent : view.Event;

    // Act: ポップ内リンクへイベントを発火し、（遅延経由に備え）保留タイマーを発火する。
    innerLink.dispatchEvent(
      new EventCtor(eventType, { bubbles, cancelable: true }),
    );
    timers.tick();

    // Assert 1: 共有 .riddle-popover はちょうど 1 つ・hidden のまま（新規に開いていない）。
    const popovers = doc.querySelectorAll(".riddle-popover");
    assert.equal(popovers.length, 1, "共有 .riddle-popover はちょうど 1 つであるべき");
    assert.equal(
      popovers[0].hasAttribute("hidden"),
      true,
      `ポップ内リンクへの ${eventType} では popover を開いてはならない（hidden のまま）`,
    );

    // Assert 2: 中身が term-1 の定義（"定義1"）へ差し替わっていない（再帰挿入が起きていない）。
    assert.equal(
      /定義1/.test(popovers[0].textContent),
      false,
      `ポップ内リンクへの ${eventType} で別 term の定義が再帰的に挿入されてはならない`,
    );
  });
}

// 正常系（t6・閉じる制御・テーブル駆動）: 開いた状態から、以下の「閉じる起点」で
// それぞれ popover が閉じる（hidden が付く）ことを検証する。
//   - Esc キー（document への keydown で key==='Escape'）
//   - ポップ／トリガの「外側」クリック（popover でもトリガでもない要素への click）
//   - トリガからの blur
// 共通形: trigger='both' で開いた状態を作り、各閉じる起点イベントを発火 → tick() して
// hidden 状態を確認する（即時クローズ・遅延クローズのどちらでも観測できるよう tick を挟む）。
// 実フォーカス移動・実ポインタ挙動は #24 Playwright へ委譲し、ここでは状態遷移のみ検証する。
function docWithTriggersAndOutside() {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>' +
      '<p id="outside">ポップでもトリガでもない外側の要素</p>' +
      "</body>",
  );
  return dom.window.document;
}

const closeTriggerCases = [
  { name: "Esc キー（keydown Escape）", kind: "escape" },
  { name: "ポップ/トリガ外の外側クリック", kind: "outsideClick" },
  { name: "トリガからの blur", kind: "blur" },
];

for (const { name, kind } of closeTriggerCases) {
  test(`閉じる制御: 開いた状態から ${name} で popover が閉じる（hidden が付く）`, () => {
    // Arrange: DOM 契約＋外側要素を組み、fake timer を注入して both トリガで委譲リスナを張る。
    const doc = docWithTriggersAndOutside();
    const timers = makeFakeTimers();
    installRiddlePopover(doc, {
      trigger: "both",
      openDelayMs: 150,
      closeDelayMs: 100,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const trigger = doc.querySelector('a[href="#term-0"]');
    const view = doc.defaultView;
    const { MouseEvent, KeyboardEvent, Event } = view;

    // Arrange: まず開いた状態にする（click で #17 既存経路から即時 open）。
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    timers.tick();
    const popover = doc.querySelector(".riddle-popover");
    assert.notEqual(popover, null, "前提: 表示処理で共有 popover が生成されているべき");
    assert.equal(
      popover.hasAttribute("hidden"),
      false,
      "前提: 閉じる起点を発火する前は popover が表示状態であるべき",
    );

    // Act: 当該の閉じる起点イベントを発火し、（遅延クローズに備え）保留タイマーを発火する。
    if (kind === "escape") {
      doc.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    } else if (kind === "outsideClick") {
      doc
        .getElementById("outside")
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    } else {
      trigger.dispatchEvent(new Event("blur", { bubbles: false, cancelable: true }));
    }
    timers.tick();

    // Assert: popover は閉状態（hidden が付いている）。
    assert.equal(
      popover.hasAttribute("hidden"),
      true,
      `${name} で popover は閉状態（hidden が付いている）であるべき`,
    );
  });
}

// 境界（t7・閉じない制御・テーブル駆動）: t6 の「外側クリックで閉じる」の境界として、
// 「外側でないクリック」では開状態を維持する（閉じない）ことを検証する。外側でないクリックとは:
//   - popover 内（.riddle-popover の子孫要素）への click
//   - トリガ自身への click（トリガ click は開く経路であって閉じる経路ではない）
// 共通形: trigger='both' で開いた状態を作り、各「外側でない」要素へ click → tick() して
// hidden が付いていない（＝開いたまま）ことを確認する。
// 実ポインタ挙動は #24 Playwright へ委譲し、ここでは状態遷移（開状態の維持）のみ検証する。
const notOutsideClickCases = [
  { name: "popover 内（定義テキスト）への click", target: "popoverContent" },
  { name: "トリガ自身への click", target: "trigger" },
];

for (const { name, target } of notOutsideClickCases) {
  test(`閉じない制御: 開いた状態から ${name} では popover は閉じず開状態を維持する`, () => {
    // Arrange: DOM 契約＋外側要素を組み、fake timer を注入して both トリガで委譲リスナを張る。
    const doc = docWithTriggersAndOutside();
    const timers = makeFakeTimers();
    installRiddlePopover(doc, {
      trigger: "both",
      openDelayMs: 150,
      closeDelayMs: 100,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const trigger = doc.querySelector('a[href="#term-0"]');
    const view = doc.defaultView;
    const { MouseEvent } = view;
    const click = (el) =>
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Arrange: まず開いた状態にする（click で #17 既存経路から即時 open）。
    click(trigger);
    timers.tick();
    const popover = doc.querySelector(".riddle-popover");
    assert.notEqual(popover, null, "前提: 表示処理で共有 popover が生成されているべき");
    assert.equal(
      popover.hasAttribute("hidden"),
      false,
      "前提: 外側でないクリックを発火する前は popover が表示状態であるべき",
    );

    // Act: 「外側でない」要素へ click し、（遅延クローズに備え）保留タイマーを発火する。
    //   - popoverContent: popover の子孫要素（定義の中身）への click
    //   - trigger: トリガ自身への click
    if (target === "popoverContent") {
      const inner = popover.querySelector("*") ?? popover;
      click(inner);
    } else {
      click(trigger);
    }
    timers.tick();

    // Assert（最重要）: popover は閉じず開状態のまま（hidden が付いていない）。
    assert.equal(
      popover.hasAttribute("hidden"),
      false,
      `${name} では popover を閉じてはならない（hidden が付かず開状態を維持すべき）`,
    );
  });
}

// 正常系（t8・interactive=true）: hover で開いた状態からトリガを mouseleave すると
// close が遅延予約される（close 保留中）。interactive=true のときは、その保留中に
// popover への mouseenter が来ると保留中の close タイマーが clearTimeout され、時間が
// 経過しても popover は閉じない（開いたまま）。その後 popover からの mouseleave で
// 改めて close が遅延予約され、closeDelayMs 経過（tick）で閉じる（hidden が付く）。
// 実ポインタの実ホバー挙動は #24 Playwright へ委譲し、ここでは状態遷移のみ検証する。
test("interactive: トリガ mouseleave の close 保留中に popover への mouseenter で close が取り消され開いたまま、popover mouseleave で閉じる", () => {
  // Arrange: DOM 契約を組み、fake timer を注入して interactive=true・hover で委譲リスナを張る。
  const doc = docWithTriggers();
  const timers = makeFakeTimers();
  installRiddlePopover(doc, {
    trigger: "hover",
    openDelayMs: 150,
    closeDelayMs: 100,
    interactive: true,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const trigger = doc.querySelector('a[href="#term-0"]');
  const { MouseEvent } = doc.defaultView;
  const dispatch = (el, type) =>
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: false, cancelable: true }),
    );

  // Arrange: まずトリガへ mouseenter → openDelay 経過で開いた状態にする。
  dispatch(trigger, "mouseenter");
  timers.tick();
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "前提: 表示処理で共有 popover が生成されているべき");
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "前提: 開いた直後は popover が表示状態であるべき",
  );

  // Act 1: トリガから mouseleave で close を遅延予約する（close 保留中・まだ閉じない）。
  dispatch(trigger, "mouseleave");
  assert.equal(
    timers.pendingCount(),
    1,
    "トリガ mouseleave で close タイマーが 1 本だけ保留されるべき（closeDelay 経過前）",
  );
  const clearCountAfterLeave = timers.clearCount();

  // Act 2: close 保留中に popover への mouseenter（ポップ内へポインタが移動）。
  //   interactive=true なので保留中の close タイマーを clearTimeout して開いたままにする。
  dispatch(popover, "mouseenter");
  assert.ok(
    timers.clearCount() > clearCountAfterLeave,
    "interactive=true では popover への mouseenter で保留中の close タイマーを clearTimeout すべき",
  );
  assert.equal(
    timers.pendingCount(),
    0,
    "popover mouseenter 後は close 保留タイマーが取り消され保留 0 本であるべき",
  );

  // Act 3: 時間経過（保留タイマーがあれば発火）しても閉じない（開いたまま）。
  timers.tick();
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "interactive=true ではトリガ離脱後でも popover へポインタが入れば閉じず開いたままであるべき",
  );

  // Act 4: popover からの mouseleave で改めて close を遅延予約する。
  dispatch(popover, "mouseleave");
  assert.equal(
    timers.pendingCount(),
    1,
    "popover mouseleave で close タイマーが 1 本だけ保留されるべき（closeDelay 経過前）",
  );
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "closeDelay 経過前は popover はまだ閉じていないべき",
  );

  // Act 5: closeDelay 経過（保留タイマー発火）→ 閉じる（hidden が付く）。
  timers.tick();
  assert.equal(
    popover.hasAttribute("hidden"),
    true,
    "popover mouseleave → closeDelay 経過後に popover は閉じる（hidden が付く）べき",
  );
});

// 境界（t9・interactive=false）: hover で開いた状態からトリガを mouseleave すると
// close が遅延予約される（close 保留中）。interactive=false のときは、ポップ内へ
// ポインタが入っても（popover への mouseenter）保留中の close タイマーは取り消されず、
// 時間経過（tick）で従来どおり閉じる（hidden が付く）。
// つまり interactive=false では popover mouseenter は close を阻止しない（境界）。
// 実ポインタの実ホバー挙動は #24 Playwright へ委譲し、ここでは状態遷移のみ検証する。
test("interactive=false: トリガ mouseleave で従来どおり閉じ、popover への mouseenter では close タイマーを取り消さない", () => {
  // Arrange: DOM 契約を組み、fake timer を注入して interactive=false・hover で委譲リスナを張る。
  const doc = docWithTriggers();
  const timers = makeFakeTimers();
  installRiddlePopover(doc, {
    trigger: "hover",
    openDelayMs: 150,
    closeDelayMs: 100,
    interactive: false,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const trigger = doc.querySelector('a[href="#term-0"]');
  const { MouseEvent } = doc.defaultView;
  const dispatch = (el, type) =>
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: false, cancelable: true }),
    );

  // Arrange: まずトリガへ mouseenter → openDelay 経過で開いた状態にする。
  dispatch(trigger, "mouseenter");
  timers.tick();
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "前提: 表示処理で共有 popover が生成されているべき");
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "前提: 開いた直後は popover が表示状態であるべき",
  );

  // Act 1: トリガから mouseleave で close を遅延予約する（close 保留中・まだ閉じない）。
  dispatch(trigger, "mouseleave");
  assert.equal(
    timers.pendingCount(),
    1,
    "トリガ mouseleave で close タイマーが 1 本だけ保留されるべき（closeDelay 経過前）",
  );
  const clearCountAfterLeave = timers.clearCount();

  // Act 2: close 保留中に popover への mouseenter（ポップ内へポインタが移動）。
  //   interactive=false なので保留中の close タイマーは取り消さない（close は阻止されない）。
  dispatch(popover, "mouseenter");
  assert.equal(
    timers.clearCount(),
    clearCountAfterLeave,
    "interactive=false では popover への mouseenter で close タイマーを clearTimeout してはならない",
  );
  assert.equal(
    timers.pendingCount(),
    1,
    "interactive=false では popover mouseenter 後も close 保留タイマーは 1 本のまま残るべき",
  );

  // Act 3: closeDelay 経過（保留タイマー発火）→ 従来どおり閉じる（hidden が付く）。
  timers.tick();
  assert.equal(
    popover.hasAttribute("hidden"),
    true,
    "interactive=false ではトリガ離脱後にポップへ入っても closeDelay 経過で従来どおり閉じる（hidden が付く）べき",
  );
});

// 正常系（t10・a11y）: 開く時に popover へ role='tooltip' を付与し、トリガへ
// aria-describedby=popover.id を設定する（共有ポップに id が与えられる）。
// click 経路（即時 open）で開いて a11y 属性の付与のみを検証する（実フォーカス移動は #24 へ委譲）。
test("a11y: 開く時に popover へ role='tooltip' を付与し、トリガへ aria-describedby=popover.id を設定する", () => {
  // Arrange: DOM 契約を組み、click 種別で委譲リスナを張る。
  const doc = docWithTriggers();
  installRiddlePopover(doc, { trigger: "click" });
  const trigger = doc.querySelector('a[href="#term-0"]');
  const { MouseEvent } = doc.defaultView;

  // Act: トリガを click して開く（click 経路は即時 open）。
  trigger.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: popover に role='tooltip' が付き、id が与えられ、トリガの
  // aria-describedby がその popover.id と一致する。
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "click 後に共有 .riddle-popover が存在すべき");
  assert.equal(
    popover.getAttribute("role"),
    "tooltip",
    "開く時に popover へ role='tooltip' が付与されるべき",
  );
  const popId = popover.getAttribute("id");
  assert.ok(
    typeof popId === "string" && popId.length > 0,
    "共有 popover には空でない id が与えられるべき（aria-describedby の参照先）",
  );
  assert.equal(
    trigger.getAttribute("aria-describedby"),
    popId,
    "開く時にトリガへ aria-describedby=popover.id が設定されるべき",
  );
});

test("a11y: 別トリガへ切替表示すると旧トリガの aria-describedby は除去される", () => {
  // Arrange: 2 つの term トリガを click 種別で開けるようにする。
  const doc = docWithTriggers();
  installRiddlePopover(doc, { trigger: "click" });
  const first = doc.querySelector('a[href="#term-0"]');
  const second = doc.querySelector('a[href="../index.html#term-1"]');
  const { MouseEvent } = doc.defaultView;

  // Act: term-0 を開いてから term-1 へ切替表示する。
  first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  second.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  // Assert: 共有 popover の現在内容を説明するのは新トリガだけで、旧トリガは参照を持たない。
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "切替後も共有 popover が存在すべき");
  const popId = popover.getAttribute("id");
  assert.equal(
    first.hasAttribute("aria-describedby"),
    false,
    "切替後、旧トリガの aria-describedby は除去されるべき",
  );
  assert.equal(
    second.getAttribute("aria-describedby"),
    popId,
    "切替後、新トリガだけが現在の popover id を参照すべき",
  );
});

// 境界（t11・a11y 閉じる時・テーブル駆動）: 閉じる時に必ずトリガから aria-describedby が
// 除去される。加えて、focus 起点（focusin/blur 経路）で開いていた場合のみトリガ要素へ
// focus() を戻す（spy で呼び出しを検証）。hover 起点（mouseenter）で開いた場合は focus() を
// 戻さない（ポインタ操作のフォーカス奪取を避ける）。
// 共通形: 当該起点イベントで開き → tick() → Esc で閉じ（Esc は close 経路でトリガの
// focus/blur を伴わないため focus 復帰の有無を純粋に観測できる）→ tick() して状態を確認する。
// 実フォーカスの実挙動は #24 Playwright へ委譲し、ここでは focus() 呼び出しの有無のみ検証する。
const a11yCloseFocusCases = [
  { name: "focus 起点（focusin）で開いた場合は閉じる時にトリガ focus() を戻す", openType: "focusin", expectFocus: true },
  { name: "hover 起点（mouseenter）で開いた場合は閉じる時にトリガ focus() を戻さない", openType: "mouseenter", expectFocus: false },
];

for (const { name, openType, expectFocus } of a11yCloseFocusCases) {
  test(`a11y 閉じる: ${name}（aria-describedby は常に除去）`, () => {
    // Arrange: DOM 契約を組み、fake timer を注入して hover/focus で開く both トリガを張る。
    const doc = docWithTriggers();
    const timers = makeFakeTimers();
    installRiddlePopover(doc, {
      trigger: "both",
      openDelayMs: 150,
      closeDelayMs: 100,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const trigger = doc.querySelector('a[href="#term-0"]');
    const view = doc.defaultView;
    const { Event, KeyboardEvent } = view;

    // Arrange: トリガの focus() を spy 化して呼び出し回数を観測する（実フォーカス移動は #24）。
    let focusCalls = 0;
    trigger.focus = () => {
      focusCalls += 1;
    };

    // Act 1: 当該起点イベントで開く（openDelay 経由）→ tick() で open を発火する。
    trigger.dispatchEvent(new Event(openType, { bubbles: false, cancelable: true }));
    timers.tick();
    const popover = doc.querySelector(".riddle-popover");
    assert.notEqual(popover, null, "前提: open 後に共有 popover が存在すべき");
    assert.equal(
      popover.hasAttribute("hidden"),
      false,
      "前提: 閉じる前は popover が表示状態であるべき",
    );
    assert.equal(
      trigger.getAttribute("aria-describedby"),
      popover.getAttribute("id"),
      "前提: 開く時にトリガへ aria-describedby=popover.id が設定されているべき",
    );

    // Act 2: Esc で閉じる（close 経路はトリガの focus/blur を伴わない）→ tick() で close 発火。
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    timers.tick();

    // Assert 1: 閉じる時にトリガから aria-describedby が除去される（起点によらず常に）。
    assert.equal(
      trigger.hasAttribute("aria-describedby"),
      false,
      "閉じる時にトリガから aria-describedby が除去されるべき",
    );

    // Assert 2（最重要）: focus 起点のときだけ閉じる時にトリガ focus() が呼ばれる。
    assert.equal(
      focusCalls >= 1,
      expectFocus,
      expectFocus
        ? "focus 起点で開いていた場合は閉じる時にトリガ要素へ focus() を戻すべき"
        : "hover 起点で開いていた場合は閉じる時にトリガ要素へ focus() を戻してはならない",
    );
  });
}

// 後方互換（t12）: installRiddlePopover(doc) を「オプション引数なし」で呼んだとき、
// 既定（trigger='both'・openDelayMs=150・closeDelayMs=100・interactive=true）が適用される。
// 既定 trigger='both' により hover（mouseenter）でも開くこと（#17 の click 経路だけでなく
// hover も開くこと）を、既定のタイマー源である doc.defaultView の setTimeout/clearTimeout を
// fake へ差し替えてから install することで、実時間に依存せず検証する（オプションは渡さない）。
test("後方互換: installRiddlePopover(doc) を引数なしで呼ぶと既定 trigger='both' が適用され hover（mouseenter）でも openDelay 経過後に開く", () => {
  // Arrange: DOM 契約を組み、実装が既定で参照する doc.defaultView の
  // setTimeout/clearTimeout を fake timer へ差し替える（オプションは一切渡さない）。
  const doc = docWithTriggers();
  const timers = makeFakeTimers();
  const view = doc.defaultView;
  view.setTimeout = timers.setTimeout;
  view.clearTimeout = timers.clearTimeout;

  // Act 1: オプション引数なしで install（既定が適用されるはず）。
  installRiddlePopover(doc);

  const trigger = doc.querySelector('a[href="#term-0"]');

  // Act 2: hover 起点イベント（mouseenter は bubbles:false → capture 委譲で拾われる）。
  // 既定 trigger='both' なら hover でも開く対象。openDelay 経過前はまだ開かない。
  trigger.dispatchEvent(
    new view.Event("mouseenter", { bubbles: false, cancelable: true }),
  );
  assert.equal(
    doc.querySelector(".riddle-popover") === null ||
      doc.querySelector(".riddle-popover").hasAttribute("hidden"),
    true,
    "mouseenter 直後（既定 openDelay 経過前）は popover はまだ開いていないべき",
  );

  // Act 3: 既定 openDelay 経過（保留タイマー発火）。
  timers.tick();

  // Assert: 既定 trigger='both' のため hover でも開く（hidden が外れている）。
  const popover = doc.querySelector(".riddle-popover");
  assert.notEqual(popover, null, "open 後は共有 popover が存在すべき");
  assert.equal(
    popover.hasAttribute("hidden"),
    false,
    "引数なし呼び出しの既定 trigger='both' により mouseenter→openDelay 経過後に popover は開く（hidden が外れる）べき",
  );
  assert.equal(
    popover.textContent.includes("定義0"),
    true,
    "term-0 の template 内容（定義0）が popover へ挿入されているべき",
  );
});

// 異常（t13・依存注入の既定解決・fail-safe）: options で setTimeout/clearTimeout を
// 指定しないとき、既定では doc.defaultView の setTimeout/clearTimeout が使われる。
// 一方、doc.defaultView が不在（null）の異常環境でタイマー未注入のまま install しても、
// installRiddlePopover はその場で例外を投げてはならない（fail-safe）。
// 既定タイマーは doc.defaultView から解決すべきものだが、view 不在時に
// `doc.defaultView.setTimeout` を即時参照すると TypeError で落ちるため、
// 「install が例外で落ちないこと」を異常系として検証する。
// 実タイマー挙動（実時間経過の開閉）は他テスト＋#24 へ委譲し、ここでは
// install 時の既定解決の頑健性（fail-safe）だけを観測する。
const defaultTimerResolutionCases = [
  {
    name: "defaultView 在: タイマー未注入でも install が例外なく完了する（既定は defaultView 由来）",
    nullifyView: false,
  },
  {
    name: "defaultView 不在: タイマー未注入で install しても例外を投げない（fail-safe）",
    nullifyView: true,
  },
];

for (const { name, nullifyView } of defaultTimerResolutionCases) {
  test(`依存注入の既定解決: ${name}`, () => {
    // Arrange: DOM 契約を組む。defaultView 不在ケースでは install 前に null へ差し替える
    // （install 時にタイマー既定を解決する経路を fail-safe にする必要がある）。
    const doc = docWithTriggers();
    if (nullifyView) {
      Object.defineProperty(doc, "defaultView", {
        value: null,
        configurable: true,
      });
    }

    // Act & Assert: setTimeout/clearTimeout を注入せず install しても例外を投げない。
    assert.doesNotThrow(() => {
      installRiddlePopover(doc);
    }, "タイマー未注入かつ defaultView の有無に関わらず install は例外を投げてはならない（既定解決は fail-safe であるべき）");
  });
}

// 新タブ化（結合）: imagePopup 有効時、popover 内の通常リンクは target=_blank + rel を
// 持ち、ライトボックス適格な画像リンクには付与されない（ライトボックス動作維持）。
test("結合: imagePopup 有効時は通常リンクのみ新タブ属性つきで画像リンクは除外される", () => {
  // Arrange: 通常リンクと画像リンクを含む定義断片を持つ document
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0">' +
      '<p><a href="../other.html">通常リンク</a>' +
      '<a class="image-reference" href="pic.png"><img src="pic.png" alt=""></a></p>' +
      "</template>" +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc, { imagePopup: true });

  // Act: トリガを click して popover を表示する
  doc.querySelector("a.t").dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert: 通常リンクは新タブ属性つき、画像リンクは無変更
  const popover = doc.querySelector(".riddle-popover");
  const normal = popover.querySelector('a[href="../other.html"]');
  assert.equal(normal.getAttribute("target"), "_blank");
  assert.equal(normal.getAttribute("rel"), "noopener noreferrer");
  const image = popover.querySelector("a.image-reference");
  assert.equal(image.hasAttribute("target"), false, "画像リンクへは付与しない");
});

// 新タブ化（結合）: imagePopup 無効（既定）ではライトボックスが無いため、
// popover 内の画像リンクも新タブ属性を持つ（ページを離れない）。
test("結合: imagePopup 無効時は popover 内の画像リンクも新タブ属性を持つ", () => {
  // Arrange
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="t" href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0">' +
      '<p><a class="image-reference" href="pic.png"><img src="pic.png" alt=""></a></p>' +
      "</template>" +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc);

  // Act
  doc.querySelector("a.t").dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  // Assert
  const image = doc.querySelector(".riddle-popover a.image-reference");
  assert.equal(image.getAttribute("target"), "_blank");
  assert.equal(image.getAttribute("rel"), "noopener noreferrer");
});
