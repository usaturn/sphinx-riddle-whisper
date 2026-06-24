// #18 [js] ポップオーバ位置決め（計算分離）の単体テスト。
// riddle.js から export された純関数 computePopoverPosition を import し、
// トリガ矩形・ポップ寸法・ビューポート寸法から配置座標 {top,left,placement} を
// 算出するロジックを検証する。getBoundingClientRect 依存は呼び出し側に分離され、
// 本関数は rect を引数で受ける純粋な算術関数（DOM に触れない）である前提。
//
// 本ファイルは項目 t1（境界）を担当する:
//   下にも上にも popHeight が収まらない場合、よりスペースの大きい側を選ぶ分岐。
//   - 下側の余白 > 上側の余白 → below に配置する。
//   - 上側の余白 > 下側の余白 → above に配置する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  applyPopoverPosition,
  computePopoverPosition,
  createRepositionScheduler,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

// 上下とも popHeight(=300) が収まらないようにビューポートを小さく(高さ200)とり、
// トリガの縦位置だけ変えて「どちらの余白が大きいか」を切り替えるテーブル。
//   - 下側余白 = viewportHeight - triggerRect.bottom
//   - 上側余白 = triggerRect.top
const GAP = 8;
const POP_HEIGHT = 300;
const POP_WIDTH = 100;
const VIEWPORT_HEIGHT = 200;
const VIEWPORT_WIDTH = 1000;

const NEITHER_FITS_CASES = [
  // トリガが上寄り: 下側余白(200-60=140) > 上側余白(40) → below を選ぶ。
  {
    label: "下側の余白が大きい → below を選ぶ",
    triggerRect: { top: 40, left: 100, bottom: 60, right: 140, width: 40, height: 20 },
    expectedPlacement: "below",
  },
  // トリガが下寄り: 上側余白(160) > 下側余白(200-180=20) → above を選ぶ。
  {
    label: "上側の余白が大きい → above を選ぶ",
    triggerRect: { top: 160, left: 100, bottom: 180, right: 140, width: 40, height: 20 },
    expectedPlacement: "above",
  },
];

for (const { label, triggerRect, expectedPlacement } of NEITHER_FITS_CASES) {
  test(`位置決め: 上下とも収まらない時、${label}`, () => {
    // Act
    const pos = computePopoverPosition({
      triggerRect,
      popWidth: POP_WIDTH,
      popHeight: POP_HEIGHT,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
      gap: GAP,
    });

    // Assert: よりスペースの大きい側が placement として選ばれる。
    assert.equal(pos.placement, expectedPlacement);
  });
}

// 項目 t2（境界）: flip 縦。
// 下に popHeight が収まらず、上には収まる時、above 配置へ反転し
// top = triggerRect.top - popHeight - gap を返すこと。
test("位置決め: 下に収まらず上に収まる時、above へ反転し top = triggerRect.top - popHeight - gap を返す", () => {
  // Arrange: viewportHeight=200・popHeight=100・gap=8。
  //   トリガを下寄り(top=120, bottom=140)に置くと、
  //     下側余白 = 200 - 140 = 60  < popHeight + gap(108) → 下に収まらない
  //     上側余白 = 120            >= popHeight + gap(108) → 上に収まる
  //   よって above へ反転する。
  const flipPopHeight = 100;
  const flipViewportHeight = 200;
  const triggerRect = {
    top: 120,
    left: 100,
    bottom: 140,
    right: 140,
    width: 40,
    height: 20,
  };

  // Act
  const pos = computePopoverPosition({
    triggerRect,
    popWidth: POP_WIDTH,
    popHeight: flipPopHeight,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: flipViewportHeight,
    gap: GAP,
  });

  // Assert: above 配置で top はトリガ上端から popHeight と gap を引いた値。
  assert.equal(pos.placement, "above");
  assert.equal(pos.top, triggerRect.top - flipPopHeight - GAP); // 120 - 100 - 8 = 12
});

// 項目 t3（境界）: clamp 横。
// left は既定で triggerRect.left。これがビューポート右端を超える／左端を割る場合に
// 内側へ clamp される。両端ケースをテーブル駆動で集約する。
//   - 右端はみ出し: left + popWidth > viewportWidth - gap
//                   → left = viewportWidth - popWidth - gap
//   - 左端割れ:     left < gap → left = gap
// 縦方向は十分なスペース(viewportHeight=1000・popHeight=100)を確保して下配置(below)に固定し、
// 横の clamp だけを検証する。
const CLAMP_VIEWPORT_WIDTH = 500;
const CLAMP_VIEWPORT_HEIGHT = 1000;
const CLAMP_POP_WIDTH = 200;
const CLAMP_POP_HEIGHT = 100;

const HORIZONTAL_CLAMP_CASES = [
  // トリガ左端=450: 450 + 200 = 650 > 500 - 8(=492) → 右端 clamp。
  //   期待 left = viewportWidth - popWidth - gap = 500 - 200 - 8 = 292。
  {
    label: "右端はみ出し → left をビューポート内へ clamp",
    triggerLeft: 450,
    expectedLeft: CLAMP_VIEWPORT_WIDTH - CLAMP_POP_WIDTH - GAP, // 292
  },
  // トリガ左端=2: 2 < gap(8) → 左端 clamp。期待 left = gap = 8。
  {
    label: "左端割れ → left = gap で左端へ clamp",
    triggerLeft: 2,
    expectedLeft: GAP, // 8
  },
];

for (const { label, triggerLeft, expectedLeft } of HORIZONTAL_CLAMP_CASES) {
  test(`位置決め: 横の clamp で、${label}`, () => {
    // Arrange: 縦は余裕を持たせ below に固定。トリガ左端だけ可変。
    const triggerRect = {
      top: 100,
      left: triggerLeft,
      bottom: 120,
      right: triggerLeft + 40,
      width: 40,
      height: 20,
    };

    // Act
    const pos = computePopoverPosition({
      triggerRect,
      popWidth: CLAMP_POP_WIDTH,
      popHeight: CLAMP_POP_HEIGHT,
      viewportWidth: CLAMP_VIEWPORT_WIDTH,
      viewportHeight: CLAMP_VIEWPORT_HEIGHT,
      gap: GAP,
    });

    // Assert: left がビューポート内へ clamp される。
    assert.equal(pos.left, expectedLeft);
  });
}

// 項目 t4（正常系）: 下に十分なスペースがある場合。
// flip も clamp も発生しない既定配置で below を返し、
//   top  = triggerRect.bottom + gap
//   left = triggerRect.left
// となること。縦も横もビューポート内に十分収まる条件で検証する。
test("位置決め: 下に十分なスペースがある時、below 配置で top=triggerRect.bottom+gap・left=triggerRect.left を返す", () => {
  // Arrange: viewport 1000x800 に対し pop 200x100。
  //   トリガ(top=100,left=300,bottom=120) は中央寄りで、
  //     下側余白 = 800 - 120 = 680 >= popHeight+gap(108) → 下に収まる(below)
  //     left(300)+popWidth(200)=500 <= viewportWidth-gap(992) かつ left>=gap → clamp なし
  const triggerRect = {
    top: 100,
    left: 300,
    bottom: 120,
    right: 340,
    width: 40,
    height: 20,
  };
  const popWidth = 200;
  const popHeight = 100;
  const viewportWidth = 1000;
  const viewportHeight = 800;

  // Act
  const pos = computePopoverPosition({
    triggerRect,
    popWidth,
    popHeight,
    viewportWidth,
    viewportHeight,
    gap: GAP,
  });

  // Assert: 既定の下配置。flip も clamp も起きていない。
  assert.equal(pos.placement, "below");
  assert.equal(pos.top, triggerRect.bottom + GAP); // 120 + 8 = 128
  assert.equal(pos.left, triggerRect.left); // 300
});

// 項目 t5（境界・off-by-one）:
// 縦 flip 閾値（下にちょうど収まる / 1px 不足）と
// 横 clamp 閾値（右端ちょうど一致 / 1px 超過）の境界をテーブル駆動で検証する。
//
// 実装の判定式:
//   縦: fitsBelow = spaceBelow >= popHeight + gap   (spaceBelow = viewportHeight - triggerRect.bottom)
//   横: clamp 発火 = (left + popWidth > viewportWidth - gap)
// いずれも「ちょうど一致」は収まる/clamp なし側、「1px だけ足りない/超える」が反転/clamp 側になる
// （`>=` と `>` の境界、off-by-one を突く）。

// --- 縦 flip 閾値 ---
// popHeight=100・gap=8 → 必要な縦余白 = popHeight + gap = 108。
// viewportHeight=400 を固定し、triggerRect.bottom を動かして
//   spaceBelow = 400 - bottom を 108（ちょうど）/ 107（1px 不足）に切り替える。
// トリガを下寄り（top = bottom - 20）に置くことで上側余白 spaceAbove(= top) は常に 108 以上を
// 確保し、下に入らない時に「上には収まる」状態を成立させて確実に above へ反転させる
// （上下とも収まらない分岐を巻き込まず、純粋に flip 閾値だけを突く）。
const VFLIP_POP_HEIGHT = 100;
const VFLIP_VIEWPORT_HEIGHT = 400;

const VERTICAL_FLIP_THRESHOLD_CASES = [
  // bottom=292 → spaceBelow = 400-292 = 108 = popHeight+gap → ちょうど収まる → below（反転しない）。
  //   spaceAbove = top = 272 >= 108 でもあるが、fitsBelow が true なので below が優先される。
  {
    label: "下にちょうど収まる（spaceBelow == popHeight+gap）→ below を維持",
    bottom: 292,
    expectedPlacement: "below",
    expectedTop: 292 + GAP, // below: triggerRect.bottom + gap = 300
  },
  // bottom=293 → spaceBelow = 400-293 = 107 = popHeight+gap-1 → 1px 不足 → 下に入らない。
  //   spaceAbove = top = 273 >= 108 → 上には収まる → above へ反転。
  {
    label: "下に 1px 不足（spaceBelow == popHeight+gap-1）→ above へ反転",
    bottom: 293,
    expectedPlacement: "above",
    // above: triggerRect.top - popHeight - gap。top = bottom - 20 = 273。
    expectedTop: 273 - VFLIP_POP_HEIGHT - GAP, // 273 - 100 - 8 = 165
  },
];

for (const { label, bottom, expectedPlacement, expectedTop } of VERTICAL_FLIP_THRESHOLD_CASES) {
  test(`位置決め境界: 縦 flip 閾値で、${label}`, () => {
    // Arrange: トリガ高さ 20 とし top = bottom - 20。横は clamp が起きない位置に固定。
    const triggerRect = {
      top: bottom - 20,
      left: 100,
      bottom,
      right: 140,
      width: 40,
      height: 20,
    };

    // Act
    const pos = computePopoverPosition({
      triggerRect,
      popWidth: POP_WIDTH,
      popHeight: VFLIP_POP_HEIGHT,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VFLIP_VIEWPORT_HEIGHT,
      gap: GAP,
    });

    // Assert: 閾値ちょうどは below を維持、1px 不足で above へ反転し top も期待値。
    assert.equal(pos.placement, expectedPlacement);
    assert.equal(pos.top, expectedTop);
  });
}

// --- 横 clamp 閾値 ---
// popWidth=200・gap=8・viewportWidth=500 → clamp 発火条件は left + 200 > 500 - 8(=492)。
// つまり left + popWidth が 492 ちょうどなら clamp なし、493 で clamp 発火。
//   left = 292 → 292+200 = 492 = viewportWidth-gap → clamp なし（left 据え置き）。
//   left = 293 → 293+200 = 493 = viewportWidth-gap+1 → clamp 発火（left = viewportWidth-popWidth-gap = 292）。
// 縦は余裕を持たせ below 固定（viewportHeight 大・popHeight 小）。
const HCLAMP_VIEWPORT_WIDTH = 500;
const HCLAMP_VIEWPORT_HEIGHT = 1000;
const HCLAMP_POP_WIDTH = 200;
const HCLAMP_POP_HEIGHT = 100;

const HORIZONTAL_CLAMP_THRESHOLD_CASES = [
  // right 端ちょうど一致: left+popWidth == viewportWidth-gap → clamp なし。
  {
    label: "右端ちょうど一致（left+popWidth == viewportWidth-gap）→ clamp なし",
    triggerLeft: 292,
    expectedLeft: 292, // 据え置き
  },
  // right 端 1px 超過: left+popWidth == viewportWidth-gap+1 → clamp 発火。
  {
    label: "右端 1px 超過（left+popWidth == viewportWidth-gap+1）→ clamp 発火",
    triggerLeft: 293,
    expectedLeft: HCLAMP_VIEWPORT_WIDTH - HCLAMP_POP_WIDTH - GAP, // 500 - 200 - 8 = 292
  },
];

for (const { label, triggerLeft, expectedLeft } of HORIZONTAL_CLAMP_THRESHOLD_CASES) {
  test(`位置決め境界: 横 clamp 閾値で、${label}`, () => {
    // Arrange: 縦は余裕を持たせ below に固定。トリガ左端だけ可変。
    const triggerRect = {
      top: 100,
      left: triggerLeft,
      bottom: 120,
      right: triggerLeft + 40,
      width: 40,
      height: 20,
    };

    // Act
    const pos = computePopoverPosition({
      triggerRect,
      popWidth: HCLAMP_POP_WIDTH,
      popHeight: HCLAMP_POP_HEIGHT,
      viewportWidth: HCLAMP_VIEWPORT_WIDTH,
      viewportHeight: HCLAMP_VIEWPORT_HEIGHT,
      gap: GAP,
    });

    // Assert: 閾値ちょうどは clamp なし、1px 超過で clamp される。
    assert.equal(pos.left, expectedLeft);
  });
}

// 項目 t6（境界）: gap の既定値（省略時 8 程度）と明示 gap=0 の振る舞い、
// および返却座標がすべて数値型である（px 文字列化しない）こと。
//
// 検証方針:
//   - below 配置では top = triggerRect.bottom + gap。gap 省略時(既定)と gap=0 では
//     top が「gap 分」だけ変化する。既定 gap は仕様上「8 程度」のため、その差分が
//     省略時の top - (gap=0 時の top) = 既定 gap 値（>0、ここでは 8）になることを突く。
//   - 左端 clamp では left = gap。gap=0 を明示すると left も 0 へ寄る（gap 据え置きされない）。
//   - {top,left} は数値（number）で返り、"128px" のような文字列ではない。
//     pos.top + 1 が文字列連結ではなく算術加算になることでも数値性を担保する。
//
// 縦も横もビューポート内に十分収まる素直な below 条件で、gap だけを動かす。
test("位置決め境界: gap 省略時の既定値と gap=0 で top が gap 分だけ変化し、座標が数値型で返る", () => {
  // Arrange: viewport 1000x800・pop 200x100。トリガは中央寄りで clamp が起きない位置。
  const triggerRect = {
    top: 100,
    left: 300,
    bottom: 120,
    right: 340,
    width: 40,
    height: 20,
  };
  const common = {
    triggerRect,
    popWidth: 200,
    popHeight: 100,
    viewportWidth: 1000,
    viewportHeight: 800,
  };

  // Act: gap を省略（既定値）した場合と、明示 gap=0 の場合。
  const posDefault = computePopoverPosition({ ...common });
  const posZeroGap = computePopoverPosition({ ...common, gap: 0 });

  // Assert: 返却座標はすべて数値（px 文字列化していない）。
  assert.equal(typeof posDefault.top, "number");
  assert.equal(typeof posDefault.left, "number");
  assert.equal(typeof posZeroGap.top, "number");
  assert.equal(typeof posZeroGap.left, "number");

  // Assert: gap=0 では below の top はトリガ下端ちょうど。
  assert.equal(posZeroGap.top, triggerRect.bottom); // 120
  // Assert: gap 省略時の既定値分（仕様上「8 程度」=8）だけ top が下がる。
  assert.equal(posDefault.top, triggerRect.bottom + 8); // 128
  assert.equal(posDefault.top - posZeroGap.top, 8); // 既定 gap = 8

  // Assert: 数値であること（"120px"+1 のような文字列連結ではなく算術加算になる）。
  assert.equal(posZeroGap.top + 1, triggerRect.bottom + 1); // 121（"120px1" ではない）
});

// 左端 clamp で gap=0 を明示すると left = gap = 0 になり、据え置き(8)されないこと。
test("位置決め境界: 左端割れで gap=0 を明示すると left = 0 へ clamp され数値で返る", () => {
  // Arrange: トリガ左端を負(=-5)にして必ず左端割れさせる。縦は余裕を持たせ below 固定。
  const triggerRect = {
    top: 100,
    left: -5,
    bottom: 120,
    right: 35,
    width: 40,
    height: 20,
  };

  // Act
  const pos = computePopoverPosition({
    triggerRect,
    popWidth: 100,
    popHeight: 100,
    viewportWidth: 1000,
    viewportHeight: 800,
    gap: 0,
  });

  // Assert: 左端 clamp は left = gap = 0（gap=8 で据え置きされない）。数値で返る。
  assert.equal(typeof pos.left, "number");
  assert.equal(pos.left, 0);
});

// 項目 t7（セキュリティ）: 座標適用は CSSOM プロパティ API で行う。
// applyPopoverPosition(el, pos) は el.style.top / el.style.left へ
// `${数値}px` を書き込み、setAttribute('style', …) や el.style.cssText は
// 使わないこと（CSP style-src 違反になるため禁止）。
//   - el.style.top / el.style.left が期待する px 文字列になる（CSSOM プロパティ経由）。
//   - setAttribute が 'style' 属性名で呼ばれない（spy で担保）。
//   - cssText 経由でまとめ書きしない（cssText の setter で書かれていないことを担保）。
test("位置適用: applyPopoverPosition は el.style.top/left へ px を書き、setAttribute('style')/cssText を使わない", () => {
  // Arrange: jsdom で空の要素を1つ用意し、setAttribute と cssText の書き込みを監視する。
  const dom = new JSDOM("<!DOCTYPE html><body><div id='pop'></div></body>");
  const doc = dom.window.document;
  const el = doc.getElementById("pop");

  // setAttribute('style', …) が呼ばれたら記録する spy。
  const setAttrCalls = [];
  const originalSetAttribute = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    setAttrCalls.push(name);
    return originalSetAttribute(name, value);
  };

  // cssText の setter が呼ばれたら記録する spy（CSSStyleDeclaration の cssText を差し替え）。
  const cssTextWrites = [];
  const styleProto = Object.getPrototypeOf(el.style);
  const cssTextDescriptor = Object.getOwnPropertyDescriptor(styleProto, "cssText");
  Object.defineProperty(el.style, "cssText", {
    configurable: true,
    get() {
      return cssTextDescriptor.get.call(this);
    },
    set(value) {
      cssTextWrites.push(value);
      cssTextDescriptor.set.call(this, value);
    },
  });

  const pos = { top: 128, left: 300, placement: "below" };

  // Act
  applyPopoverPosition(el, pos);

  // Assert: 座標は CSSOM プロパティ（style.top / style.left）に px で入る。
  assert.equal(el.style.top, "128px");
  assert.equal(el.style.left, "300px");

  // Assert: setAttribute は 'style' 属性名で呼ばれていない（CSP 違反経路を使わない）。
  assert.ok(
    !setAttrCalls.includes("style"),
    `setAttribute('style', …) を使ってはならない（呼ばれた属性: ${setAttrCalls.join(",")}）`,
  );

  // Assert: cssText 経由でまとめ書きしていない（CSP 違反経路を使わない）。
  assert.equal(
    cssTextWrites.length,
    0,
    `el.style.cssText を使ってはならない（書かれた値: ${cssTextWrites.join("|")}）`,
  );
});

// t8/t9 共通の fake rAF ハーネス。createRepositionScheduler に渡す requestFrame/reposition と、
// 1 フレーム進める flushFrame、呼び出し回数の参照（getter）をまとめて返す。
// requestFrame は呼ばれた回数を数えコールバックを保持し、flushFrame で保留コールバックを実行する。
function makeRafHarness() {
  let requestFrameCalls = 0;
  let pendingCallback = null;
  const requestFrame = (callback) => {
    requestFrameCalls += 1;
    pendingCallback = callback;
    return requestFrameCalls; // ダミーのフレーム ID。
  };
  // 1 フレーム進める（保留中のコールバックを実行する）fake なフレーム進行。
  const flushFrame = () => {
    const callback = pendingCallback;
    pendingCallback = null;
    if (callback) {
      callback();
    }
  };
  let repositionCalls = 0;
  const reposition = () => {
    repositionCalls += 1;
  };
  return {
    requestFrame,
    flushFrame,
    reposition,
    get requestFrameCalls() {
      return requestFrameCalls;
    },
    get repositionCalls() {
      return repositionCalls;
    },
  };
}

// 項目 t8（境界）: rAF スロットル。
// scroll/resize を連続発火しても requestAnimationFrame コールバックが1回に束ねられ、
// pending 中は再スケジュールしないこと（レイアウトスラッシング回避）。
//
// テスト容易性のため、requestAnimationFrame 依存を引数で受ける純粋なスケジューラ
// ファクトリ createRepositionScheduler({ requestFrame, reposition }) を export する前提。
// 戻り値は schedule() 関数で、scroll/resize ハンドラから呼ぶ想定。
//   - schedule() を連続で複数回呼んでも、保留中(pending)の間は requestFrame を再呼び出ししない
//     （requestFrame の呼び出し回数 = 1 に束ねられる）。
//   - 保留フレームのコールバックが実行されると pending が解除され、次の schedule() で
//     改めて requestFrame が呼ばれる（= 1 フレーム 1 回へスロットル）。
// requestFrame は fake な rAF キューでスタブし、呼び出し回数とコールバックを捕捉して検証する。
test("rAF スロットル: schedule を連続発火しても requestFrame は1回に束ねられ、pending 中は再スケジュールしない", () => {
  // Arrange: fake な rAF ハーネス。
  const raf = makeRafHarness();
  const schedule = createRepositionScheduler({
    requestFrame: raf.requestFrame,
    reposition: raf.reposition,
  });

  // Act 1: scroll/resize が連続発火した想定で schedule() を立て続けに呼ぶ。
  schedule();
  schedule();
  schedule();

  // Assert 1: pending 中は束ねられ、requestFrame は1回だけ。reposition はまだ走らない。
  assert.equal(raf.requestFrameCalls, 1, "連続 schedule で requestFrame は1回に束ねられる");
  assert.equal(raf.repositionCalls, 0, "フレーム到来前は reposition を実行しない");

  // Act 2: 1 フレーム進める → 保留コールバックが reposition を1回だけ実行し pending 解除。
  raf.flushFrame();

  // Assert 2: 束ねられたフレームで reposition は1回だけ実行される。
  assert.equal(raf.repositionCalls, 1, "1 フレームで reposition は1回だけ実行される");

  // Act 3: pending 解除後に再び schedule() → 改めて requestFrame が呼ばれる（次フレームへ）。
  schedule();

  // Assert 3: 次フレームのスケジュールが新たに1回行われる（合計2回）。
  assert.equal(raf.requestFrameCalls, 2, "pending 解除後の schedule は新フレームを1回スケジュールする");
});

// 項目 t9: rAF コールバック実行後（フラッシュ後）に再びイベントが来たら、次フレームが
// 新規スケジュールされ、そのフレームをフラッシュすると再配置が再開する（pending 解除後は
// 再配置サイクルが繰り返し再開できる）。
//   - 1回目フラッシュで reposition が1回 → 解除後の schedule で新フレーム →
//     2回目フラッシュで reposition が再び実行され合計2回になる（再配置が再開する）。
test("rAF スロットル: フラッシュ後に再び schedule すると次フレームが組まれ、フラッシュで再配置が再開する", () => {
  // Arrange: fake な rAF ハーネス。
  const raf = makeRafHarness();
  const schedule = createRepositionScheduler({
    requestFrame: raf.requestFrame,
    reposition: raf.reposition,
  });

  // Act 1: 最初のイベントで1フレーム組み、フラッシュして reposition を1回走らせる。
  schedule();
  raf.flushFrame();
  assert.equal(raf.repositionCalls, 1, "1回目フラッシュで reposition は1回実行される");

  // Act 2: pending 解除後に再びイベントが来た → 新フレームを組み、フラッシュする。
  schedule();
  assert.equal(raf.requestFrameCalls, 2, "フラッシュ後の schedule は次フレームを新規にスケジュールする");
  raf.flushFrame();

  // Assert: 2回目フラッシュで reposition が再び実行され、再配置が再開している。
  assert.equal(raf.repositionCalls, 2, "フラッシュ後の再 schedule + フラッシュで reposition が再開する");
});

// 項目 t10（異常系）: computePopoverPosition は純関数である。
// 引数の triggerRect オブジェクトを変更せず（呼び出し前後で入力不変）、
// DOM API（getBoundingClientRect 等・document 参照）にも一切触れない。
//   - 入力 triggerRect を Object.freeze しても computePopoverPosition は例外なく動く
//     （= 関数内で triggerRect のプロパティへ書き込んでいない）。
//   - 呼び出し前後で triggerRect の各プロパティ値が不変（deepEqual で担保）。
//   - getBoundingClientRect を持つ罠オブジェクトを triggerRect に渡しても、その
//     getBoundingClientRect は呼ばれない（spy のカウントが 0 = DOM API に依存しない）。
test("位置決め純粋性: computePopoverPosition は triggerRect を変更せず getBoundingClientRect も呼ばない", () => {
  // Arrange: 不変性を厳格に突くため triggerRect を凍結し、別個に元の値を控える。
  //   getBoundingClientRect を生やした罠を仕込み、呼ばれたら検出できるようにする。
  let gbcrCalls = 0;
  const triggerRect = Object.freeze({
    top: 100,
    left: 300,
    bottom: 120,
    right: 340,
    width: 40,
    height: 20,
    // 純関数なら参照されない罠。呼ばれたら DOM API 依存の証拠。
    getBoundingClientRect: () => {
      gbcrCalls += 1;
      return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
    },
  });
  const snapshot = {
    top: triggerRect.top,
    left: triggerRect.left,
    bottom: triggerRect.bottom,
    right: triggerRect.right,
    width: triggerRect.width,
    height: triggerRect.height,
  };

  // Act: 凍結した triggerRect で呼ぶ。書き込みがあれば strict mode で TypeError になる。
  const pos = computePopoverPosition({
    triggerRect,
    popWidth: 200,
    popHeight: 100,
    viewportWidth: 1000,
    viewportHeight: 800,
    gap: GAP,
  });

  // Assert: 何らかの座標が算出される（呼び出し自体は成功している）。
  assert.equal(typeof pos.top, "number");
  assert.equal(typeof pos.left, "number");

  // Assert: 入力 triggerRect の数値プロパティは呼び出し前後で不変（破壊的変更なし）。
  assert.deepEqual(
    {
      top: triggerRect.top,
      left: triggerRect.left,
      bottom: triggerRect.bottom,
      right: triggerRect.right,
      width: triggerRect.width,
      height: triggerRect.height,
    },
    snapshot,
    "triggerRect の値を変更してはならない（純関数）",
  );

  // Assert: getBoundingClientRect は呼ばれない（DOM API に依存しない純粋な算術関数）。
  assert.equal(gbcrCalls, 0, "computePopoverPosition は getBoundingClientRect を呼んではならない");
});
