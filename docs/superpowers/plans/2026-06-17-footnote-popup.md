# 脚注・引用参照ポップアップ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** glossary `:term:` 参照に既にあるポップオーバー UX を、脚注参照（`[#name]_`/`[1]_`/`[#]_`/`[*]_`）と引用参照（`[CIT]_`）にも拡張する。

**Architecture:** クライアント側 DOM 解決方式。脚注/引用の本体は同一ページ下部に `<aside class="footnote|citation" id="…">` として既存するため、参照アンカーの `href="#idN"` から本体を引き、戻りリンク（`.label`）を除去し、既存 `sanitizeFragment` に通して共有 `.riddle-popover` へ表示する。Python は `riddle_footnotes`（既定 True）の登録と runtime config への伝播のみ。表示設定（trigger/遅延/interactive）と popover UI・配置・タイマー・XSS 防御は既存基盤を完全共有する。

**Tech Stack:** Python（Sphinx 拡張, pytest, uv）／バニラ JS ESM（node:test + jsdom, ESLint no-unsanitized）。

**元になった Spec:** `docs/superpowers/specs/2026-06-17-footnote-popup-design.md`

---

## 影響ファイル一覧（責務）

- `src/sphinx_riddle_whisper/config.py` … 設定 `riddle_footnotes` を登録
- `src/sphinx_riddle_whisper/runtime_config.py` … `build_runtime_config` で `footnotes` を JSON へ伝播
- `src/sphinx_riddle_whisper/static/riddle.js` … `deriveFragmentId`/`resolveFootnoteContent` 追加、`handleTriggerForElement` をディスパッチ化、トリガセレクタ引き回し、`readRiddleConfig` に `footnotes` 追加
- `tests/test_config.py` … 既存テストへ `riddle_footnotes` を反映
- `tests/test_runtime_config.py` … `build_runtime_config` 単体テストへ `footnotes` を反映
- `tests/js/riddle-config.test.mjs` … `readRiddleConfig` 既存テストへ `footnotes` を反映＋正規化テスト追加
- `tests/js/footnote-popover.test.mjs` … 新規。`deriveFragmentId`/`resolveFootnoteContent`/ディスパッチ/無効化/共有/セキュリティ

---

### Task 1: Python 設定 `riddle_footnotes` の登録

**Files:**
- Modify: `src/sphinx_riddle_whisper/config.py`（`_CONFIG_SPECS`）
- Test: `tests/test_config.py`

注: 既存の bool 設定（`riddle_interactive`/`riddle_sanitize`）は Python 側で型検証していない。これに倣い `riddle_footnotes` も専用バリデータは設けず、登録のみ行う（防御的な bool 正規化は JS 側 `readRiddleConfig` が担う = 多層防御）。

- [ ] **Step 1: 失敗するテストを書く（登録名の追加）**

`tests/test_config.py` の `_EXPECTED_CONFIG_NAMES`（13-26 行）に `"riddle_footnotes"` を追加し、`_make_default_config`（31-44 行）の `values` dict に `"riddle_footnotes": True,` を追加する。

```python
# _EXPECTED_CONFIG_NAMES に1行追加
    "riddle_sanitize",
    "riddle_footnotes",
    "riddle_allowed_tags",
```

```python
# _make_default_config の values に1行追加
        "riddle_sanitize": True,
        "riddle_footnotes": True,
        "riddle_allowed_tags": None,
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_config.py::test_register_config_valuesが全設定名をadd_config_valueで登録する -v`
Expected: FAIL（`riddle_footnotes` が `registered` に無く `_EXPECTED_CONFIG_NAMES <= registered` が False）

- [ ] **Step 3: 最小実装（設定を登録）**

`src/sphinx_riddle_whisper/config.py` の `_CONFIG_SPECS`（12-25 行）へ1行追加する。

```python
    ("riddle_interactive", True, "html"),
    ("riddle_footnotes", True, "html"),
    ("riddle_include_term_title", True, "html"),
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/config.py tests/test_config.py
git commit -m "feat: riddle_footnotes 設定を登録（既定 True）"
```

---

### Task 2: runtime config への `footnotes` 伝播

**Files:**
- Modify: `src/sphinx_riddle_whisper/runtime_config.py`（`build_runtime_config`）
- Test: `tests/test_runtime_config.py`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_runtime_config.py` の `test_build_runtime_configはconf値をcamelCaseのdictへ変換する`（32-52 行）を、入力 `SimpleNamespace` に `riddle_footnotes=False` を加え、期待 dict に `"footnotes": False` を加える形へ更新する。

```python
    config = SimpleNamespace(
        riddle_trigger="click",
        riddle_open_delay_ms=42,
        riddle_close_delay_ms=7,
        riddle_interactive=False,
        riddle_max_height="9rem",
        riddle_max_width="18rem",
        riddle_footnotes=False,
    )

    payload = build_runtime_config(config)

    assert payload == {
        "trigger": "click",
        "openDelayMs": 42,
        "closeDelayMs": 7,
        "interactive": False,
        "maxHeight": "9rem",
        "maxWidth": "18rem",
        "footnotes": False,
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_runtime_config.py::test_build_runtime_configはconf値をcamelCaseのdictへ変換する -v`
Expected: FAIL（`build_runtime_config` の戻り dict に `footnotes` が無く、`==` 比較が False）

- [ ] **Step 3: 最小実装（dict に footnotes を追加）**

`src/sphinx_riddle_whisper/runtime_config.py` の `build_runtime_config`（29-36 行）の戻り dict に1行追加する。

```python
    return {
        "trigger": config.riddle_trigger,
        "openDelayMs": config.riddle_open_delay_ms,
        "closeDelayMs": config.riddle_close_delay_ms,
        "interactive": config.riddle_interactive,
        "maxHeight": config.riddle_max_height,
        "maxWidth": config.riddle_max_width,
        "footnotes": config.riddle_footnotes,
    }
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `uv run pytest tests/test_runtime_config.py -v`
Expected: PASS（全件。実ビルド統合テストは個別 assert のため影響なし）

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/runtime_config.py tests/test_runtime_config.py
git commit -m "feat: runtime config に footnotes を伝播する"
```

---

### Task 3: JS `readRiddleConfig` に `footnotes` を追加

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`（`CONFIG_DEFAULTS`・`readRiddleConfig`）
- Test: `tests/js/riddle-config.test.mjs`

注: `footnotes` 追加で既存 `deepEqual` 断言が壊れるため、既存テストの期待値も同時に更新する。

- [ ] **Step 1: 失敗するテストを書く＆既存テストを更新**

`tests/js/riddle-config.test.mjs` を次の3箇所更新する。

(1) `DEFAULTS`（17-24 行）に `footnotes: true` を追加:

```javascript
const DEFAULTS = {
  trigger: "both",
  openDelayMs: 150,
  closeDelayMs: 100,
  interactive: true,
  maxHeight: "24rem",
  maxWidth: "32rem",
  footnotes: true,
};
```

(2) `readRiddleConfig: 正常 JSON は各フィールドを反映する`（44-68 行）の入力 JSON に `footnotes: false` を、期待 deepEqual に `footnotes: false` を追加:

```javascript
      JSON.stringify({
        trigger: "click",
        openDelayMs: 50,
        closeDelayMs: 0,
        interactive: false,
        maxHeight: "10rem",
        maxWidth: "20rem",
        footnotes: false,
      }),
```
```javascript
  assert.deepEqual(cfg, {
    trigger: "click",
    openDelayMs: 50,
    closeDelayMs: 0,
    interactive: false,
    maxHeight: "10rem",
    maxWidth: "20rem",
    footnotes: false,
  });
```

(3) `不正フィールドは個別に既定へ正規化する`（86-108 行）の期待 deepEqual に `footnotes: DEFAULTS.footnotes` を追加（入力に footnotes 無し→既定へ）:

```javascript
  assert.deepEqual(readRiddleConfig(doc), {
    trigger: DEFAULTS.trigger,
    openDelayMs: DEFAULTS.openDelayMs,
    closeDelayMs: DEFAULTS.closeDelayMs,
    interactive: DEFAULTS.interactive,
    maxHeight: DEFAULTS.maxHeight,
    maxWidth: "20rem",
    footnotes: DEFAULTS.footnotes,
  });
```

(4) 新規テストを末尾に追加（非 boolean は既定 true へ、false は反映）:

```javascript
test("readRiddleConfig: footnotes は boolean のみ採用し非 boolean は既定 true へ", () => {
  const docBad = docFromBody(
    configScript(JSON.stringify({ footnotes: "no" })),
  );
  assert.equal(readRiddleConfig(docBad).footnotes, true);

  const docFalse = docFromBody(
    configScript(JSON.stringify({ footnotes: false })),
  );
  assert.equal(readRiddleConfig(docFalse).footnotes, false);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/riddle-config.test.mjs`
Expected: FAIL（`footnotes` が `readRiddleConfig` の戻りに無く deepEqual と新規テストが失敗）

- [ ] **Step 3: 最小実装（riddle.js）**

`CONFIG_DEFAULTS`（588-595 行）に `footnotes: true,` を追加:

```javascript
const CONFIG_DEFAULTS = Object.freeze({
  trigger: "both",
  openDelayMs: 150,
  closeDelayMs: 100,
  interactive: true,
  maxHeight: "24rem",
  maxWidth: "32rem",
  footnotes: true,
});
```

`readRiddleConfig` の戻り（633-653 行）に正規化を1項目追加:

```javascript
    maxWidth:
      typeof raw.maxWidth === "string" ? raw.maxWidth : CONFIG_DEFAULTS.maxWidth,
    footnotes:
      typeof raw.footnotes === "boolean"
        ? raw.footnotes
        : CONFIG_DEFAULTS.footnotes,
  };
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test tests/js/riddle-config.test.mjs` then `npm test` then `npm run lint`
Expected: PASS（全件）／lint クリーン

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/riddle-config.test.mjs
git commit -m "feat: readRiddleConfig に footnotes（既定 true）を追加"
```

---

### Task 4: JS `deriveFragmentId` と `resolveFootnoteContent`

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`
- Test: `tests/js/footnote-popover.test.mjs`（新規）

DOM 契約（docutils 0.22 HTML5）:
- 参照: `<a class="footnote-reference brackets" href="#id3" id="id1">[1]</a>`
- 本体: `<aside class="footnote brackets" id="id3" role="note"><span class="label"><a class="fn-backref" href="#id1">[1]</a></span><p>本体</p></aside>`
- 引用本体: `<aside class="citation" id="cite-x" role="doc-cite">…</aside>`

- [ ] **Step 1: 失敗するテストを書く（新規ファイル）**

`tests/js/footnote-popover.test.mjs` を作成する。

```javascript
// 脚注/引用参照ポップアップの単体・結合テスト。
// deriveFragmentId / resolveFootnoteContent と、installRiddlePopover の
// 脚注ディスパッチ・無効化・共有・セキュリティを検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  deriveFragmentId,
  resolveFootnoteContent,
  installRiddlePopover,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

/** 脚注参照＋本体を含む document を組む。 */
function docWithFootnote(bodyAsideHtml) {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<p>本文<a class="footnote-reference brackets" href="#id3" id="id1">[1]</a></p>' +
      bodyAsideHtml +
      "</body>",
  );
  return dom.window.document;
}

const FOOTNOTE_ASIDE =
  '<aside class="footnote brackets" id="id3" role="note">' +
  '<span class="label"><a class="fn-backref" href="#id1">[1]</a></span>' +
  "<p>脚注の本体テキスト</p></aside>";

test("deriveFragmentId: href の # 以降を返し、# 無しは null", () => {
  assert.equal(deriveFragmentId("#id3"), "id3");
  assert.equal(deriveFragmentId("../page.html#cite-x"), "cite-x");
  assert.equal(deriveFragmentId("no-hash"), null);
  assert.equal(deriveFragmentId("#"), null);
});

test("resolveFootnoteContent: 本体テキストを返し戻りリンク（.label）を除去する", () => {
  const doc = docWithFootnote(FOOTNOTE_ASIDE);
  const trigger = doc.querySelector("a.footnote-reference");

  const result = resolveFootnoteContent(doc, trigger);

  assert.ok(result, "結果が null（解決できていない）");
  const tmp = doc.createElement("div");
  tmp.appendChild(result.fragment);
  assert.match(tmp.textContent, /脚注の本体テキスト/);
  assert.equal(tmp.querySelector(".fn-backref"), null, "戻りリンクが残っている");
  assert.equal(tmp.querySelector(".label"), null, "label が残っている");
});

test("resolveFootnoteContent: 本体が見つからなければ null（fail-closed）", () => {
  const doc = docWithFootnote(""); // 本体 aside 無し
  const trigger = doc.querySelector("a.footnote-reference");
  assert.equal(resolveFootnoteContent(doc, trigger), null);
});

test("resolveFootnoteContent: id が aside 以外（DOM clobbering）なら null", () => {
  const doc = docWithFootnote('<div id="id3"><p>偽物</p></div>');
  const trigger = doc.querySelector("a.footnote-reference");
  assert.equal(resolveFootnoteContent(doc, trigger), null);
});

test("resolveFootnoteContent: citation 本体も解決する", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a class="citation-reference" href="#cite-x" id="cid1">[CIT]</a>' +
      '<aside class="citation" id="cite-x" role="doc-cite">' +
      '<span class="label"><a class="fn-backref" href="#cid1">[CIT]</a></span>' +
      "<p>引用の本体</p></aside>" +
      "</body>",
  );
  const doc = dom.window.document;
  const trigger = doc.querySelector("a.citation-reference");

  const result = resolveFootnoteContent(doc, trigger);

  assert.ok(result);
  const tmp = doc.createElement("div");
  tmp.appendChild(result.fragment);
  assert.match(tmp.textContent, /引用の本体/);
});

test("resolveFootnoteContent: 敵対的本体は sanitize され危険要素・on* が残らない", () => {
  const doc = docWithFootnote(
    '<aside class="footnote" id="id3">' +
      '<span class="label"><a class="fn-backref" href="#id1">[1]</a></span>' +
      '<p>悪意<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a></p>' +
      "<script>alert(2)</script></aside>",
  );
  const trigger = doc.querySelector("a.footnote-reference");

  const result = resolveFootnoteContent(doc, trigger);
  const tmp = doc.createElement("div");
  tmp.appendChild(result.fragment);

  assert.equal(tmp.querySelector("script"), null, "script が残っている");
  const img = tmp.querySelector("img");
  assert.equal(img && img.hasAttribute("onerror"), false, "onerror が残っている");
  const a = tmp.querySelector("a[href]");
  assert.equal(
    a ? /javascript:/i.test(a.getAttribute("href")) : false,
    false,
    "javascript: スキームが残っている",
  );
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/footnote-popover.test.mjs`
Expected: FAIL（`deriveFragmentId`/`resolveFootnoteContent` が export されておらず import で undefined → 各テストが失敗）

- [ ] **Step 3: 最小実装（riddle.js に関数を追加）**

`deriveTermId`（153-166 行）の直後に `deriveFragmentId` を追加:

```javascript
/**
 * href の `#` 以降を取り出して fragment id を返す（脚注/引用本体の getElementById 用）。
 * `#` 無し／空フラグメント／不正エンコードで decodeURIComponent が例外なら null。
 * @param {string} href 例 "#id3" / "../page.html#cite-x"
 * @returns {string|null} 例 "id3"、導出不可なら null
 */
export function deriveFragmentId(href) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return null;
  }
  const fragment = href.slice(hashIndex + 1);
  if (fragment === "") {
    return null;
  }
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null;
  }
}
```

`handleTriggerForElement`（307-317 行）の直後に、本体判定と脚注 resolver を追加:

```javascript
// DOM 契約: 脚注/引用本体は <aside class="footnote"|"citation" id="…"> として同一ページに存在する。
const FOOTNOTE_BODY_CLASSES = ["footnote", "citation"];

/**
 * getElementById で得た要素が脚注/引用本体（<aside class="footnote"|"citation">）かを返す。
 * 他要素や不在は false（fail-closed・DOM clobbering 耐性）。
 * @param {Element|null} el
 * @returns {boolean}
 */
function isFootnoteBody(el) {
  if (el === null || el.tagName !== "ASIDE") {
    return false;
  }
  return FOOTNOTE_BODY_CLASSES.some((cls) => el.classList.contains(cls));
}

/**
 * 脚注/引用参照トリガから、同一ページ内の本体 <aside> を引き、戻りリンク（.label）を
 * 除去した本体子ノードを clone・二次防御走査して返す。本体不在／aside でないなら null。
 * @param {Document} doc
 * @param {Element} trigger 脚注/引用参照アンカー
 * @returns {{trigger: Element, fragment: DocumentFragment}|null}
 */
export function resolveFootnoteContent(doc, trigger) {
  const fragmentId = deriveFragmentId(trigger.getAttribute("href"));
  if (fragmentId === null) {
    return null;
  }
  const body = doc.getElementById(fragmentId);
  if (!isFootnoteBody(body)) {
    return null;
  }
  const clone = body.cloneNode(true);
  // 戻りリンク（<span class="label"> 配下の .fn-backref）はポップアップでは無意味なため除去。
  for (const label of clone.querySelectorAll(".label")) {
    label.remove();
  }
  // aside ラッパは含めず、本体子ノードだけを fragment へ移して走査する。
  const fragment = doc.createDocumentFragment();
  while (clone.firstChild) {
    fragment.appendChild(clone.firstChild);
  }
  return { trigger, fragment: sanitizeFragment(fragment) };
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test tests/js/footnote-popover.test.mjs` then `npm run lint`
Expected: PASS（全件）／lint クリーン（innerHTML 等の危険シンク不使用）

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/footnote-popover.test.mjs
git commit -m "feat: resolveFootnoteContent と deriveFragmentId を追加"
```

---

### Task 5: ディスパッチとトリガセレクタの配線

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`（セレクタ定数・`findTriggerFromEvent`・`handleTriggerForElement`・`installRiddlePopover`）
- Test: `tests/js/footnote-popover.test.mjs`（結合・無効化・共有を追記）

- [ ] **Step 1: 失敗するテストを追記**

`tests/js/footnote-popover.test.mjs` の末尾へ追加する。

```javascript
test("結合: 脚注参照を click すると本体が共有 .riddle-popover へ表示される", () => {
  const doc = docWithFootnote(FOOTNOTE_ASIDE);
  installRiddlePopover(doc, { trigger: "click" });
  const trigger = doc.querySelector("a.footnote-reference");

  trigger.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  const popover = doc.querySelector(".riddle-popover");
  assert.ok(popover, "click 後に .riddle-popover が無い");
  assert.equal(popover.hasAttribute("hidden"), false, "popover が hidden のまま");
  assert.match(popover.textContent, /脚注の本体テキスト/);
});

test("無効化: footnotes=false なら脚注参照を click しても開かない", () => {
  const doc = docWithFootnote(FOOTNOTE_ASIDE);
  installRiddlePopover(doc, { trigger: "click", footnotes: false });
  const trigger = doc.querySelector("a.footnote-reference");

  trigger.dispatchEvent(
    new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }),
  );

  const popover = doc.querySelector(".riddle-popover");
  // 生成されない、あるいは hidden のまま（いずれも「開いていない」）。
  assert.equal(popover === null || popover.hasAttribute("hidden"), true);
});

test("共有: term と脚注が同一 .riddle-popover を再利用し内容だけ差し替わる", () => {
  const dom = new JSDOM(
    "<!DOCTYPE html><body>" +
      '<a href="#term-0">用語0</a>' +
      '<template id="riddle-tip--term-0"><p>定義0</p></template>' +
      '<a class="footnote-reference brackets" href="#id3" id="id1">[1]</a>' +
      FOOTNOTE_ASIDE +
      "</body>",
  );
  const doc = dom.window.document;
  installRiddlePopover(doc, { trigger: "click" });
  const { MouseEvent } = doc.defaultView;
  const click = (sel) =>
    doc
      .querySelector(sel)
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  click('a[href="#term-0"]');
  assert.match(doc.querySelector(".riddle-popover").textContent, /定義0/);

  click("a.footnote-reference");
  const popovers = doc.querySelectorAll(".riddle-popover");
  assert.equal(popovers.length, 1, "共有 popover が複数生成されている");
  assert.match(popovers[0].textContent, /脚注の本体テキスト/);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/footnote-popover.test.mjs`
Expected: FAIL（脚注参照は現セレクタ `a[href*='#term-']` に一致せず開かない＝結合・共有テストが失敗。無効化テストはたまたま通り得るが、結合で確実に赤）

- [ ] **Step 3: 最小実装（セレクタ定数とディスパッチ）**

(a) セレクタ定数を更新する。`TRIGGER_SELECTOR`（266-267 行）を `TERM_TRIGGER_SELECTOR` へ改名し、脚注セレクタを追加:

```javascript
// 委譲リスナが反応するトリガリンクのセレクタ。
// term: DOM 契約 a[href*='#term-']。footnote: 脚注/引用参照の class。
const TERM_TRIGGER_SELECTOR = "a[href*='#term-']";
const FOOTNOTE_TRIGGER_SELECTOR = "a.footnote-reference, a.citation-reference";
```

(b) `findTriggerFromEvent`（281-288 行）を、対象セレクタを引数で受ける形へ変更:

```javascript
function findTriggerFromEvent(event, selector) {
  const trigger = event.target.closest(selector);
  // 再帰防止: ポップ配下のトリガは無視する。
  if (trigger !== null && trigger.closest(POPOVER_SELECTOR) !== null) {
    return null;
  }
  return trigger;
}
```

(c) `handleTriggerForElement`（307-317 行）を、term/footnote のディスパッチへ置き換える（旧本体は `resolveTermContent` へ切り出し）:

```javascript
/**
 * トリガ要素から term-id 導出 → template 取得 → clone と二次防御走査 を実行する。
 * @param {Document} doc
 * @param {Element} trigger
 * @returns {{trigger: Element, fragment: DocumentFragment}|null}
 */
function resolveTermContent(doc, trigger) {
  const termId = deriveTermId(trigger.getAttribute("href"));
  if (termId === null) {
    return null;
  }
  const template = getRiddleTemplate(doc, termId);
  if (template === null) {
    return null;
  }
  return { trigger, fragment: sanitizeFragment(template.content.cloneNode(true)) };
}

/**
 * トリガ種別（term / 脚注・引用）に応じて内容を解決する。いずれにも一致しなければ null。
 * @param {Document} doc
 * @param {Element} trigger
 * @returns {{trigger: Element, fragment: DocumentFragment}|null}
 */
function handleTriggerForElement(doc, trigger) {
  if (trigger.matches(TERM_TRIGGER_SELECTOR)) {
    return resolveTermContent(doc, trigger);
  }
  if (trigger.matches(FOOTNOTE_TRIGGER_SELECTOR)) {
    return resolveFootnoteContent(doc, trigger);
  }
  return null;
}
```

(d) `installRiddlePopover`（416-424 行）の options 分解に `footnotes = true` を追加し、関数本体先頭で有効トリガセレクタを構築する:

```javascript
  const {
    trigger = "both",
    openDelayMs = 150,
    closeDelayMs = 100,
    interactive = true,
    footnotes = true,
    setTimeout: setTimer = resolveViewTimer(doc, "setTimeout", () => null),
    clearTimeout: clearTimer = resolveViewTimer(doc, "clearTimeout", () => {}),
  } = options;

  // footnotes 有効時は脚注/引用参照もトリガ対象に含める（無効なら term のみ）。
  const triggerSelector = footnotes
    ? `${TERM_TRIGGER_SELECTOR}, ${FOOTNOTE_TRIGGER_SELECTOR}`
    : TERM_TRIGGER_SELECTOR;
```

(e) `findTriggerFromEvent` の2つの呼び出し箇所へ `triggerSelector` を渡す。
- `addTriggerListener` 内（533 行付近）: `const triggerEl = findTriggerFromEvent(event, triggerSelector);`
- click 委譲リスナ内（549 行付近）: `const triggerEl = findTriggerFromEvent(event, triggerSelector);`

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test tests/js/footnote-popover.test.mjs` then `npm test` then `npm run lint`
Expected: PASS（全件。既存 install-popover.test.mjs も緑：footnotes 既定 true でも term-only DOM には脚注要素が無く影響なし、click リスナ数は 1 のまま）

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/footnote-popover.test.mjs
git commit -m "feat: 脚注/引用参照のトリガ配線とディスパッチを実装"
```

---

## E2E 検証

- [ ] `npm test` と `npm run lint` が全緑
- [ ] `uv run pytest` が全緑
- [ ] `docs/` をビルドして手動確認:
  - 脚注を含むページで参照にホバー/クリック → 本体がポップアップ表示され、戻りリンク ↩ が表示されない
  - `conf.py` に `riddle_footnotes = False` を設定 → 脚注参照では開かず、glossary term は従来どおり開く
  - 既存の glossary `:term:` ポップオーバーが従来どおり動作（リグレッションなし）

ビルド手順は `docs_draft/2026-06-17-build-and-test-howto.rst` を参照（必要時のみ）。

---

## Self-Review 結果

- **Spec カバレッジ:** 内容取得＝クライアント側 DOM（Task 4）／対象＝footnote-reference・citation-reference 全形式（Task 4・5）／独立トグル `riddle_footnotes`（Task 1・2・3・5）／表示設定共有（Task 5 で同一 options 利用）／fail-closed・XSS 二次防御（Task 4, 既存 `sanitizeFragment` 再利用）— すべて対応タスクあり。
- **プレースホルダ:** TBD/TODO なし。全ステップに実コード・実コマンド・期待結果を記載。
- **型/名称整合:** `deriveFragmentId`・`resolveFootnoteContent`・`resolveTermContent`・`handleTriggerForElement`・`TERM_TRIGGER_SELECTOR`・`FOOTNOTE_TRIGGER_SELECTOR`・`isFootnoteBody`・`triggerSelector` をタスク間で一貫使用。`findTriggerFromEvent(event, selector)` の新シグネチャは全呼び出し箇所（Task 5(e)）で更新。
- **スコープ:** 既存基盤の拡張に限定。単一実装計画として適切。
