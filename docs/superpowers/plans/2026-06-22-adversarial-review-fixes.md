# 敵対的レビュー指摘対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs_draft/2026-06-21-commit-adversarial-review.md` の「推奨対応順」1〜5を実装し、`srcset` data URI、encoded singlehtml term link、非 URL 属性の `data:` 文字列、config generator 消費の4指摘を回帰テスト付きで閉じる。

**Architecture:** 既存の sanitizer は nh3 の `attribute_filter` を中心に保ち、URL-bearing 属性だけを fail-closed 判定へ通す。JS は既存の document 単一委譲リスナを維持し、入口セレクタだけを encoded singlehtml fragment へ拡張する。config は `validate_config` 時点で one-shot iterator を `tuple[str, ...]` へ正規化して downstream が再走査できる値に固定する。

**Tech Stack:** Python >=3.14 / Sphinx >=9 / nh3 / pytest / uv / バニラ JS ESM / node:test + jsdom / ESLint 9 + eslint-plugin-no-unsanitized。

## Global Constraints

- 新規依存は追加しない。
- sanitizer は安全な画像 `data:` URI の `img[src]` だけを許可し、`svg+xml` と非画像 `data:` は fail-closed で除去する。
- `srcset` は data URI 候補を含む場合、属性ごと削除する。安全な画像 data URI も `img[src]` 以外では許可しない。
- `alt`、`title`、`class`、`id` は URL-bearing 属性として扱わず、`data:` で始まる通常テキスト値を保持する。
- JS は既存の document 単一 click 委譲を維持し、リンク個別リスナを追加しない。
- `deriveTermId()` の fail-closed 判定を最終判定として維持し、入口セレクタは粗い絞り込みに留める。
- config の文字列 iterable は検証時に `tuple[str, ...]` へ正規化し、generator を検証後に空にしない。
- 各実装タスクは Red -> Green -> Commit の順に進める。

---

## File Structure

| ファイル | 役割 | 変更種別 |
|---|---|---|
| `src/sphinx_riddle_whisper/sanitize.py` | `srcset` 内 data URI 検出、URL-bearing 属性限定、非 URL テキスト属性保持 | 変更 |
| `tests/test_sanitize.py` | `srcset` data URI 除去、`title`/`alt` の `data:` 文字列保持を固定 | 変更 |
| `src/sphinx_riddle_whisper/static/riddle.js` | term trigger selector に `%23term-` を追加し encoded singlehtml link を委譲入口に通す | 変更 |
| `tests/js/install-popover.test.mjs` | encoded singlehtml link の click 統合テスト | 変更 |
| `src/sphinx_riddle_whisper/config.py` | 文字列 iterable 検証を `tuple` 正規化へ変更 | 変更 |
| `tests/test_config.py` | generator config が検証後も保持されることを固定 | 変更 |

---

### Task 1: `srcset` に含まれる `data:` URI を fail-closed にする

**Files:**
- Modify: `src/sphinx_riddle_whisper/sanitize.py`
- Test: `tests/test_sanitize.py`

**Interfaces:**
- Consumes: `sanitize_html(html: str, *, enabled: bool = True, allowed_tags: set[str] | None = None, allowed_attributes: dict[str, set[str]] | None = None, allowed_schemes: set[str] | None = None) -> str`
- Produces: `_contains_data_scheme_candidate(value: str) -> bool`。`_data_uri_attribute_filter(tag: str, attr: str, value: str) -> str | None` が `srcset` 内の `data:` 候補を検出したら `None` を返す。

- [ ] **Step 1: 失敗する `srcset` 回帰テストを書く**

`tests/test_sanitize.py` の `test_custom属性data上のdataスキームは許可リストを広げても除去される` の直後に追加する。

```python
def test_img_srcsetの2件目以降にある危険dataスキーム候補は属性ごと除去される():
    """img[srcset] を許可した場合でも、候補内の data: URI は srcset 属性ごと fail-closed で除去する。"""
    dangerous_uris = [
        "data:image/svg+xml,<svg onload=alert(1)>",
        "data:text/html,<script>alert(1)</script>",
    ]

    for uri in dangerous_uris:
        html = (
            '<img srcset="https://safe.example/a.png 1x, '
            f'{uri} 2x" alt="x">'
        )

        result = sanitize_html(
            html,
            allowed_tags={"img"},
            allowed_attributes={"img": {"srcset", "alt"}},
        )

        assert "srcset" not in result
        assert "data:" not in result
        assert "svg+xml" not in result
        assert "text/html" not in result
        assert "alert" not in result
        assert 'alt="x"' in result
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_sanitize.py::test_img_srcsetの2件目以降にある危険dataスキーム候補は属性ごと除去される -q`

Expected: FAIL。`srcset` 属性内に `data:image/svg+xml` または `data:text/html` が残り、`assert "srcset" not in result` が失敗する。

- [ ] **Step 3: `srcset` 用 data scheme 候補検出を追加する**

`src/sphinx_riddle_whisper/sanitize.py` の `_URL_ASCII_TAB_OR_NEWLINE` 定義直後に `_DATA_SCHEME_CANDIDATE` と `_contains_data_scheme_candidate` を追加する。

```python
_DATA_SCHEME_CANDIDATE = re.compile(
    r"(?:^|[\s,])[\x00-\x20]*data:",
    re.IGNORECASE,
)
```

`_preprocess_url_for_scheme()` の直後に追加する。

```python
def _contains_data_scheme_candidate(value: str) -> bool:
    """URL リスト属性の内部に data: scheme 候補が含まれるかを判定する。"""
    normalized = value.translate(_URL_ASCII_TAB_OR_NEWLINE)
    return _DATA_SCHEME_CANDIDATE.search(normalized) is not None
```

`_data_uri_attribute_filter()` の先頭に `srcset` 専用の fail-closed 判定を追加する。

```python
def _data_uri_attribute_filter(tag: str, attr: str, value: str) -> str | None:
    """``data:`` URI を安全な画像 ``img[src]`` にだけ限定する。

    nh3 の ``url_schemes`` に ``data`` を許可した上で、安全な画像 ``data:`` URI
    （``image/png`` 等）の ``img[src]`` だけを通す。svg+xml・非画像 ``data:`` や、
    ``object[data]`` / ``a[href]`` などの custom URL 属性上の ``data:`` は
    ``None`` を返して除去する（fail-closed）。それ以外の属性値はそのまま通す。
    """
    if attr == "srcset" and _contains_data_scheme_candidate(value):
        return None

    preprocessed = _preprocess_url_for_scheme(value)
    if not preprocessed.lower().startswith("data:"):
        return value
    if tag == "img" and attr == "src":
        payload = preprocessed[len("data:") :]
        return preprocessed if _is_safe_image_data_uri(payload) else None
    return None
```

- [ ] **Step 4: targeted sanitize test を通す**

Run: `uv run pytest tests/test_sanitize.py::test_img_srcsetの2件目以降にある危険dataスキーム候補は属性ごと除去される -q`

Expected: PASS。

- [ ] **Step 5: sanitizer 全体を通してコミットする**

Run: `uv run pytest tests/test_sanitize.py -q`

Expected: PASS。

```bash
git add src/sphinx_riddle_whisper/sanitize.py tests/test_sanitize.py
git commit -m "fix: block data URIs inside srcset"
```

---

### Task 2: encoded singlehtml term link をイベント委譲セレクタに含める

**Files:**
- Modify: `src/sphinx_riddle_whisper/static/riddle.js`
- Test: `tests/js/install-popover.test.mjs`

**Interfaces:**
- Consumes: `installRiddlePopover(doc: Document, options?: object) -> void`、`deriveTermId(href: string) -> string | null`
- Produces: `TERM_TRIGGER_SELECTOR` が `a[href*='#term-']` と `a[href*='%23term-']` の両方を入口候補にする。最終的な term 判定は既存 `deriveTermId()` が行う。

- [ ] **Step 1: encoded singlehtml click の失敗テストを書く**

`tests/js/install-popover.test.mjs` の `結合: トリガ click で走査済み fragment が共有 .riddle-popover へ挿入され表示される` テストの直後に追加する。

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/js/install-popover.test.mjs`

Expected: FAIL。追加テストで `popover` が `null` になり、encoded href が `TERM_TRIGGER_SELECTOR` に拾われていないことが確認できる。

- [ ] **Step 3: term trigger selector を encoded fragment へ拡張する**

`src/sphinx_riddle_whisper/static/riddle.js` の `TERM_TRIGGER_SELECTOR` 定義を置き換える。

```js
// 委譲リスナが反応するトリガリンクのセレクタ。
// term: DOM 契約 a[href*='#term-']。singlehtml の encoded '#term-' は %23term-。
const TERM_TRIGGER_SELECTOR = "a[href*='#term-'], a[href*='%23term-']";
const FOOTNOTE_TRIGGER_SELECTOR = "a.footnote-reference, a.citation-reference";
```

- [ ] **Step 4: targeted JS test を通す**

Run: `node --test tests/js/install-popover.test.mjs`

Expected: PASS。

- [ ] **Step 5: JS lint を通してコミットする**

Run: `npm run lint -- --quiet`

Expected: PASS。

```bash
git add src/sphinx_riddle_whisper/static/riddle.js tests/js/install-popover.test.mjs
git commit -m "fix: handle encoded singlehtml term triggers"
```

---

### Task 3: URL-bearing 属性だけに `data:` block を限定し、通常テキスト属性を保持する

**Files:**
- Modify: `src/sphinx_riddle_whisper/sanitize.py`
- Test: `tests/test_sanitize.py`

**Interfaces:**
- Consumes: Task 1 の `_contains_data_scheme_candidate(value: str) -> bool`
- Produces: `_URL_BEARING_ATTRIBUTES: set[str]`。`_data_uri_attribute_filter()` は URL-bearing 属性だけを `data:` block の対象にし、非 URL 属性は nh3 の通常許可リストへ委ねる。

- [ ] **Step 1: 非 URL 属性の `data:` 文字列保持テストを書く**

`tests/test_sanitize.py` の `test_img_srcsetの2件目以降にある危険dataスキーム候補は属性ごと除去される` の直後に追加する。

```python
def test_data文字列で始まる非URL属性は保持される():
    """title/alt のような通常テキスト属性は data: で始まっても URL として block しない。"""
    result = sanitize_html(
        '<p title="data:science">x</p>'
        '<img src="https://example.test/a.png" alt="data:science" title="data:title">'
    )

    assert '<p title="data:science">x</p>' in result
    assert 'src="https://example.test/a.png"' in result
    assert 'alt="data:science"' in result
    assert 'title="data:title"' in result
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_sanitize.py::test_data文字列で始まる非URL属性は保持される -q`

Expected: FAIL。現在の `_data_uri_attribute_filter()` は `title` と `alt` の値が `data:` で始まると `None` を返すため、`title="data:science"` または `alt="data:science"` が出力に残らない。

- [ ] **Step 3: URL-bearing 属性 allowlist を追加して filter を置き換える**

`src/sphinx_riddle_whisper/sanitize.py` の `_DATA_SCHEME_CANDIDATE` 定義直後に追加する。

```python
_URL_BEARING_ATTRIBUTES: set[str] = {
    "href",
    "src",
    "data",
    "srcset",
    "poster",
    "action",
    "formaction",
    "cite",
    "background",
}
```

`_data_uri_attribute_filter()` 全体を次の実装へ置き換える。

```python
def _data_uri_attribute_filter(tag: str, attr: str, value: str) -> str | None:
    """``data:`` URI を URL-bearing 属性上でだけ制限する。

    nh3 の ``url_schemes`` に ``data`` を許可した上で、安全な画像 ``data:`` URI
    （``image/png`` 等）の ``img[src]`` だけを通す。svg+xml・非画像 ``data:`` や、
    ``object[data]`` / ``a[href]`` / ``img[srcset]`` などの URL-bearing 属性上の
    ``data:`` は ``None`` を返して除去する（fail-closed）。``title`` や ``alt`` など
    URL として解釈されない属性値はそのまま通す。
    """
    attr_name = attr.lower()
    if attr_name not in _URL_BEARING_ATTRIBUTES:
        return value

    if attr_name == "srcset" and _contains_data_scheme_candidate(value):
        return None

    preprocessed = _preprocess_url_for_scheme(value)
    if not preprocessed.lower().startswith("data:"):
        return value
    if tag == "img" and attr_name == "src":
        payload = preprocessed[len("data:") :]
        return preprocessed if _is_safe_image_data_uri(payload) else None
    return None
```

- [ ] **Step 4: targeted sanitize test を通す**

Run: `uv run pytest tests/test_sanitize.py::test_data文字列で始まる非URL属性は保持される tests/test_sanitize.py::test_img_srcsetの2件目以降にある危険dataスキーム候補は属性ごと除去される -q`

Expected: PASS。

- [ ] **Step 5: sanitizer 全体を通してコミットする**

Run: `uv run pytest tests/test_sanitize.py -q`

Expected: PASS。

```bash
git add src/sphinx_riddle_whisper/sanitize.py tests/test_sanitize.py
git commit -m "fix: keep data text in non-url attributes"
```

---

### Task 4: config の文字列 iterable を検証時に再走査可能な `tuple` へ正規化する

**Files:**
- Modify: `src/sphinx_riddle_whisper/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: `validate_config(app, config) -> None`
- Produces: `_normalize_str_iterable(name: str, value) -> tuple[str, ...]`、`_normalize_allowed_attributes(value) -> dict[str, tuple[str, ...]]`。`validate_config()` は `riddle_strip_classes`、`riddle_allowed_tags`、`riddle_allowed_schemes`、`riddle_allowed_attributes` の値側を検証済み tuple へ書き戻す。

- [ ] **Step 1: generator config の保持テストを書く**

`tests/test_config.py` の `test_妥当な上書きでvalidate_configが例外を出さない` の直後に追加する。

```python
def test_文字列iterable設定のgeneratorは検証時にtupleへ正規化される():
    """one-shot generator を検証で消費して空設定にせず、再走査可能な tuple として保持する。"""
    config = _make_default_config(
        riddle_strip_classes=(x for x in ["headerlink", "sd-stretched-link"]),
        riddle_allowed_tags=(x for x in ["p", "a"]),
        riddle_allowed_schemes=(x for x in ["https", "mailto"]),
        riddle_allowed_attributes={"a": (x for x in ["href", "title"])},
    )

    validate_config(SimpleNamespace(), config)

    assert config.riddle_strip_classes == ("headerlink", "sd-stretched-link")
    assert config.riddle_allowed_tags == ("p", "a")
    assert config.riddle_allowed_schemes == ("https", "mailto")
    assert config.riddle_allowed_attributes == {"a": ("href", "title")}
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `uv run pytest tests/test_config.py::test_文字列iterable設定のgeneratorは検証時にtupleへ正規化される -q`

Expected: FAIL。現在の `_validate_str_iterable()` は generator を走査して消費するだけで config へ書き戻さないため、少なくとも `config.riddle_allowed_tags == ("p", "a")` が失敗する。

- [ ] **Step 3: 検証 helper を正規化 helper へ置き換える**

`src/sphinx_riddle_whisper/config.py` の `_validate_str_iterable()` を削除し、同じ位置へ次を追加する。

```python
def _normalize_str_iterable(name: str, value) -> tuple[str, ...]:
    """value（None 不可）を検証済みの文字列 tuple へ正規化する。"""
    if isinstance(value, (str, bytes)) or not isinstance(value, Iterable):
        raise ExtensionError(f"{name} は文字列のリスト/集合である必要があります: {value!r}")
    normalized = tuple(value)
    for item in normalized:
        _validate_type(f"{name} の要素", item, str, "str")
    return normalized
```

`validate_config()` の文字列 iterable 検証部分を次へ置き換える。

```python
    config.riddle_strip_classes = _normalize_str_iterable(
        "riddle_strip_classes",
        config.riddle_strip_classes,
    )

    if config.riddle_allowed_tags is not None:
        config.riddle_allowed_tags = _normalize_str_iterable(
            "riddle_allowed_tags",
            config.riddle_allowed_tags,
        )

    if config.riddle_allowed_schemes is not None:
        config.riddle_allowed_schemes = _normalize_str_iterable(
            "riddle_allowed_schemes",
            config.riddle_allowed_schemes,
        )

    if config.riddle_allowed_attributes is not None:
        config.riddle_allowed_attributes = _normalize_allowed_attributes(
            config.riddle_allowed_attributes
        )
```

`_validate_allowed_attributes()` を削除し、同じ位置へ次を追加する。

```python
def _normalize_allowed_attributes(value) -> dict[str, tuple[str, ...]]:
    """riddle_allowed_attributes を dict[str, tuple[str, ...]] へ正規化する。"""
    _validate_type("riddle_allowed_attributes", value, dict, "dict")
    normalized: dict[str, tuple[str, ...]] = {}
    for key, attrs in value.items():
        _validate_type("riddle_allowed_attributes のキー", key, str, "str")
        normalized[key] = _normalize_str_iterable(
            f"riddle_allowed_attributes[{key!r}]",
            attrs,
        )
    return normalized
```

- [ ] **Step 4: targeted config test を通す**

Run: `uv run pytest tests/test_config.py::test_文字列iterable設定のgeneratorは検証時にtupleへ正規化される -q`

Expected: PASS。

- [ ] **Step 5: config 全体を通してコミットする**

Run: `uv run pytest tests/test_config.py -q`

Expected: PASS。

```bash
git add src/sphinx_riddle_whisper/config.py tests/test_config.py
git commit -m "fix: normalize iterable config values"
```

---

### Task 5: 上記指摘の回帰テストと full test / JS lint を再実行する

**Files:**
- Verify: `src/sphinx_riddle_whisper/sanitize.py`
- Verify: `src/sphinx_riddle_whisper/static/riddle.js`
- Verify: `src/sphinx_riddle_whisper/config.py`
- Verify: `tests/test_sanitize.py`
- Verify: `tests/test_config.py`
- Verify: `tests/js/install-popover.test.mjs`

**Interfaces:**
- Consumes: Task 1〜4 の変更すべて
- Produces: 既存 full test / JS lint が通る検証済み状態。追加コミットは作らず、作業ツリーが clean であることを確認する。

- [ ] **Step 1: Python targeted regression をまとめて実行する**

Run: `uv run pytest -q tests/test_sanitize.py tests/test_config.py`

Expected: PASS。

- [ ] **Step 2: JS targeted regression を実行する**

Run: `node --test tests/js/install-popover.test.mjs tests/js/derive-term-id.test.mjs`

Expected: PASS。

- [ ] **Step 3: Python full test を実行する**

Run: `uv run pytest -q`

Expected: PASS。

- [ ] **Step 4: JS full test と lint を実行する**

Run: `npm test -- --test-reporter=dot && npm run lint -- --quiet`

Expected: PASS。

- [ ] **Step 5: 作業ツリーが clean であることを確認する**

Run: `git status --short`

Expected: 出力なし。Task 1〜4 のコミット後に未コミット変更が残っていない。

---

## Self-Review

- Spec coverage: 推奨対応順 1 は Task 1、2 は Task 2、3 は Task 3、4 は Task 4、5 は Task 5 で対応する。
- Placeholder scan: 実装未確定を示す禁止語句を検索し、本文中に残っていないことを確認した。
- Type consistency: `_contains_data_scheme_candidate(value: str) -> bool`、`_normalize_str_iterable(name: str, value) -> tuple[str, ...]`、`_normalize_allowed_attributes(value) -> dict[str, tuple[str, ...]]` を各 task 内で同一名称・同一戻り値型として扱う。
