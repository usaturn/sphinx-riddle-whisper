// ランタイム設定読み取り・CSS 変数適用・初期化（発動）の単体/統合テスト。
// riddle.js から export される readRiddleConfig / applyRiddleCssVars / initRiddle を検証する。
//
// 観点:
// - readRiddleConfig: #riddle-config(JSON) の読取と fail-closed 正規化（多層防御）。
// - applyRiddleCssVars: CSSOM で CSS 変数を設定（テキスト注入なし）。
// - initRiddle: 設定読取→CSS 適用→installRiddlePopover 発動の統合（click で実際に開く）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  readRiddleConfig,
  applyRiddleCssVars,
  initRiddle,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

const DEFAULTS = {
  trigger: "both",
  openDelayMs: 150,
  closeDelayMs: 100,
  interactive: true,
  maxHeight: "24rem",
  maxWidth: "32rem",
  footnotes: true,
  imagePopup: true,
};

/**
 * body HTML から document を組む。
 * @param {string} bodyHtml
 * @returns {Document}
 */
function docFromBody(bodyHtml) {
  return new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`).window.document;
}

/**
 * #riddle-config の JSON 設定要素 HTML を作る。
 * @param {string} json textContent に入れる生文字列
 * @returns {string}
 */
function configScript(json) {
  return `<script type="application/json" id="riddle-config">${json}</script>`;
}

test("readRiddleConfig: 正常 JSON は各フィールドを反映する", () => {
  const doc = docFromBody(
    configScript(
      JSON.stringify({
        trigger: "click",
        openDelayMs: 50,
        closeDelayMs: 0,
        interactive: false,
        maxHeight: "10rem",
        maxWidth: "20rem",
      }),
    ),
  );

  const cfg = readRiddleConfig(doc);

  assert.deepEqual(cfg, {
    trigger: "click",
    openDelayMs: 50,
    closeDelayMs: 0,
    interactive: false,
    maxHeight: "10rem",
    maxWidth: "20rem",
    footnotes: DEFAULTS.footnotes,
    imagePopup: DEFAULTS.imagePopup,
  });
});

test("readRiddleConfig: 設定要素が無ければ既定値を返す", () => {
  const doc = docFromBody("<p>no config here</p>");
  assert.deepEqual(readRiddleConfig(doc), DEFAULTS);
});

test("readRiddleConfig: 同 id が script でなければ（DOM clobbering）既定値を返す", () => {
  // id="riddle-config" を持つ非 script 要素（clobbering 狙い）。
  const doc = docFromBody('<div id="riddle-config">{"trigger":"click"}</div>');
  assert.deepEqual(readRiddleConfig(doc), DEFAULTS);
});

test("readRiddleConfig: 不正 JSON は既定値へ fallback する", () => {
  const doc = docFromBody(configScript("{ this is not json "));
  assert.deepEqual(readRiddleConfig(doc), DEFAULTS);
});

test("readRiddleConfig: 不正フィールドは個別に既定へ正規化する（多層防御）", () => {
  const doc = docFromBody(
    configScript(
      JSON.stringify({
        trigger: "menu", // 不正
        openDelayMs: -5, // 負
        closeDelayMs: 1.5, // 非整数
        interactive: "yes", // 非 boolean
        maxHeight: 10, // 非 string
        maxWidth: "20rem", // 正常
      }),
    ),
  );

  assert.deepEqual(readRiddleConfig(doc), {
    trigger: DEFAULTS.trigger,
    openDelayMs: DEFAULTS.openDelayMs,
    closeDelayMs: DEFAULTS.closeDelayMs,
    interactive: DEFAULTS.interactive,
    maxHeight: DEFAULTS.maxHeight,
    maxWidth: "20rem",
    footnotes: DEFAULTS.footnotes,
    imagePopup: DEFAULTS.imagePopup,
  });
});

test("readRiddleConfig: footnotes は boolean のみ採用し非 boolean は既定 true へ正規化する（多層防御）", () => {
  // 非 boolean の footnotes は既定 true へ。boolean の false はそのまま採用。
  const docInvalid = docFromBody(
    configScript(JSON.stringify({ footnotes: "yes" })),
  );
  assert.equal(
    readRiddleConfig(docInvalid).footnotes,
    true,
    "非 boolean の footnotes は既定 true へ正規化されるべき",
  );

  const docFalse = docFromBody(
    configScript(JSON.stringify({ footnotes: false })),
  );
  assert.equal(
    readRiddleConfig(docFalse).footnotes,
    false,
    "boolean の footnotes=false はそのまま採用されるべき",
  );
});

test("readRiddleConfig: imagePopup は boolean のみ採用し非 boolean は既定 true へ正規化する（多層防御）", () => {
  const docInvalid = docFromBody(
    configScript(JSON.stringify({ imagePopup: "yes" })),
  );
  assert.equal(
    readRiddleConfig(docInvalid).imagePopup,
    true,
    "非 boolean の imagePopup は既定 true へ正規化されるべき",
  );

  const docFalse = docFromBody(
    configScript(JSON.stringify({ imagePopup: false })),
  );
  assert.equal(
    readRiddleConfig(docFalse).imagePopup,
    false,
    "boolean の imagePopup=false はそのまま採用されるべき",
  );
});

test("applyRiddleCssVars: CSS 変数を documentElement へ設定する", () => {
  const doc = docFromBody("");
  applyRiddleCssVars(doc, { maxHeight: "12rem", maxWidth: "34rem" });

  const root = doc.documentElement;
  assert.equal(root.style.getPropertyValue("--riddle-max-height"), "12rem");
  assert.equal(root.style.getPropertyValue("--riddle-max-width"), "34rem");
});

test("applyRiddleCssVars: 空/非 string はスキップする", () => {
  const doc = docFromBody("");
  applyRiddleCssVars(doc, { maxHeight: "", maxWidth: undefined });

  const root = doc.documentElement;
  assert.equal(root.style.getPropertyValue("--riddle-max-height"), "");
  assert.equal(root.style.getPropertyValue("--riddle-max-width"), "");
});

test("initRiddle: 設定を読み CSS を適用し、click でポップオーバーが発動する", () => {
  const doc = docFromBody(
    configScript(
      JSON.stringify({ trigger: "click", maxHeight: "9rem" }),
    ) +
      '<a id="trig" href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>',
  );

  initRiddle(doc);

  // CSS 変数が適用されている。
  assert.equal(
    doc.documentElement.style.getPropertyValue("--riddle-max-height"),
    "9rem",
  );

  // click で実際にポップオーバーが開く（installRiddlePopover が発動している）。
  doc.getElementById("trig").dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true }),
  );

  const popover = doc.querySelector(".riddle-popover");
  assert.ok(popover, "click 後に .riddle-popover が生成されていない（未発動）");
  assert.equal(popover.hasAttribute("hidden"), false, "ポップオーバーが hidden のまま");
  assert.match(popover.textContent, /定義0/, "定義本文が挿入されていない");
});
