# 画像クリック→ポップアップ（ライトボックス）化 実装 Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `:target:` 付き image/figure 画像のクリックを、リンク遷移ではなく全画面ライトボックス（ポップアップ）表示に変え、画面クリックまたは ESC で閉じて元の HTML に戻す。

**Architecture:** 既存 `riddle.js` の脚注/用語ポップオーバ基盤（document への単一委譲 click リスナ＋ESC keydown＋外側クリッククローズ＋fail-closed サニタイズ＋config 伝播）を**拡張**する。新規リスナ・新規 Python ファイル・新規 docutils 変換は作らない。画像ライトボックスは別表示要素 `.riddle-lightbox`（カスタム div オーバレイ）として `installRiddlePopover` 内の既存 click/keydown リスナへ相乗りさせる。対象画像の選別は JS 側で `a.image-reference[href]` かつ href が画像拡張子のときだけ起動し、非画像 href は `preventDefault` せず通常遷移へフォールバックする（fail-closed）。

**Tech Stack:** Python ≥3.14 / Sphinx ≥9（拡張本体）、バニラ JS（ESM, 第三者ライブラリ非同梱）、CSS。テスト: pytest + beautifulsoup4（Python）、node:test + jsdom（JS）、ESLint 9 + eslint-plugin-no-unsanitized。

## Global Constraints

- 新規依存ゼロ。JS は第三者ライブラリ非同梱のバニラ堅持。
- `innerHTML`/`insertAdjacentHTML`/`eval`/`javascript:` 禁止（ESLint `no-unsanitized` 準拠）。画像 URL は `img.src` への**プロパティ代入**で設定する。
- 座標/スタイルは CSSOM プロパティ API のみ（`setAttribute('style', …)` と `style.cssText` 禁止）。
- `riddle_image_popup` の既定値は `True`（既定 ON）。runtime config では camelCase キー `imagePopup`。
- URL 安全判定は既存 `isSafeUrl`（許可スキーム `http:`/`https:`/`mailto:`）を再利用し fail-closed。
- 既存の「document への click 委譲リスナはちょうど1つ」という不変条件を壊さない（新規 addEventListener を増やさない）。
- 各タスクは Red→Green→Commit。コミットは小さく頻繁に。

---

## 設計判断の記録（要約）

4 案（ネイティブ`<dialog>`／純JS divオーバレイ／Python docutils変換マーカ／純CSS :target）を 4 観点で敵対的レビューし採点（詳細な設計解説書は `docs_draft/image_popup_design.md`）。最高得点はネイティブ`<dialog>`(22)だが、ユーザ確定事項により**純JS div オーバレイ方式・既定 ON**(21)を採用。理由: 既存の単一委譲機構を流用でき統合容易性が最高、jsdom で開閉まで単体テスト可能。

---

## File Structure

| ファイル | 役割 | 変更種別 |
|---|---|---|
| `src/sphinx_riddle_whisper/config.py` | `riddle_image_popup` 登録＋bool検証 | 変更 |
| `src/sphinx_riddle_whisper/runtime_config.py` | `imagePopup` を JS へ伝播 | 変更 |
| `src/sphinx_riddle_whisper/static/riddle.js` | 純関数・ライトボックス要素・開閉・委譲配線・config読取 | 変更 |
| `src/sphinx_riddle_whisper/static/riddle.css` | `.riddle-lightbox` スタイル＋`--riddle-backdrop` | 変更 |
| `tests/test_config.py` | 設定登録・検証テスト | 変更 |
| `tests/test_runtime_config.py` | 伝播・統合テスト | 変更 |
| `tests/js/riddle-config.test.mjs` | `readRiddleConfig` テスト | 変更 |
| `tests/js/image-lightbox.test.mjs` | 純関数・委譲・開閉テスト | 新規 |
| `tests/roots/test-image-popup/{conf.py,index.rst,pic.png}` | `a.image-reference` 確認用 testroot | 新規 |
| `tests/test_image_popup_build.py` | `a.image-reference[href]` 出力の guard テスト | 新規 |

**保存先:** 承認後、本 Spec を `docs/superpowers/plans/2026-06-19-image-popup-lightbox.md` へ転記する（plan mode 中は本ファイルのみ編集可のため）。

---

### Task 1: Python 設定 `riddle_image_popup` の登録と bool 検証

**Files:**
- Modify: `src/sphinx_riddle_whisper/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: 既存 `_CONFIG_SPECS`、`validate_config`、`register_config_values`、`_validate_non_negative_int`（書式の手本）
- Produces: 設定値 `riddle_image_popup`（bool, 既定 True, rebuild "html"）、ヘルパ `_validate_bool(name: str, value) -> None`

- [ ] **Step 1: テスト用ヘルパ・期待集合を更新（既存テストの前提を保つ）**

`tests/test_config.py` の `_EXPECTED_CONFIG_NAMES`（13-27行のセット）に1行追加:
```python
    "riddle_footnotes",
    "riddle_image_popup",
}
```
同ファイルの `_make_default_config`（30-48行）の `values` dict に1行追加（既存 `validate_config` が新キーを参照するため、これが無いと全既定テストが AttributeError になる）:
```python
        "riddle_footnotes": True,
        "riddle_image_popup": True,
```

- [ ] **Step 2: 失敗するテストを追加**

`tests/test_config.py` の末尾に追記:
```python
def test_riddle_image_popupが非boolのときExtensionErrorを送出する():
    """riddle_image_popup が bool 以外（例 'yes'）なら validate_config が ExtensionError を raise する。"""
    config = _make_default_config(riddle_image_popup="yes")
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_image_popupの既定値がTrueのboolで登録される():
    """register_config_values が riddle_image_popup を既定値 True（bool）で add_config_value 登録する。"""
    app = MagicMock()
    register_config_values(app)
    defaults = {
        call.args[0]: call.args[1] for call in app.add_config_value.call_args_list
    }
    assert "riddle_image_popup" in defaults
    assert defaults["riddle_image_popup"] is True
    assert isinstance(defaults["riddle_image_popup"], bool)
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_config.py -q`
Expected: FAIL — `test_riddle_image_popupが非boolのときExtensionErrorを送出する` が `DID NOT RAISE`（まだ検証が無い）、登録テストは `riddle_image_popup not in defaults`。

- [ ] **Step 4: 実装を追加**

`src/sphinx_riddle_whisper/config.py` の `_CONFIG_SPECS` 末尾（25行 `("riddle_footnotes", True, "html"),` の直後）に1行追加:
```python
    ("riddle_footnotes", True, "html"),
    ("riddle_image_popup", True, "html"),
)
```
`_validate_non_negative_int` の直後（42行付近）に bool 検証ヘルパを追加:
```python
def _validate_bool(name: str, value) -> None:
    """value が bool でなければ ExtensionError を raise する。"""
    if not isinstance(value, bool):
        raise ExtensionError(f"{name} は bool である必要があります: {value!r}")
```
`validate_config` の `_validate_non_negative_int(...)` 呼び出し（63-64行）の直後に1行追加:
```python
    _validate_non_negative_int("riddle_close_delay_ms", config.riddle_close_delay_ms)
    _validate_bool("riddle_image_popup", config.riddle_image_popup)
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `uv run pytest tests/test_config.py -q`
Expected: PASS（全件）。

- [ ] **Step 6: コミット**

```bash
git add src/sphinx_riddle_whisper/config.py tests/test_config.py
git commit -m "feat: riddle_image_popup 設定の登録と bool 検証"
```

---

### Task 2: Python ランタイム設定 `imagePopup` の伝播

**Files:**
- Modify: `src/sphinx_riddle_whisper/runtime_config.py`
- Test: `tests/test_runtime_config.py`

**Interfaces:**
- Consumes: `build_runtime_config(config)`、`encode_config_json`、`inject_runtime_config`、Task 1 の `riddle_image_popup`
- Produces: runtime config dict に `"imagePopup": config.riddle_image_popup`

- [ ] **Step 1: 既存テストの config 互換オブジェクトと期待 dict を更新**

`tests/test_runtime_config.py` 内で `build_runtime_config` に渡す **すべての** `SimpleNamespace`（34-42, 62-70, 265-273, 296-304行）に `riddle_image_popup=True` を1行追加する（無いと `config.riddle_image_popup` 参照で AttributeError）。代表例（34-42行）:
```python
    config = SimpleNamespace(
        riddle_trigger="click",
        riddle_open_delay_ms=42,
        riddle_close_delay_ms=7,
        riddle_interactive=False,
        riddle_max_height="9rem",
        riddle_max_width="18rem",
        riddle_footnotes=False,
        riddle_image_popup=True,
    )
```
全体一致アサート（46-54行）の期待 dict に1行追加:
```python
        "footnotes": False,
        "imagePopup": True,
    }
```

- [ ] **Step 2: 失敗するテストを追加**

`tests/test_runtime_config.py` の `test_build_runtime_configはfootnotesにTrueも正しく伝播する` の直後に追記:
```python
def test_build_runtime_configはimage_popupをimagePopupへ伝播する():
    """[unit] build_runtime_config が riddle_image_popup を camelCase キー imagePopup へ伝播する。"""
    config = SimpleNamespace(
        riddle_trigger="both",
        riddle_open_delay_ms=150,
        riddle_close_delay_ms=100,
        riddle_interactive=True,
        riddle_max_height="24rem",
        riddle_max_width="32rem",
        riddle_footnotes=True,
        riddle_image_popup=False,
    )

    payload = build_runtime_config(config)

    assert payload["imagePopup"] is False
```
さらに統合テスト（既存 `test_実ビルドで...footnotesが未指定時は既定Trueになる` の下）に追記:
```python
@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_実ビルドでriddle_config要素のimagePopupが未指定時は既定Trueになる(app):
    """[integration] conf 未指定でビルドした #riddle-config JSON の imagePopup が既定 True。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    payload = _extract_riddle_config_json(html)
    assert payload["imagePopup"] is True, (
        f"未指定時の既定 imagePopup=True が入っていない（payload={payload!r}）"
    )
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_runtime_config.py -q`
Expected: FAIL — `KeyError: 'imagePopup'`（dict にまだキーが無い）。

- [ ] **Step 4: 実装を追加**

`src/sphinx_riddle_whisper/runtime_config.py` の `build_runtime_config` の返す dict（29-37行）の末尾に1行追加:
```python
        "footnotes": config.riddle_footnotes,
        "imagePopup": config.riddle_image_popup,
    }
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `uv run pytest tests/test_runtime_config.py -q`
Expected: PASS（全件）。

- [ ] **Step 6: コミット**

```bash
git add src/sphinx_riddle_whisper/runtime_config.py tests/test_runtime_config.py
git commit -m "feat: imagePopup を runtime config へ伝播"
```

---

### Task 3: JS 純関数 `isSafeImageHref` / `resolveImageSrc`（＋ `isSafeUrl` の export 化）

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`
- Test: `tests/js/image-lightbox.test.mjs`（新規）

**Interfaces:**
- Consumes: 既存 `isSafeUrl(value)`（198行）、`globalThis.URL`
- Produces:
  - `export function isSafeUrl(value): boolean`（既存を export 化）
  - `export function isSafeImageHref(href: string, baseURI: string): boolean`
  - `export function resolveImageSrc(trigger: Element, baseURI: string): string|null`
  - 定数 `IMAGE_TRIGGER_SELECTOR = "a.image-reference[href]"`、`IMAGE_EXT`（画像拡張子の正規表現）

- [ ] **Step 1: 失敗するテストを新規作成**

`tests/js/image-lightbox.test.mjs` を新規作成:
```javascript
// 画像ライトボックス（純関数・委譲・開閉）の単体/統合テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  isSafeImageHref,
  resolveImageSrc,
} from "../../src/sphinx_riddle_whisper/static/riddle.js";

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
});

test("isSafeImageHref: 非画像・アンカー・危険スキームは false", () => {
  assert.equal(isSafeImageHref("#anchor", BASE), false);
  assert.equal(isSafeImageHref("../other/doc.html", BASE), false);
  assert.equal(isSafeImageHref("https://example.com/page", BASE), false);
  assert.equal(isSafeImageHref("javascript:alert(1)", BASE), false);
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/image-lightbox.test.mjs`
Expected: FAIL — `isSafeImageHref`/`resolveImageSrc` が `riddle.js` から export されていない（`SyntaxError`/`undefined`）。

- [ ] **Step 3: 実装を追加**

`src/sphinx_riddle_whisper/static/riddle.js` を編集:

(a) 198行の `function isSafeUrl(value) {` 宣言を export 付きへ:
```javascript
export function isSafeUrl(value) {
```

(b) 委譲セレクタ定数群（293-294行付近）に画像トリガセレクタと画像拡張子を追加:
```javascript
const FOOTNOTE_TRIGGER_SELECTOR = "a.footnote-reference, a.citation-reference";
// 画像ライトボックスのトリガ: :target: 付き image/figure が生成する image-reference アンカー。
const IMAGE_TRIGGER_SELECTOR = "a.image-reference[href]";
// 画像拡張子（href がこれに一致するときだけライトボックス化する。fail-closed）。
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i;
```

(c) `isSafeUrl` の直後（219行の `}` の後）に2つの純関数を追加:
```javascript
/**
 * href が安全スキームかつ画像拡張子を指すかを判定する（fail-closed）。
 * @param {string} href トリガアンカーの href
 * @param {string} baseURI 相対 href 解決のベース（doc.baseURI）
 * @returns {boolean}
 */
export function isSafeImageHref(href, baseURI) {
  if (typeof href !== "string" || !isSafeUrl(href)) {
    return false;
  }
  let url;
  try {
    url = new globalThis.URL(href, baseURI);
  } catch {
    // baseURI が about:blank 等で相対解決に使えないときの合成ベース（isSafeUrl と同手法）。
    try {
      url = new globalThis.URL(href, "http://example.invalid/");
    } catch {
      return false;
    }
  }
  return IMAGE_EXT.test(url.pathname);
}

/**
 * 画像トリガから表示すべき src（=安全な画像 href）を解決する純関数。
 * img 子が無い／href が非画像・危険スキームなら null（→ 通常遷移へ委ねる）。
 * @param {Element} trigger a.image-reference 要素
 * @param {string} baseURI 相対 href 解決のベース（doc.baseURI）
 * @returns {string|null}
 */
export function resolveImageSrc(trigger, baseURI) {
  const img = trigger.querySelector("img");
  if (img === null) {
    return null;
  }
  const href = trigger.getAttribute("href");
  if (href === null || !isSafeImageHref(href, baseURI)) {
    return null;
  }
  return href;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test tests/js/image-lightbox.test.mjs` および `npm run lint`
Expected: PASS（5 テスト）／lint エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/image-lightbox.test.mjs
git commit -m "feat: 画像 href 判定の純関数（isSafeImageHref/resolveImageSrc）"
```

---

### Task 4: JS `readRiddleConfig` が `imagePopup` を伝える（既定 true・fail-closed）

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`
- Test: `tests/js/riddle-config.test.mjs`

**Interfaces:**
- Consumes: 既存 `CONFIG_DEFAULTS`（684行）、`readRiddleConfig`（715行）
- Produces: `readRiddleConfig` 戻り値に `imagePopup: boolean`（既定 true、非 boolean は true へ正規化）

- [ ] **Step 1: 既存テストの DEFAULTS と期待値を更新**

`tests/js/riddle-config.test.mjs` の `DEFAULTS`（17-25行）に1行追加:
```javascript
  footnotes: true,
  imagePopup: true,
};
```
`readRiddleConfig: 正常 JSON は各フィールドを反映する` の期待 dict（61-69行）末尾に追加:
```javascript
    footnotes: DEFAULTS.footnotes,
    imagePopup: DEFAULTS.imagePopup,
  });
```
`readRiddleConfig: 不正フィールドは個別に既定へ正規化する` の期待 dict（102-110行）末尾に追加:
```javascript
    footnotes: DEFAULTS.footnotes,
    imagePopup: DEFAULTS.imagePopup,
  });
```

- [ ] **Step 2: 失敗するテストを追加**

`tests/js/riddle-config.test.mjs` の `readRiddleConfig: footnotes は boolean のみ採用...` テストの直後に追記:
```javascript
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
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `node --test tests/js/riddle-config.test.mjs`
Expected: FAIL — 既存 deepEqual テストが `imagePopup` の差分で失敗、新テストは `undefined !== true`。

- [ ] **Step 4: 実装を追加**

`src/sphinx_riddle_whisper/static/riddle.js` の `CONFIG_DEFAULTS`（684-692行）に1行追加:
```javascript
  footnotes: true,
  imagePopup: true,
});
```
`readRiddleConfig` の返すオブジェクト（730-754行）の `footnotes` フィールドの直後に追加:
```javascript
    footnotes:
      typeof raw.footnotes === "boolean"
        ? raw.footnotes
        : CONFIG_DEFAULTS.footnotes,
    imagePopup:
      typeof raw.imagePopup === "boolean"
        ? raw.imagePopup
        : CONFIG_DEFAULTS.imagePopup,
  };
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `node --test tests/js/riddle-config.test.mjs` および `npm run lint`
Expected: PASS（全件）／lint エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/riddle-config.test.mjs
git commit -m "feat: readRiddleConfig が imagePopup を fail-closed 正規化"
```

---

### Task 5: JS ライトボックス要素生成と「クリックで開く」配線

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`
- Test: `tests/js/image-lightbox.test.mjs`

**Interfaces:**
- Consumes: Task 3 の `resolveImageSrc`/`IMAGE_TRIGGER_SELECTOR`、既存 `installRiddlePopover`（506行）、`getPopover`（手本, 468行）
- Produces:
  - 定数 `LIGHTBOX_CLASS = "riddle-lightbox"`、`LIGHTBOX_SELECTOR`
  - `getLightbox(doc): Element`（共有 `<div class="riddle-lightbox" role="dialog" aria-modal="true" tabindex="-1" hidden>` ＋内側 `<img class="riddle-lightbox__img">`）
  - `isLightboxOpen(doc): boolean`
  - `installRiddlePopover` の option に `imagePopup`（既定 false）、内部 closure `openLightbox(triggerEl, src)`

- [ ] **Step 1: 失敗するテストを追加**

`tests/js/image-lightbox.test.mjs` に追記:
先頭の import 行を `VirtualConsole` と `installRiddlePopover` を含む形へ更新する:
```javascript
import { JSDOM, VirtualConsole } from "jsdom";
```
```javascript
import { installRiddlePopover } from "../../src/sphinx_riddle_whisper/static/riddle.js";

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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/image-lightbox.test.mjs`
Expected: FAIL — `imagePopup` option 未処理で画像 click が `preventDefault` されない。

- [ ] **Step 3: 実装を追加 — 要素生成ヘルパ（モジュールレベル）**

`src/sphinx_riddle_whisper/static/riddle.js` の `getPopover`（468-477行）の直後に追加:
```javascript
// DOM 契約: 画像ライトボックスの class 名とセレクタ。
const LIGHTBOX_CLASS = "riddle-lightbox";
const LIGHTBOX_SELECTOR = `.${LIGHTBOX_CLASS}`;

/**
 * 共有 .riddle-lightbox（単一要素）を取得する。無ければ生成して body に append し
 * 内側に <img> を持たせる（初期は hidden）。getPopover と同型（querySelector で
 * 引くため DOM clobbering 耐性）。
 * @param {Document} doc 対象 document
 * @returns {Element} 共有 .riddle-lightbox 要素
 */
function getLightbox(doc) {
  let lightbox = doc.querySelector(LIGHTBOX_SELECTOR);
  if (lightbox === null) {
    lightbox = doc.createElement("div");
    lightbox.className = LIGHTBOX_CLASS;
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("tabindex", "-1");
    lightbox.setAttribute("hidden", "");
    const img = doc.createElement("img");
    img.className = `${LIGHTBOX_CLASS}__img`;
    lightbox.appendChild(img);
    doc.body.appendChild(lightbox);
  }
  return lightbox;
}

/**
 * 共有ライトボックスが表示中（存在し hidden でない）かを返す。
 * @param {Document} doc 対象 document
 * @returns {boolean}
 */
function isLightboxOpen(doc) {
  const lightbox = doc.querySelector(LIGHTBOX_SELECTOR);
  return lightbox !== null && !lightbox.hasAttribute("hidden");
}
```

- [ ] **Step 4: 実装を追加 — option 追加・openLightbox closure・click 配線**

`installRiddlePopover` の options 分割代入（507-515行）に `imagePopup` を追加（既定 false は意図的: 直接 `installRiddlePopover()` を呼ぶ既存テスト/将来コードでは OFF が安全側。production は `initRiddle` が `readRiddleConfig` の `cfg.imagePopup`（既定 true）をそのまま渡すため ON で動く）:
```javascript
    interactive = true,
    footnotes = true,
    imagePopup = false,
    setTimeout: setTimer = resolveViewTimer(doc, "setTimeout", () => null),
```
`activeTrigger`/`openedByFocus` 宣言（529-531行）の直後に画像用の状態を追加:
```javascript
  let openedByFocus = false;
  // 現在開いている画像ライトボックスの起点トリガ（閉じる時の focus 復帰用）。
  let activeImageTrigger = null;
```
`closePopover`（573-590行）の直後に開閉 closure を追加:
```javascript
  function openLightbox(triggerEl, src) {
    const lightbox = getLightbox(doc);
    const img = lightbox.querySelector("img");
    // src は resolveImageSrc が isSafeImageHref で検証済み。プロパティ代入（innerHTML 不使用）。
    img.src = src;
    const innerImg = triggerEl.querySelector("img");
    const alt = innerImg !== null ? innerImg.getAttribute("alt") || "" : "";
    img.alt = alt;
    lightbox.setAttribute("aria-label", alt);
    activeImageTrigger = triggerEl;
    lightbox.removeAttribute("hidden");
    if (typeof lightbox.focus === "function") {
      lightbox.focus();
    }
  }

  function closeLightbox() {
    const lightbox = doc.querySelector(LIGHTBOX_SELECTOR);
    if (lightbox !== null) {
      lightbox.setAttribute("hidden", "");
    }
    if (activeImageTrigger !== null) {
      const toRestore = activeImageTrigger;
      activeImageTrigger = null;
      if (typeof toRestore.focus === "function") {
        toRestore.focus();
      }
    }
  }
```
既存の click 委譲リスナ（644-656行）を次の内容へ差し替える（先頭に画像分岐を追加。term/footnote 経路は不変）:
```javascript
  doc.addEventListener("click", (event) => {
    // 画像ライトボックス: 画像トリガなら遷移を抑止して開く（先頭で判定）。
    // href が非画像なら preventDefault せず通常遷移へ委ねる（fail-closed）。
    if (imagePopup) {
      const imageTrigger = event.target.closest(IMAGE_TRIGGER_SELECTOR);
      if (
        imageTrigger !== null &&
        imageTrigger.closest(LIGHTBOX_SELECTOR) === null
      ) {
        const src = resolveImageSrc(imageTrigger, doc.baseURI);
        if (src !== null) {
          event.preventDefault();
          openLightbox(imageTrigger, src);
          return;
        }
      }
    }
    const triggerEl = findTriggerFromEvent(event, triggerSelector);
    if (triggerEl !== null) {
      if (openOnClick) {
        openFromTrigger(triggerEl);
      }
      return;
    }
    // トリガでもポップ内でもない外側クリックなら閉じる。
    if (isOutsidePopover(event)) {
      closePopover();
    }
  });
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `node --test tests/js/image-lightbox.test.mjs` と `npm test`（全 JS）と `npm run lint`
Expected: PASS（既存 install-popover/riddle-config を含む全 JS テスト）／lint エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/image-lightbox.test.mjs
git commit -m "feat: 画像クリックでライトボックスを開く（委譲リスナへ相乗り）"
```

> **注意（中間状態）**: Task 5 完了時点では「開く」のみで、閉じる経路（任意クリック・ESC）は Task 6 で追加する。Task 5 単独では開いたライトボックスを閉じられない。**Task 5 と Task 6 はセットで完成**であり、Task 5 単独で受け入れ確認（手動の開閉確認）をしないこと。

---

### Task 6: JS 閉じる挙動（画面クリック・ESC・focus 復帰）

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`
- Test: `tests/js/image-lightbox.test.mjs`

**Interfaces:**
- Consumes: Task 5 の `isLightboxOpen`/`closeLightbox`/`openLightbox`、既存 keydown リスナ（659-663行）
- Produces: ライトボックス表示中の任意クリック・ESC で閉じる挙動、閉時のトリガ focus 復帰

- [ ] **Step 1: 失敗するテストを追加**

`tests/js/image-lightbox.test.mjs` に追記:
```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/image-lightbox.test.mjs`
Expected: FAIL — 任意クリック/ESC でまだ閉じない（`hidden` が付かない）。

- [ ] **Step 3: 実装を追加 — click 先頭に「表示中なら閉じる」、keydown に closeLightbox**

Task 5 で差し替えた click リスナの**先頭**（`if (imagePopup) {` の直前）に、表示中クローズ分岐を追加:
```javascript
  doc.addEventListener("click", (event) => {
    // 画像ライトボックス表示中は、どこをクリックしても閉じる（要件②）。
    // 開いた当該クリックは下の open 経路が return するためここへは到達しない。
    if (imagePopup && isLightboxOpen(doc)) {
      closeLightbox();
      return;
    }
    if (imagePopup) {
      const imageTrigger = event.target.closest(IMAGE_TRIGGER_SELECTOR);
      // …（Task 5 の open 分岐そのまま）
```
既存の keydown リスナ（659-663行）を差し替え:
```javascript
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePopover();
      if (imagePopup) {
        closeLightbox();
      }
    }
  });
```

> **補足（クローズ経路の前提）**: ライトボックス表示中は、画像トリガ自身の再クリックを含む**すべての click が先頭分岐で閉じ経路へ入る**（open 経路へは到達しない）。これは CSS（Task 7 の `position:fixed; inset:0; z-index:2147483646`）でオーバレイが下層トリガを物理的に覆うことが前提（jsdom には座標ヒットテストが無いため、この物理被覆は Task 9 の実ブラウザ目視で確認する）。ESC では `closePopover()` → `closeLightbox()` の順で呼ぶ。両方同時に開く導線は実運用に無い想定だが、万一同時に開いている異常時は画像トリガへの focus が後勝ちになる。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test` と `npm run lint`
Expected: PASS（全 JS テスト）／lint エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/image-lightbox.test.mjs
git commit -m "feat: ライトボックスを画面クリック/ESC で閉じ focus を復帰"
```

---

### Task 7: CSS `.riddle-lightbox` スタイルと `--riddle-backdrop`

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.css`

**Interfaces:**
- Consumes: 既存 CSS 変数 `--riddle-shadow`/`--riddle-radius`、`:root` と dark の変数ブロック
- Produces: `.riddle-lightbox` の全画面オーバレイ表示、`--riddle-backdrop` 変数

- [ ] **Step 1: 実装を追加 — `--riddle-backdrop` 変数**

`src/sphinx_riddle_whisper/static/riddle.css` の `:root`（3-14行）末尾に1行追加:
```css
  --riddle-code-bg: #f4f4f4;
  --riddle-backdrop: rgba(0, 0, 0, 0.85);
}
```
dark の `:root`（17-23行）末尾に1行追加:
```css
    --riddle-code-bg: #2a2a2a;
    --riddle-backdrop: rgba(0, 0, 0, 0.9);
  }
```

- [ ] **Step 2: 実装を追加 — `.riddle-lightbox` ルール群**

ファイル末尾（63行 `.riddle-popover[hidden] { display: none; }` の後）に追加:
```css
.riddle-lightbox {
  position: fixed;
  inset: 0;
  /* 既存 .riddle-popover（2147483647）より 1 小さく、同時表示時は popover を上に。 */
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--riddle-backdrop);
}

.riddle-lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  width: auto;
  height: auto;
  object-fit: contain;
  box-shadow: var(--riddle-shadow);
  border-radius: var(--riddle-radius);
}

.riddle-lightbox[hidden] {
  display: none;
}

@media print {
  .riddle-lightbox {
    display: none !important;
  }
}
```

- [ ] **Step 3: lint と JS テストが影響を受けないことを確認**

Run: `npm run lint` と `npm test`
Expected: PASS（ESLint は CSS を対象にしないが、JS 全体の回帰がないことを確認）。CSS の見た目は Task 9 の実ビルドで目視確認する。

- [ ] **Step 4: コミット**

```bash
git add src/sphinx_riddle_whisper/static/riddle.css
git commit -m "feat: .riddle-lightbox オーバレイ CSS（ダーク/印刷対応）"
```

---

### Task 8: `a.image-reference[href]` 出力の guard テスト（新規 testroot）

**Files:**
- Create: `tests/roots/test-image-popup/conf.py`
- Create: `tests/roots/test-image-popup/index.rst`
- Create: `tests/roots/test-image-popup/pic.png`（既存アセットを複製）
- Create: `tests/test_image_popup_build.py`

**Interfaces:**
- Consumes: `tests/conftest.py` の `rootdir` fixture（testroot を `tests/roots/test-<name>/` へ配線）
- Produces: `:target:` 付き image が `<a class="… image-reference" href>` を生成することを固定する回帰テスト（JS 側セレクタ `IMAGE_TRIGGER_SELECTOR` の前提保証）

- [ ] **Step 1: testroot を作成（画像アセットは既存を複製）**

```bash
mkdir -p tests/roots/test-image-popup
cp tests/roots/test-pages/pic.png tests/roots/test-image-popup/pic.png
```
`tests/roots/test-image-popup/conf.py`:
```python
"""画像ポップアップ（a.image-reference 出力）確認用 Sphinx 設定。"""

project = "riddle-image-popup"
extensions = ["sphinx_riddle_whisper"]
master_doc = "index"
```
`tests/roots/test-image-popup/index.rst`（image と figure の両方を `:target:` 付きで置く）:
```rst
画像ポップアップ
================

.. image:: pic.png
   :alt: サンプル画像
   :target: https://example.com/full.png

.. figure:: pic.png
   :alt: サンプル図
   :target: https://example.com/fig.png

   図のキャプション。

非画像ターゲットの `別ページ <https://example.com/page.html>`_ も置く。
```

- [ ] **Step 2: 失敗するテストを作成**

`tests/test_image_popup_build.py`:
```python
"""実ビルドで :target: 付き image が a.image-reference[href] を生成することの guard テスト。"""

from pathlib import Path

import pytest
from bs4 import BeautifulSoup


@pytest.mark.sphinx("html", testroot="image-popup", warningiserror=True)
def test_target付きimageがimage_referenceアンカーを生成する(app):
    """:target: 付き image の出力が <a class="… image-reference" href="…"> を持つ。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.select("a.image-reference[href]")
    assert anchors, "image-reference クラスを持つアンカーが出力されていない"
    assert any(
        a.get("href") == "https://example.com/full.png" and a.find("img") is not None
        for a in anchors
    ), "img を内包する :target: 画像（image）アンカーが見つからない"


@pytest.mark.sphinx("html", testroot="image-popup", warningiserror=True)
def test_target付きfigureがimage_referenceアンカーを生成する(app):
    """:target: 付き figure の出力も <a class="… image-reference" href="…"><img> を持つ
    （JS の IMAGE_TRIGGER_SELECTOR が figure 由来アンカーにも発火する前提を固定）。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.select("a.image-reference[href]")
    assert any(
        a.get("href") == "https://example.com/fig.png" and a.find("img") is not None
        for a in anchors
    ), "img を内包する :target: 画像（figure）アンカーが見つからない"
```

- [ ] **Step 3: テストを実行して成功を確認（回帰 guard・Red フェーズ無し）**

> このタスクは Sphinx/docutils の出力（`a.image-reference[href]`）を固定する **回帰 guard** であり、Red→Green サイクルを持たない（Global Constraints の Red→Green→Commit の例外）。`:target:` 付き image・figure が共に `<a class="reference external image-reference" href="…"><img …>` を生成することは現行の Sphinx 9 / docutils で確認済み。将来 Sphinx/docutils 変更でこの前提が崩れたら本テストが落ちて気づける。

Run: `uv run pytest tests/test_image_popup_build.py -q`
Expected: PASS（image・figure の 2 件）。

- [ ] **Step 4: コミット**

```bash
git add tests/roots/test-image-popup tests/test_image_popup_build.py
git commit -m "test: a.image-reference[href] 出力の guard テストと testroot"
```

---

### Task 9: エンドツーエンド検証（全テスト・lint・実ビルド目視）

**Files:**
- Modify: `docs/` 配下に `:target:` 付き image/figure を持つページ（既存 `docs/index.rst` 等に追記、または検証用に一時追加）

**Interfaces:**
- Consumes: 全タスクの成果
- Produces: 実ブラウザでの挙動確認（受け入れ確認）

- [ ] **Step 1: 全自動テストと lint を通す**

Run:
```bash
uv run pytest -q
npm test
npm run lint
```
Expected: すべて PASS／lint エラーなし。

- [ ] **Step 2: ドキュメントへ検証用の `:target:` 画像を追加（恒久サンプルとして残す）**

`docs/` には画像も `_static/` も存在しないため、既存アセットを複製する:
```bash
mkdir -p docs/_static
cp tests/roots/test-pages/pic.png docs/_static/sample.png
```
`docs/index.rst` の末尾に追記する（恒久的な機能デモとして残す）:
```rst
画像ポップアップのデモ
======================

.. image:: _static/sample.png
   :alt: サンプル画像
   :target: _static/sample.png
```

- [ ] **Step 3: 実ビルドして目視確認**

Run: `uv run sphinx-build -b html docs docs/_build/html`
ブラウザで `docs/_build/html/<該当ページ>.html` を開き、次を確認:
- 画像クリックで全画面ライトボックスが開く（リンク遷移しない・URL が変わらない）。
- ライトボックスのどこか（画像含む）をクリックで閉じる。
- ESC で閉じる。閉じた後フォーカスが画像リンクへ戻る。
- 非画像 `:target:`（外部 URL/内部アンカー）のリンクは従来どおり遷移する。
- `:target:` 付き `figure` でも同様にライトボックスが開く。`figure` で `:alt:` 未指定時の `aria-label`（画像パスが入りうる）を確認する。
- ダークモードで暗幕色が切り替わる／印刷プレビューで暗幕が出ない。

- [ ] **Step 4: 完了コミット**

Step 2 のデモは恒久サンプルとして残す（revert しない）。

```bash
git add docs/_static/sample.png docs/index.rst
git commit -m "docs: 画像ポップアップのデモ画像を追加"
```

---

## Self-Review メモ（実装前チェック済み・敵対的レビュー反映済み）

本 Spec は 4 観点（整合性／jsdom 実行可能性／実装ロジック／writing-plans 準拠）の敵対的レビューを受け、確定指摘を反映済み（`npm test -- <file>` の glob 非絞り込み→`node --test`、未使用 const の lint 落ち除去、figure カバレッジ追加、行番号 198 訂正、navigation ノイズ抑止 等）。

- **Spec coverage**: 検証計画の JS 12 項目は Task 3（純関数4）・Task 5（開く・非画像・無効時・単一リスナ）・Task 6（任意クリック・ESC・focus復帰・冪等）・Task 4（config正規化）で網羅。Python 4 項目は Task 1（c: 非bool ExtensionError）・Task 2（a/b: 既定/false 伝播）・Task 8（d: a.image-reference を **image と figure の両方**で）で網羅。
- **テストランナー**: `package.json` の `test` は `node --test 'tests/js/**/*.test.mjs'`（glob 固定）。単一ファイルの Red/Green 観察は `node --test <file>` を直接使う。`npm test`／`npm run lint` は最終全件確認に使う。
- **クロスファイル整合性（重要）**: 設定キー追加に伴い、`tests/test_config.py` の `_EXPECTED_CONFIG_NAMES`・`_make_default_config`、`tests/test_runtime_config.py` の全 `SimpleNamespace`（34/62/265/296行の4ブロック）と全体一致 dict、`tests/js/riddle-config.test.mjs` の `DEFAULTS` と 2 箇所の期待 dict を**同一タスク内で**更新する（Task 1/2/4 に明記済み）。漏らすと既存テストが AttributeError/deepEqual 差分で落ちる。
- **型整合性**: `resolveImageSrc(trigger, baseURI)`・`isSafeImageHref(href, baseURI)`・`openLightbox(triggerEl, src)`・`closeLightbox()`・`isLightboxOpen(doc)`・`getLightbox(doc)` の名前と引数は全タスクで一致。
- **bool 検証の方針差**: `riddle_image_popup` は `riddle_footnotes`（検証しない前例）と異なり、明示的に bool 検証して `ExtensionError` を投げる（検証計画 (c) の要求。意図的な差分）。
- **jsdom 留意**: `defaultPrevented`・`KeyboardEvent`・`focus()`/`activeElement`・`img.src` 代入・`:not([hidden])` セレクタ・`new URL(rel, doc.baseURI)` 解決は jsdom v25 で動作確認済み。`getLightbox` の `tabindex="-1"` は focus 復帰テスト成立の前提。実ブラウザ依存の見た目（暗幕・object-fit・オーバレイの物理被覆）は Task 9 の目視に委ねる。
- **既知の a11y 挙動**: figure で `:alt:` 未指定のとき Sphinx は img alt に画像パス（例 `_images/pic.png`）を出すため、ライトボックスの `aria-label` にパスが入りうる。初版は許容し、Task 9 の目視確認項目に含める（改善は後続）。

## Execution Handoff

承認後、本 Spec を `docs/superpowers/plans/2026-06-19-image-popup-lightbox.md` へ転記し、`/tdd-js`（JS: Task 3-6）と `/tdd`（Python: Task 1-2, 8）のワークフロー、または subagent-driven-development で順に実装する。
