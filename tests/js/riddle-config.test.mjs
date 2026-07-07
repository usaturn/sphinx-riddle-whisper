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
  TERM_MARK_CLASS,
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
  nested: true,
  markTerms: true,
  tableAlign: "left",
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
    nested: DEFAULTS.nested,
    markTerms: DEFAULTS.markTerms,
    tableAlign: DEFAULTS.tableAlign,
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
    nested: DEFAULTS.nested,
    markTerms: DEFAULTS.markTerms,
    tableAlign: DEFAULTS.tableAlign,
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

test("readRiddleConfig: nested=false の JSON 設定が読み取られる", () => {
  // Arrange: nested: false を含む #riddle-config を持つ document を組む
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<script type="application/json" id="riddle-config">{"nested": false}</script>' +
      "</body>",
  );

  // Act
  const cfg = readRiddleConfig(dom.window.document);

  // Assert
  assert.equal(cfg.nested, false);
});

test("readRiddleConfig: nested が不在・非 boolean なら既定 true へ正規化する", () => {
  // Arrange: nested 不在の JSON と、非 boolean（文字列）の JSON の 2 パターン
  const absent = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<script type="application/json" id="riddle-config">{}</script>' +
      "</body>",
  );
  const invalid = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<script type="application/json" id="riddle-config">{"nested": "no"}</script>' +
      "</body>",
  );

  // Act & Assert
  assert.equal(readRiddleConfig(absent.window.document).nested, true);
  assert.equal(readRiddleConfig(invalid.window.document).nested, true);
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

test("readRiddleConfig: markTerms が非 bool（文字列 'false'）なら既定 true へ fallback する", () => {
  // Arrange: markTerms に型不一致の値を仕込む
  const doc = docFromBody(
    configScript(JSON.stringify({ markTerms: "false" })),
  );

  // Act
  const cfg = readRiddleConfig(doc);

  // Assert: fail-closed で既定 true
  assert.equal(cfg.markTerms, true);
});

test("readRiddleConfig: markTerms: false の指定が反映される", () => {
  // Arrange
  const doc = docFromBody(configScript(JSON.stringify({ markTerms: false })));

  // Act
  const cfg = readRiddleConfig(doc);

  // Assert
  assert.equal(cfg.markTerms, false);
});

test("initRiddle: 既定（markTerms 未指定）で template 実在の term リンクがマークされる", () => {
  // Arrange: 設定要素なし（全既定）＋ term リンクと対応 template
  const doc = docFromBody(
    '<a id="t" href="#term-0">用語</a>' +
      '<template id="riddle-tip--term-0"><p>定義</p></template>',
  );

  // Act
  initRiddle(doc);

  // Assert: 既定 markTerms=true により装飾クラスが付く
  assert.ok(doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("initRiddle: markTerms: false のときマークされない", () => {
  // Arrange: markTerms を無効化した設定＋ term リンクと対応 template
  const doc = docFromBody(
    configScript(JSON.stringify({ markTerms: false })) +
      '<a id="t" href="#term-0">用語</a>' +
      '<template id="riddle-tip--term-0"><p>定義</p></template>',
  );

  // Act
  initRiddle(doc);

  // Assert: 無効化されているので装飾クラスは付かない
  assert.ok(!doc.getElementById("t").classList.contains(TERM_MARK_CLASS));
});

test("readRiddleConfig: tableAlign の正常値（right）を反映する", () => {
  const doc = docFromBody(
    configScript(JSON.stringify({ tableAlign: "right" })),
  );
  assert.equal(readRiddleConfig(doc).tableAlign, "right");
});

test("readRiddleConfig: tableAlign が許可外・非 string なら既定 left へ正規化する", () => {
  // 許可外の文字列（fail-closed）。
  const invalid = docFromBody(
    configScript(JSON.stringify({ tableAlign: "middle" })),
  );
  assert.equal(readRiddleConfig(invalid).tableAlign, "left");

  // 非 string（型不一致）。
  const nonString = docFromBody(
    configScript(JSON.stringify({ tableAlign: 1 })),
  );
  assert.equal(readRiddleConfig(nonString).tableAlign, "left");
});

test("applyRiddleCssVars: tableAlign の 3 値をテーブル揃え CSS 変数へマップする", () => {
  const cases = [
    ["left", "left", "0 auto"],
    ["center", "center", "auto auto"],
    ["right", "right", "auto 0"],
  ];
  for (const [tableAlign, textAlign, marginInline] of cases) {
    const doc = docFromBody("");
    applyRiddleCssVars(doc, { tableAlign });
    const root = doc.documentElement;
    assert.equal(
      root.style.getPropertyValue("--riddle-table-text-align"),
      textAlign,
      `tableAlign=${tableAlign} の text-align`,
    );
    assert.equal(
      root.style.getPropertyValue("--riddle-table-margin-inline"),
      marginInline,
      `tableAlign=${tableAlign} の margin-inline`,
    );
  }
});

test("applyRiddleCssVars: tableAlign キーなし・許可外値では CSS 変数を触らない", () => {
  // 防御的ガード: 単体呼び出しで不正が来ても CSS 既定値（左揃え）に委ねる。
  // "constructor" はプロトタイプ経由のキー誤引きを狙う敵対値。
  for (const cfg of [{}, { tableAlign: "middle" }, { tableAlign: "constructor" }]) {
    const doc = docFromBody("");
    applyRiddleCssVars(doc, cfg);
    const root = doc.documentElement;
    assert.equal(root.style.getPropertyValue("--riddle-table-text-align"), "");
    assert.equal(root.style.getPropertyValue("--riddle-table-margin-inline"), "");
  }
});
