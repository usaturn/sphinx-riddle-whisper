# 脚注・引用参照ポップアップ Spec

## Context（背景）

既存の sphinx-riddle-whisper は glossary の `:term:` 参照に対してポップオーバーを提供している（`a[href*='#term-']` をトリガに、Python が `<template id="riddle-tip--{termId}">` として注入した定義 HTML を表示）。

本機能は同じ UX を **脚注参照**（`[#name]_`, `[1]_`, `[#]_`, `[*]_`）と **引用参照**（`[CIT2002]_`）にも拡張する。脚注・引用の本体は glossary 定義と異なり**同一ページ下部に既に存在する**ため、内容はクライアント側で DOM から取得する。これにより Python 側の追加注入は不要で、既存の JS サニタイズ・配置・タイマー基盤をそのまま再利用できる。

## Goals / 非 Goals

**Goals**
- 脚注/引用参照にホバー・クリックでポップアップし、その本体内容を表示する
- 既存 glossary ポップオーバーと UI / 配置 / タイマー / サニタイズを共有する
- `riddle_footnotes`（既定 `True`）で独立に ON/OFF できる

**非 Goals**
- クロスページ脚注（別ページの脚注本体取得）。**同一ページ限定**。
- 脚注専用の trigger / delay 設定。表示設定（trigger/openDelayMs/closeDelayMs/interactive/maxHeight/maxWidth）は glossary と共有する。

## アーキテクチャ

クライアント側 DOM 解決方式。Python 側変更は設定フラグの登録と runtime config への伝播のみ。JS 側で「複数の trigger 種別 → 共有表示」を実現する。

### DOM 契約（Sphinx 9.x / docutils 0.22 HTML5 writer）
- 脚注参照: `<a class="footnote-reference brackets" href="#idN" id="idM">[1]</a>`
- 脚注本体: `<aside class="footnote brackets" id="idN" role="note"><span class="label"><a class="fn-backref" href="#idM">[1]</a></span><p>…</p></aside>`
- 引用参照: `<a class="citation-reference" href="#cite-x" id="…">[CIT]</a>`
- 引用本体: `<aside class="citation" id="cite-x" role="doc-cite"><span class="label"><a class="fn-backref" …></a></span><p>…</p></aside>`

### 内容解決（新規 JS 関数 `resolveFootnoteContent(doc, trigger)`）
1. `trigger.href` から `#fragment` を抽出（既存 `deriveTermId` を汎用化、または小関数を新設）
2. `doc.getElementById(fragment)` で本体 aside を取得。`null` / `<aside>` でない / `footnote`・`citation` クラスを持たない場合は `null`（fail-closed）
3. aside を `cloneNode(true)`、`<span class="label">`（内部の `.fn-backref` 戻りリンク ↩ を含む）を除去
4. 残りの子ノードを fragment 化し、既存 `sanitizeFragment` に通す
5. 返り値は既存 `handleTriggerForElement` と同形の `{ trigger, fragment }`

### trigger 種別ディスパッチ
`installRiddlePopover` のバインド対象セレクタを拡張する。
- term（既存）: `a[href*='#term-']`
- footnote（`footnotes` 有効時のみ）: `a.footnote-reference, a.citation-reference`

要素ごとに、term 系なら既存 resolver（`deriveTermId` → `getRiddleTemplate` → `sanitizeFragment`）、footnote 系なら `resolveFootnoteContent` を使う薄いディスパッチを `handleTriggerForElement` に追加する。term 参照（`#term-N`）と脚注参照（`#idN`）は href が重ならないため誤判定は起きない。

### 設定伝播
- `config.py`: `riddle_footnotes`（bool, 既定 `True`, rebuild=`'html'`）を `app.add_config_value` で登録
- `runtime_config.py`: 出力 JSON に `footnotes: true/false` を含める
- `riddle.js` `readRiddleConfig`: `footnotes` を bool 正規化（既定 `true`、DOM clobbering 耐性は既存パターン踏襲）
- `installRiddlePopover` / `initRiddle`: `footnotes` が `false` の場合は footnote セレクタをバインドしない

## エラー処理 / fail-closed

- 本体未検出・`<aside>` でない・想定外クラス → ポップアップなし（既存のテーブル駆動 fail-closed と同様の扱い）
- サニタイズは既存 `sanitizeFragment`（allowlist 走査・`on*` 除去・危険スキーム除去・`target=_blank` への rel 付与）をそのまま適用し、XSS 二次防御を継承
- `getBoundingClientRect` 例外時／`defaultView` 不在時の fail-safe（配置スキップで表示継続）も既存経路を共有

## テスト計画

**JS（node:test + jsdom、`/tdd-js`）**
- `resolveFootnoteContent`: 正常解決 / backref・label 除去 / 本体未検出で `null` / `id` が aside 以外の要素（DOM clobbering）で `null` / citation 本体の解決
- ディスパッチ結合: 脚注参照を click → 本体内容が共有 popover に挿入され表示される
- 無効化: `footnotes=false` で footnote 参照にバインドされない（発動しない）
- セキュリティ結合: 敵対的な脚注本体（`<img onerror>` 等を含む）を click → popover 内に危険要素・`on*`・危険スキームが 0 件
- 共有: footnote と term が同一 popover 要素・単一タイマーを共有する

**Python（pytest）**
- `test_config.py`: `riddle_footnotes` の既定 `True` と型検証
- `test_runtime_config.py`: 出力 JSON に `footnotes` が含まれる
- （必要に応じて）characterization: 脚注・引用を含むページのビルドで参照アンカーの class が DOM 契約どおりであることを PIN

## 検証（E2E）

- `docs/` をビルドし、脚注を含むページで参照にホバー/クリック → 本体がポップアップ表示され、戻りリンク ↩ が表示されないことを確認
- `riddle_footnotes = False` で機能が無効化されることを確認
- `npm test` / `npm run lint` と `pytest` がすべて緑

## 影響ファイル

- `src/sphinx_riddle_whisper/config.py`（設定追加）
- `src/sphinx_riddle_whisper/runtime_config.py`（JSON 伝播）
- `src/sphinx_riddle_whisper/static/riddle.js`（`resolveFootnoteContent` 追加・セレクタ拡張・config 読取）
- `tests/js/*.test.mjs`（新規テスト）
- `tests/test_config.py`, `tests/test_runtime_config.py`（更新）
- `tests/roots/test-context/`（引用 fixture 追加の可能性）
