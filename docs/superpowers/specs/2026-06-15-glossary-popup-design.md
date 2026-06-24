# Glossary 用語定義ポップアップ拡張 設計仕様 (sphinx-riddle-whisper)

> 本書は設計仕様（Spec）であり、実装ではない。
> 根拠: `docs_draft/glossary-popup-investigation.md` の方式に従う。技術詳細は Sphinx 9.x（最新 9.1.0）のビルドモデルに照らした補正を加える（後述「投資調査からの設計補正」）。投資調査メモは「Sphinx >= 8.x」と記載するが、CLAUDE.md の「最新を使う／古いバージョンはサポートしない」方針に従い本 Spec は **`sphinx>=9`** を対象とする。
> 作成日: 2026-06-15

---

## Context（背景・目的）

Sphinx の `:term:`用語`` ロールは glossary（用語集）の `<dt>`（用語名）へジャンプするリンクを生成するが、**定義本体 `<dd>` を読むにはページ遷移が必要**。既存拡張 `sphinx-tippy` はホバー表示できるものの、`create_id_to_tip_html`（src 395-412）が `<dd>` 子要素を `<p>` 以外 `decompose()` し**最大5要素に切り詰める**ため、リスト・コード・複数段落を含む定義が欠落する。切り詰め無効化の設定は無い。

**目的**: HTML ビルド時、`:term:` 参照に対して **glossary 定義本体（`<dd>`）全体を切り詰めず**ホバー/クリックでポップアップ表示する Sphinx 拡張 `sphinx-riddle-whisper` を実装する。

**成功基準**:
- 定義の全要素（段落・リスト・コードブロック・ネスト・画像・内部リンク）が切り詰めなしで表示される。
- **準信頼コンテンツ（外部 PR 由来の用語定義）でも XSS が成立しない**（許可リストサニタイズ既定 ON）。
- Node/npm 不要・**ブラウザ側第三者ライブラリなし**（出荷 JS は完全バニラ）。Python 実行時依存は Sphinx と許可リストサニタイザ（`nh3`）のみ。
- `file://`（オフライン standalone HTML）で動作する。
- 別名用語（1 定義を複数 term が共有）が正しく扱われる。
- 並列(`-j`)・増分ビルドで整合する。

> **依存方針の補正**: investigation は「追加 Python 実行時依存ゼロ」を掲げたが、セキュリティ検証（後述「バニラ JS の検証とセキュリティ」）の結果、XSS を確実に防ぐには**ビルド時の許可リストサニタイズが必須**と判明。実績ある `nh3`（Rust/ammonia バインディング）をインストール依存に1つ加える。これは「Node 不要・ブラウザ第三者ライブラリなし・完全オフライン」という核となる価値とは独立で、それらは維持する。

---

## スコープ

### MVP（Phase 1・必須）
- `:term:` 参照に対する定義本体ポップアップ（ホバー/フォーカス/クリック）。
- doctree 方式での定義取得（HTML スクレイプではない）。別名共有定義対応。
- 無切り詰めレンダリング（render_partial）。
- **ビルド時 XSS 一次防御**（`nh3` 許可リストサニタイズ・既定 ON）。
- ページ末尾への隠し `<template>` 注入。
- 出荷物が完全バニラのポップオーバー（**多層 XSS 防御**・委譲リスナ・rAF スロットル・CSSOM 位置決め・位置決め clamp/flip、scroll/resize 追従、Esc/外側クリックで閉じる、`role=tooltip`/`aria-describedby`、`max-height`+`overflow`）。
- `--riddle-*` CSS 変数によるライト/ダーク対応。
- `html` / `dirhtml` / `singlehtml` の3 builder で URI 整合。
- 並列・増分ビルド整合。
- **JS 検証3層**（lint / 単体 / Playwright e2e、dev-only）。
- 最小設定: `riddle_trigger`, `riddle_max_height`, `riddle_max_width`, `riddle_open_delay_ms`, `riddle_close_delay_ms`, `riddle_interactive`, `riddle_include_term_title`, `riddle_strip_classes`, `riddle_sanitize`, `riddle_allowed_*`。

### 将来/任意（Phase 2）
- `riddle_retypeset_math`（MathJax 再 typeset）/ `riddle_retypeset_mermaid`。
- `riddle_use_tippy`（ユーザ vendoring の tippy.js へ委譲）。
- `riddle_skip_terms` / `riddle_skip_urls`（正規表現スキップ）。
- `riddle_theme_vars`（テーマ変数マッピング）/ `riddle_css_files` / `riddle_js_files`。
- Playwright によるブラウザ挙動 e2e。

### 対象外
- HTML 以外の builder（latex, epub 等）への機能提供。
- glossary 以外の `:term:` 類似ターゲット（productionlist 等）。

---

## アーキテクチャ概要

2 層構成。

**ビルド時（Python）** — 「どの定義をどのページへ、どの相対パスで埋め込むか」を解決する:
1. `:term:` 参照ページの書き出し時(`html-page-context`)に、そのページ doctree から参照されている term-id を抽出。
2. 各 term-id の **home ドキュメント**（定義が書かれた doc）を `StandardDomain` の用語レジストリから特定。
3. home ドキュメントを `env.get_and_resolve_doctree()` で解決し、定義サブツリーを取得（home 単位でメモ化）。
4. 定義サブツリーを表示ページ用に複製し、内部相対 URI を表示ページ基準へ再ベース。
5. `render_partial` で無切り詰め HTML 断片化、headerlink 等を除去。
6. **render 後の最終 HTML 文字列を許可リストサニタイズ**（`on*`・危険スキーム・`script`/`iframe`/`base` 等を除去。後述）。
7. ページ末尾へ隠し `<template id="riddle-tip--<term-id>">サニタイズ済み定義HTML</template>` を注入。

**実行時（バニラ JS）** — 表示と対話:
8. `a[href*='#term-']` を検出し、ホバー/フォーカス/クリックで term-id を導出 → `getElementById('riddle-tip--'+id)`（**`HTMLTemplateElement` であることを検証**）の `<template>.content` を `cloneNode(true)` → **append 前に二次防御の allowlist 走査** → 共有 `.riddle-popover` に挿入 → 位置決め（CSSOM プロパティ API）・a11y・閉じる制御。

エンドツーエンド方式（取得=doctree / 配信=隠し template / 表示=バニラJS）は investigation の推奨（§1, §3-B, §4-c, §5）に一致。

---

## 投資調査からの設計補正（重要・透明性のため明示）

investigation の**全体方式は維持**するが、Sphinx 9.x ソース照合で以下3点を補正する。いずれも「そのまま仕様化すると破綻する実装詳細」への修正。

1. **収集フェーズ — post-transform 蓄積をやめ、書き出し時オンデマンド解決にする。**
   - investigation §6.2 は `SphinxPostTransform` で `env.riddle_terms` に定義ノードを蓄積する想定。だが post-transform は**書き出しフェーズで doc ごと**に走るため、用語参照ページが glossary ページより先に書き出されると未収集になる順序問題がある。
   - 補正: term-id→home_docname は **`StandardDomain.objects`（`objtype=='term'`、`labelid`=term-id）を再利用**（自前インデックス不要・既に並列/増分マージ対応）。定義は表示時に `env.get_and_resolve_doctree(home_docname, builder)` で**オンデマンド解決**（home 単位メモ化）。これで順序問題が消え、自前 env 状態が最小化され、`env-merge-info`/`env-purge-doc`/`env_version` の自前実装が原則不要になる。

2. **相対 URI — 「term-id 単位で1回キャッシュ」と「表示ページ文脈で相対解決」は両立しない。**
   - `render_partial`(`writers/html5.py`) は reference の `refuri` を**ほぼ verbatim 出力**する（同一ページ参照は `#refid`）。定義は home ドキュメント文脈で解決されるため、`refuri` は home 基準。別ディレクトリの表示ページ P に注入すると 404（investigation §7 が HIGH と指摘）。
   - 補正: 解決済み定義を **表示ページ P ごとに複製**し、内部 `refuri`/画像 `uri`/同一ページ `#anchor` を **home 出力パス基準 → P 基準へ再ベース**してから render する。再ベースは `sphinx.util.osutil.relative_uri` / `builder.get_relative_uri` を基にする（dirhtml/singlehtml の `get_target_uri` 差異に対応）。外部 URL（`scheme://`）・`mailto:`・サイト絶対(`/...`)はスキップ、`#anchor` は `home.html#anchor` へ書換。**キャッシュ粒度は `(home_docname, P_docname)`**（term-id 単体ではない）。

3. **headerlink 除去 — doctree ノードには存在しない。writer が生成する。**
   - `<a class="headerlink">` は `writers/html5.py` が出力時に生成し、doctree には無い。よって「ノードツリーから headerlink を除去」は不可能。
   - 補正: 除去は **render 後の HTML 文字列に対して** `riddle_strip_classes` 該当アンカーを除く（または render_partial 用 settings で permalink を無効化）。`riddle_strip_classes` の既定は `['headerlink', 'sd-stretched-link']`。

---

## コンポーネント設計

src レイアウト・関心の直交で分割。各モジュールは「役割／入出力／依存」を独立に説明できる単位。

### `__init__.py` — 拡張エントリ
- 役割: `setup(app)`。`config.py` の設定値登録 → `html-page-context` を connect → `riddle.js`/`riddle.css` を `add_js_file(loading_method='defer')`/`add_css_file` で**無条件登録**（タイミング安全のため setup で登録、HTML 以外は builder format でガード）→ `static/` を `html_static_path` 連携 → `ExtensionMetadata{version, parallel_read_safe=True, parallel_write_safe=True}` を返す。
- 依存: 他全モジュール。

### `config.py` — 設定値
- 役割: `riddle_*` config 値の `add_config_value` 登録と検証・既定値（後述「設定オプション」）。
- 依存: Sphinx `app.add_config_value`。

### `collect.py` — 用語→定義の特定と解決
- 役割: (a) `StandardDomain.objects` から `objtype=='term'` を引き **term-id → (home_docname, term-text)** を得る。(b) `env.get_and_resolve_doctree(home_docname, builder)` を **home_docname 単位でメモ化**して解決済み doctree を取得。(c) その doctree の `addnodes.glossary → definition_list_item` を走査し、項目内 **全 `term['ids']`** を唯一の `nodes.definition`（+任意で `nodes.term`）へ対応付け、**term-id → 定義サブツリー** を返す。
- 入出力: in=term-id 群 / out=解決済み定義サブツリー（複製元）。
- 依存: `env.get_and_resolve_doctree`, `StandardDomain`。

### `rebase.py` — 相対 URI 再ベース（最重要・回帰多発想定）
- 役割: 複製した定義サブツリーの `reference['refuri']`・`image['uri']`・同一ページ `refid` を、home 出力パス基準から表示ページ P 基準へ再計算。外部/絶対/mailto はスキップ。
- 入出力: in=(定義サブツリー, home_docname, P_docname, builder) / out=URI 補正済みサブツリー。
- 依存: `builder.get_relative_uri`, `sphinx.util.osutil.relative_uri`, `urllib.parse`, `posixpath`。
- 単独テスト容易性を最優先に独立モジュール化。

### `render.py` — 無切り詰めレンダリング
- 役割: URI 補正済みサブツリーを `app.builder.render_partial(node)['fragment']` で HTML 断片化。render 後の HTML 文字列から `riddle_strip_classes` 該当アンカーを除去。`riddle_include_term_title` が True なら term 名を定義の上に付加。出力 HTML 文字列を `sanitize.py` に渡してから返す。
- 入出力: in=サブツリー / out=サニタイズ済み HTML 文字列。
- 依存: `builder.render_partial`, `sanitize`。

### `sanitize.py` — ビルド時 XSS 一次防御（許可リスト）
- 役割: render 後の**最終 HTML 文字列**を `nh3` の許可リストでサニタイズ。`.. raw:: html` 由来の生 HTML も含め最終出力に対して効く（doctree 走査では捕捉不能なため文字列段で実施）。許可: 構造要素（`p/ul/ol/li/dl/dt/dd/pre/code/table/tr/td/th/img/a/em/strong/span/div/figure/figcaption/blockquote` 等）+ 安全属性（`class/id/src/href/alt/title/colspan/rowspan` 等）。URL スキームは `http/https/mailto/相対/#anchor` のみ許可、`javascript:`/`data:`(画像の安全な `image/*` 以外)/`vbscript:` を除去。`on*` 属性・`script`/`iframe`/`object`/`embed`/`form`/`base`/`style` を除去。`target=_blank` には `rel="noopener noreferrer"` を付与。
- 入出力: in=HTML 文字列 / out=サニタイズ済み HTML 文字列。
- 依存: `nh3`（インストール依存）。`riddle_sanitize=False` 時はバイパス（完全信頼サイト向け）。
- 単独テスト容易性のため独立モジュール化（敵対的 fixture で網羅検証）。

### `inject.py` — ページ注入（`html-page-context` ハンドラ）
- 役割: `doctree` 引数（非ドキュメントページは `None` のためガード）の `reference` ノードを走査し、`refuri` フラグメント `#term-*` と `refid=term-*` の **両方**から参照 term-id を DISTINCT 抽出。`StandardDomain` と突合し glossary 用語のみ採用。各 term-id について collect→rebase→render を経た HTML を `<template id="riddle-tip--<term-id>">…</template>` として連結し、`context['body']` 末尾へ追記。
- 入出力: in=(pagename, context, doctree) / out=`context['body']` 更新（副作用）。
- 依存: `collect`, `rebase`, `render`, `StandardDomain`。

### `static/riddle.js` — バニラ JS ポップオーバー
- 役割: `DOMContentLoaded` で **`document` への単一委譲リスナ**（リンクごと登録は禁止＝起動コスト/メモリ線形膨張回避）を張る。トリガ時に href フラグメントから term-id を導出 → `getElementById('riddle-tip--'+id)` を引き、**`instanceof HTMLTemplateElement` を検証**（他要素なら無視）→ `content.cloneNode(true)` → **append 前の二次防御 allowlist 走査**（`TreeWalker(SHOW_ELEMENT)` で `on*` 全除去・`a/area/form/svg a` の `href/xlink:href/action/formaction` を許可スキーム以外なら除去・`script/iframe/object/embed/base` をノード除去、すべて fail-closed）→ 連結前の `DocumentFragment` 上で完了させ一括挿入（挿入後再走査しない＝mXSS 回避）→ 共有 `.riddle-popover` に表示。
- 位置決め: `getBoundingClientRect` + viewport clamp/flip、scroll/resize は **rAF スロットル**で追従。座標は **`el.style.left=` 等の CSSOM プロパティ API** で書く（`setAttribute('style', …)`/`cssText` は CSP `style-src` 違反になるため禁止）。表示/非表示は **CSS クラス**で制御。
- 対話/a11y: `role=tooltip`/`aria-describedby`、Esc/外側クリック/blur で閉じる（閉じたら `aria-describedby` 除去・トリガへフォーカス復帰）、`riddle_interactive` 時はポインタがポップ内に入れる。open/close は**単一タイマー**で管理（連打競合・タイマーリーク回避）。**再帰防止**: ポップ内リンクにはトリガを張らない。`decodeURIComponent` は `try/catch`、二重デコードしない。
- 制約: 文字列補間・`innerHTML`/`outerHTML`/`insertAdjacentHTML`・`eval`/`new Function`・インラインハンドラ・`javascript:` を一切使わない（ESLint で機械的に強制）。
- 依存: なし（完全バニラ。出荷物に第三者ライブラリを含めない）。

### `static/riddle.css` — スタイル
- 役割: `.riddle-popover` の見た目、`max-height`+`overflow:auto`、`--riddle-*` CSS 変数（ライト/ダーク既定）。

---

## データフロー

```
:term: 参照（ページ P, refuri=…#term-foo / refid=term-foo）
  └─ inject(html-page-context, P): P の doctree から参照 term-id 抽出
       └─ collect: std.objects で term-foo → home_docname 特定
            └─ get_and_resolve_doctree(home_docname)  ※home単位メモ化
                 └─ glossary 走査: definition_list_item の全 term['ids'] → 唯一の definition
                      └─ rebase(定義サブツリー複製, home→P): refuri/uri/#anchor 補正
                           └─ render_partial → HTML 断片 → strip headerlink
                                └─ sanitize(nh3 許可リスト): on*/危険スキーム/script/iframe/base 除去
                                     └─ <template id="riddle-tip--term-foo">断片</template> を P の body 末尾へ
ブラウザ(P): a[href$=#term-foo] hover/click → tagName 検証 → template.content.cloneNode
            → append 前 allowlist 走査(二次防御) → .riddle-popover 表示
```

---

## 設定オプション（`conf.py`）

| オプション | 既定 | 段階 |
|---|---|---|
| `riddle_trigger` (`'hover'｜'click'｜'both'`) | `'both'` | MVP |
| `riddle_max_height` | `'24rem'` | MVP |
| `riddle_max_width` | `'32rem'` | MVP |
| `riddle_open_delay_ms` / `riddle_close_delay_ms` | 150 / 100 | MVP |
| `riddle_interactive` | `True` | MVP |
| `riddle_include_term_title` | `True` | MVP |
| `riddle_strip_classes` | `['headerlink','sd-stretched-link']` | MVP |
| `riddle_sanitize` | `True` | MVP |
| `riddle_allowed_tags` / `riddle_allowed_attributes` / `riddle_allowed_schemes` | nh3 既定の許可リスト（上記 `sanitize.py` 準拠） | MVP |
| `riddle_retypeset_math` / `riddle_retypeset_mermaid` | `True` / `False` | 将来 |
| `riddle_use_tippy` | `False` | 将来 |
| `riddle_skip_terms` / `riddle_skip_urls` | `[]` | 将来 |
| `riddle_theme_vars` / `riddle_css_files` / `riddle_js_files` | `{}` / `[]` / `[]` | 将来 |

---

## 既知の最重要リスクと判断分岐

**`render_partial` の writer transform 再走**（本拡張の核心リスク）。`render_partial` は孤立サブツリーに `_WRITER_TRANSFORMS` を再適用するため、**脚注・`:numref:`・section 連番・citation を含む定義はサイレントに番号が壊れる可能性が高い**。

判断分岐（実装初期に PoC で確認）:
- (a) 壊れ方が許容範囲 → doctree 方式を維持。
- (b) 壊れる要素タイプを検出したら、その定義は「全文（glossary アンカー）へ」リンクのみ表示にフォールバック。
- (c) 最悪 build-finished での HTML 採取へ切替（最終手段・bs4 依存増）。

この分岐は本 Spec の**残課題**として明記し、PoC 結果で確定する。math/脚注/numref を含む定義を優先的に PoC 対象とする。

---

## 失敗モードと対策（investigation §7 の MVP 範囲）

| 失敗モード | 対策 |
|---|---|
| 別名/複数用語が1 `<dd>` 共有 | `definition_list_item` で全 `term['ids']` を唯一の `definition` に対応付け |
| クロスページ相対 URI 404 | `rebase.py` で home→P 再ベース（補正2） |
| `file://`/オフライン | inline `<template>` で fetch 排除・全 JS/CSS vendoring・ディスクから検証 |
| XSS（`on*` ハンドラ・`javascript:`/`data:`・`<base>`/`<iframe>` 等） | **`cloneNode` だけでは不可**。ビルド時 `nh3` 許可リスト一次防御 + クライアント append 前 allowlist 走査二次防御 + CSP 最外層（詳細は「バニラ JS の検証とセキュリティ」） |
| writer transform 再走（脚注/numref） | 上記「判断分岐」で対応・PoC 必須 |
| 長い定義のはみ出し | `max-height`+`overflow:auto`・flip/clamp |
| `singlehtml`/`dirhtml` 差異 | `formats`/builder.format ゲート・builder 別テスト・singlehtml は同一ページ参照で再ベース不要分岐 |
| 増分で古い template 残存 | `get_and_resolve_doctree` 経路で常に最新解決（自前蓄積に依存しない） |
| 並列 `-j` で env 消失 | std.objects 再利用（既に並列マージ対応）で自前蓄積を持たない |
| i18n で term テキスト変化 | 実 `term['ids']`（labelid）でキー化、テキストでキーにしない |
| `<template>` id 衝突 | ページ内 dedup・`riddle-tip--` プレフィックス |

---

## バニラ JS の検証とセキュリティ

> 本節は、セキュリティ脅威分析（5レンズ・29 findings）と各緩和策の敵対的検証（confidence high）の結果を反映する。**核心の修正**: investigation/初版 Spec が掲げた「`<template>`+`cloneNode(true)` のみで XSS を構造的に排除」は**誤り**。`cloneNode` した断片を live DOM に append すると `on*` ハンドラが発火し、`javascript:` リンクはクリックで実行され、`<base>`/`<iframe srcdoc>` は挿入時に発火する。定義は**参照ページ全てに複製注入**されるため攻撃面が増幅する。よって多層防御を必須とする。

### 脅威モデルと緩和（敵対的検証で確定したもの）

| ID | 脅威 | 重大度 | 確定した緩和（多層） |
|---|---|---|---|
| XSS-1 | `cloneNode` 断片内の `on*`（`img onerror`/`svg onload`/`details ontoggle`/`input onfocus`）が挿入時発火 | High | 一次=nh3 で `on*` 除去 / 二次=append 前 `TreeWalker` で全 `on*` 除去 |
| XSS-2 | 定義内 `javascript:`/`data:` リンクがクリック実行（`riddle_interactive` 既定 True） | High | スキーム **allowlist（fail-closed）**: `http/https/mailto/相対/#` 以外の `href/action/formaction/xlink:href` を除去。`new URL` 解決失敗も除去 |
| XSS-1拡張 | `<base href>` / `<iframe srcdoc>` / `<object>` / `<embed>` が挿入時に発火（クリック不要） | High | 一次/二次の両方で**ノードごと除去**（要素 allowlist） |
| XSS（raw） | `.. raw:: html` 由来の生 HTML は doctree 走査で捕捉不能 | High | サニタイズは **render 後の最終 HTML 文字列**に対し HTML パーサベースで実施（nh3） |
| XSS-3/4 | term-id を `querySelector` に文字列補間 → セレクタインジェクション / `decodeURIComponent` 例外 | Med | `getElementById` のみ使用（補間しない）。`decodeURIComponent` は `try/catch`・二重デコード禁止 |
| CLOB-1/2 | `getElementById` が TEMPLATE 以外/clobber 要素を返す・`.riddle-popover` 奪取 | High(対策済) | `instanceof HTMLTemplateElement` 検証・popover は JS 生成しキャッシュ保持・`riddle-tip--` プレフィックス |
| CSP-1/5 | 位置決めの `setAttribute('style',…)`/`cssText` が `style-src 'unsafe-inline'` を要求 | High | 座標は **CSSOM プロパティ API（`el.style.left=`）**、表示状態は **CSS クラス**で制御 |
| CSP-3 | インライン bootstrap `<script>` が `script-src` を侵す | Med | 外部 `riddle.js` のみ・インライン script/handler ゼロ |
| EVT-1 | リンクごとリスナ登録で起動コスト/メモリが線形膨張 | High | `document` への**単一委譲リスナ** |
| EVT-2 | scroll/resize 追従のスロットル欠如でレイアウトスラッシング | High | **rAF スロットル** |
| EVT-3 | open/close ディレイの連打競合・タイマーリーク | High | **単一タイマー**で状態管理 |
| REC-1 | ポップ内リンクが別 term を指し再帰ポップ | Med | ポップ内リンクにはトリガを張らない |
| NAV-1 | `target=_blank` リンクの `window.opener` 経由 reverse tabnabbing | Med | nh3/二次防御で `rel="noopener noreferrer"` 付与 |
| NAV-4 | `aria-describedby` が巨大定義全体を指し読み上げ過多 | Low | 簡潔な説明文 + ポップ内は通常の読み上げ順に委ねる（要 a11y 検証） |

### 三層防御（要約）

1. **一次（ビルド時・権威的・必須）**: `sanitize.py` が render 後 HTML を `nh3` 許可リスト処理。`riddle_sanitize=True` 既定。完全信頼の単一著者サイトのみ `False` 可。
2. **二次（クライアント・依存ゼロ・常時）**: `riddle.js` が append 前に `TreeWalker` で allowlist 走査（fail-closed）。CSP 無効な `file://` でも効く保険。
3. **三次（CSP・最外層・推奨）**: `script-src 'self'`（`unsafe-inline`/`unsafe-eval` なし）を推奨。ただし `file://` では効かず `javascript:` ナビゲーションも完全には止めないため**単独では頼らない**。

### JS 検証戦略（dev-only・出荷物の依存ゼロを壊さない）

「Node 不要」は**出荷物**（`pip install`/`sphinx-build`/ブラウザ実行）の性質であり、**メンテナの CI が JS テストに Node を使うこと**とは別レイヤ。初版 Spec の「MVP では JS テストを含めない」は**撤回**し、以下を MVP に含める。`package.json` は `private:true`・`devDependencies` のみ・`dependencies` 空。wheel には `node_modules`/`package.json`/`tests/js` を**同梱しない**（uv_build の include を `src` の `.py` と `static/` に限定）。

| 層 | 道具(dev) | カバー | MVP |
|---|---|---|---|
| 静的 lint | ESLint 9 flat config + `eslint-plugin-no-unsanitized` + `no-eval`/`no-implied-eval`/`no-new-func`/`no-script-url` | `innerHTML`/`insertAdjacentHTML`/`eval`/`new Function`/`setTimeout(string)`/`javascript:` を AST で禁止し「`cloneNode` のみ」方針を機械強制 | ✅ |
| 単体 | `node:test`（追加依存ゼロ）or `vitest` + `jsdom`/`happy-dom` | term-id 導出・`HTMLTemplateElement` 検証・clone 挿入・open/close（fake timers）・委譲リスナ・二次防御走査の単体 | ✅ |
| e2e | Playwright（`pytest-playwright`）+ 標準 `http.server` | hover/focus/click 表示・Esc/外側/blur 閉じ・clamp/flip 数値検証・scroll/resize 追従・`file://` 起動・**strict CSP で違反0**・**XSS 実行テスト** | ✅ |

**XSS 実行テストは Playwright 必須**（jsdom は `img onerror` のロード挙動を再現しない）。網羅 fixture を `<template>` に投入し、ポップ表示・リンク click 後に `window.__pwned1..N` が全て `undefined`、かつサニタイズ済み断片に `[onerror]`/`[onload]`/`script`/`iframe`/`a[href^="javascript:"]` が **0 件**、同時に許可された相対リンク/`#anchor`/画像が**保持**されること（無切り詰め回帰防止）を assert する。ビルド側は `.. raw:: html` に攻撃ペイロードを書いた test-root を `-W` ビルドし、生成 `<template>` 内に危険要素 0 件を bs4 で確認。

---

## テスト戦略

フレーム: `pytest` + `sphinx.testing.fixtures`（`pytest_plugins = ['sphinx.testing.fixtures']`）、`@pytest.mark.sphinx(buildername=..., srcdir=...)` ＋ `app` fixture、`tests/roots/test-*/` に最小ドキュメント。`-W`（warning-as-error）でビルドし render_partial の docutils warning を検出。HTML 検査は test-dev 依存の `beautifulsoup4` を使用可。プロジェクト方針の t-wada 流 TDD で Python 側ロジックを駆動。

優先テスト観点:
1. 別名共有定義: 複数 term → 各 term-id の `<template>` が同一定義本体を持つ。
2. 無切り詰め: 5要素超・リスト/コード/ネストが全保持（tippy 切り詰めとの対比）。
3. template 注入: 参照ページにのみ DISTINCT な `<template id="riddle-tip--term-x">`、非参照ページに無い。
4. **相対 URI 再ベース（最重要）**: ネストディレクトリから参照した定義内の相対 href/img/`:ref:` が P 基準で正しい。外部/mailto/絶対/同一ページ#anchor の分岐網羅。
5. builder 差分: `html`/`dirhtml`/`singlehtml` で URI 整合（singlehtml は再ベース不要分岐）。
6. 増分: ビルド→定義変更→再ビルドで template が最新に置換。
7. 並列: `@pytest.mark.sphinx(parallel=2)` 相当で template 欠落なし。
8. `file://` オフライン: 出力 HTML に fetch/CDN 参照なし・`<template>`+vendored asset のみ。
9. 文脈破壊回帰: 脚注/`:numref:`/連番を含む定義で番号が壊れない or 意図したフォールバック。
10. **サニタイズ（build 側）**: `.. raw:: html` に `on*`/`javascript:`/`script`/`iframe`/`base` を書いた敵対 fixture を `-W` ビルドし、生成 `<template>` 内に危険要素/属性が 0 件・許可コンテンツは保持（bs4）。`riddle_sanitize=False` でバイパスされること。

JS テスト: **MVP に含める**（dev-only 道具で出荷物の依存ゼロを維持。詳細は「バニラ JS の検証とセキュリティ § JS 検証戦略」）。静的 lint（ESLint + no-unsanitized）/ 単体（`node:test` or vitest + jsdom）/ e2e（Playwright）の3層。XSS 実行テストは Playwright 必須。

---

## パッケージレイアウト・依存関係

```
pyproject.toml                       # build-backend = uv_build, requires-python >=3.14, dependencies=["sphinx>=9","nh3"]
package.json                         # private:true, devDependencies のみ（eslint, vitest 等）。wheel 範囲外
src/sphinx_riddle_whisper/
  __init__.py   config.py  collect.py  rebase.py  render.py  sanitize.py  inject.py
  static/ riddle.js  riddle.css
tests/
  conftest.py                        # pytest_plugins = ['sphinx.testing.fixtures']
  roots/test-glossary-popup/...      # 別名・ネストディレクトリ・脚注/numref・画像・raw html 攻撃 fixture
  test_collect.py test_rebase.py test_render.py test_sanitize.py test_inject.py test_build_html.py
  js/                                # JS 単体（node:test/vitest）
  e2e/                               # Playwright（pytest-playwright）
docs/                                # 拡張のドキュメント兼デモ（conf.py, index.rst, glossary.rst）
eslint.config.mjs                    # ESLint 9 flat config + no-unsanitized
```

- import 名 `sphinx_riddle_whisper` / 配布名 `sphinx-riddle-whisper` を pyproject で整合。
- `static/` はモジュール配下のため uv_build が既定で wheel 同梱（`MANIFEST.in` 不要）。`node_modules`/`package.json`/`tests/js`/`tests/e2e` は wheel **対象外**（include を `src` の `.py` と `static/` に限定）。
- 実行時依存: **Sphinx >= 9（最新 9.1.0 で検証）+ `nh3`（許可リストサニタイザ）**。Node/npm 不要・**出荷 JS にブラウザ第三者ライブラリなし**。
- 開発依存（dev-only・wheel 非同梱）: pytest, beautifulsoup4（HTML 検査）, ESLint + eslint-plugin-no-unsanitized, vitest/jsdom（or node:test）, playwright + pytest-playwright。
- `nh3` 採用理由: 自作 HTML サニタイザは mXSS リスク・保守負担が高いため、実績ある許可リスト実装（Rust/ammonia バインディング）を使う。`bleach` は代替候補だが非推奨化の経緯があり `nh3` を既定とする。
- **Sphinx 9.x API 留意点**: (1) `Builder`/`BuildEnvironment`/`Transform`/`SphinxPostTransform` の `.app` 属性は 9.0 で非推奨（11.0 で削除・代替なし）。各モジュールは `app`/`env`/`builder` を `setup(app)` や `html-page-context(app, …)` から明示的に受け渡し、`transform.app` 等に依存しない。(2) `sphinx.builders.html.Stylesheet`/`JavaScript` は 9.0 で削除済 → アセット登録は `add_js_file`/`add_css_file` を使用（本 Spec の方針通り）。(3) `get_and_resolve_doctree`/`render_partial`/`StandardDomain.objects` は 9.x で健在。

---

## 段階的実装計画（厳密な最小単位・実装順）

各単位は **「一度に実装し切れる」粒度（S/M）** で、`depends_on` は自分より小さい番号のみ（前方依存ゼロ）。t-wada 流 TDD で 1 単位＝1 Red→Green サイクル＝概ね 1 コミット。3観点の分割案＋ハード依存グラフを統合し、敵対的監査の是正を反映済み。

### 横断原則（監査反映・全単位に適用）
- **CI 早期緑化**: 既存 `check-documents.yml` は `sphinx-build -W docs` を実行するため、`pyproject.toml` 追加（#1）時点で docs ビルドが赤になる。#2 で最小 `docs/conf.py` + `exclude_patterns=['superpowers/**']` を入れて即緑化する（CI ジョブ追加自体は #25）。
- **セキュリティ不可分**: クライアント「挿入」と「二次防御 allowlist 走査」は**同一単位**で実装し、無検査挿入の骨格を単独で green 化させない（#17）。
- **rebase はビルダ非依存**: 相対段数を自前計算せず `builder.get_relative_uri(P, home)` + フラグメント結合に一本化（#10）。これで dirhtml/singlehtml は testroot 追加で済む（#21/#22）。
- **jsdom 限界の分離**: ジオメトリ計算（rect→配置）・状態機械（イベント→開閉）は純関数化して jsdom 単体、実 DOM/フォーカス/computed style は Playwright（#24）へ委譲。
- **doctree 解決の固定**: 参照抽出は `html-page-context` に渡る**解決済み doctree(P)** を走査（`#term-*` refuri は解決後にのみ出現）。home 定義は write 中に `get_and_resolve_doctree(home)` で取得し**未解決 pending_xref が残らないこと**を DoD で保証。メモ化スコープは単一 build 内に限定し env へ自前蓄積しない。
- **template ID 規約**: `id="riddle-tip--{term-id}"`。別名は term-id ごとに別 `<template>`（本体は同一 definition の複製）。`getElementById` 導出と一貫。

### Phase 0–1（MVP コア）

**1. [scaffold] 足場**（依存: なし｜S）
- 成果物: `pyproject.toml`（uv_build, `requires-python>=3.14`, `deps=[sphinx>=9, nh3]`, dev group）、`src/sphinx_riddle_whisper/__init__.py` は `ExtensionMetadata(parallel_read_safe=True, parallel_write_safe=True)` を返すだけ、`py.typed`。
- テスト: `setup(mock app)` が parallel_*_safe を含む metadata を返す。Green: 最小実装。
- DoD: `uv sync --all-groups` 緑、`uv build` で wheel に `src` 配下が入る。

**2. [tooling] tests 基盤 + CI 早期緑化**（依存: 1｜S）
- 成果物: `tests/conftest.py`（`pytest_plugins=['sphinx.testing.fixtures']`）、`tests/roots/test-min/`（glossary 1件+別名+`:term:`参照）、**最小 `docs/conf.py` + `exclude_patterns=['superpowers/**']`**。
- テスト: `@pytest.mark.sphinx('html', testroot='min')` で `app.build()` 成功・`'sphinx_riddle_whisper' in app.extensions`。
- DoD: 拡張ロード下の html ビルドが緑、既存 docs CI が緑化。

**3. [config] config.py**（依存: 1,2｜S）
- 成果物: `riddle_sanitize(True)`/`riddle_trigger`/`riddle_*delay*`/`riddle_interactive`/`riddle_include_term_title`/`riddle_strip_classes`/`riddle_allowed_*` を `add_config_value` 登録 + 不正値で `ExtensionError`。
- テスト: 既定・上書き・不正検証。DoD: 各 green。

**4. [collect(a)] term-id→home_docname 索引**（依存: 2,3｜S）
- 成果物: `StandardDomain.objects` の `objtype=='term'` から `term-id→home_docname`（別名も全索引）。
- テスト: 別名含む解決・未定義は None。

**5. [collect(b)] home doctree メモ化取得**（依存: 4｜S）
- 成果物: `env.get_and_resolve_doctree(home)` を **単一 build 内**でメモ化。
- テスト: 同一 home は 1 回取得（spy）。**DoD: 取得 doctree に未解決 pending_xref が残らないことを assert**。

**6. [collect(c)] definition 抽出（別名共有）**（依存: 5｜M）
- 成果物: `definition_list_item` 走査で全 `term['ids']`→唯一の `definition`（deepcopy）写像。
- テスト: 別名2語が同一 definition、用語ごとに正本文。

**7. [spike] PoC: render_partial 文脈破壊の確定**（依存: 6｜M）
- 成果物: 脚注/numref/連番を含む定義を `render_partial` した際の破損を再現する characterization test と採用分岐 (a)/(b)/(c) の確定。**脚注/numref 方針を pin**（home カウンタ参照不能 → リンクのみ再ベース・本文番号は固定文字列化 or 抑制）。
- DoD: 採用分岐確定。**(c) 採用時は #8 を 8a(シリアライズ基盤)/8b(番号系)に分割**する条件を明記。

**8. [render] render.py**（依存: 3,6,7｜M）
- 成果物: #7 確定分岐で無切り詰め HTML 断片化 + headerlink 除去（render 後文字列で）+ 任意 term title。
- テスト: 無切り詰め・headerlink 不在・title on/off・#7 破損要素の回帰なし。

**9. [sanitize] sanitize.py（XSS 一次防御）**（依存: 3,8｜M）
- 成果物: `nh3` 許可リストで `on*`/`javascript:`/`data:`/`script`/`iframe`/`object`/`embed`/`form`/`base`/`style` 除去、`target=_blank`→`rel=noopener`、`riddle_sanitize=False` でバイパスする純関数。
- テスト: 各 XSS ベクタ除去・良性保持・rel 付与・バイパス素通し。

**10. [rebase(a)] refuri/#anchor 再ベース（ビルダ非依存）**（依存: 6｜M）
- 成果物: `builder.get_relative_uri(P, home)` + フラグメント結合で内部 reference を P 基準へ。外部/絶対/mailto はスキップ。
- テスト: `get_relative_uri` をモックし呼出引数検証（html 固有段数をハードコードしない）。

**11. [rebase(b)] image uri 再ベース**（依存: 10｜S）
- 成果物: image `uri` を同様に P 基準へ。`http(s)`/絶対/mailto/`data:` スキップ。
- テスト: 相対のみ変換・他は不変。

**12. [inject] 参照 term-id DISTINCT 抽出**（依存: 2｜S）
- 成果物: **html-page-context に渡る解決済み doctree(P)** から `#term-*`(refuri) と `term-*`(refid) 両方を DISTINCT 列挙。
- テスト: 重複排除・refuri/refid 双方・自己定義の二重取得なし（解決後 fixture で固定）。

**13. [integration] inject 統合（初の e2e）**（依存: 9,11,12｜M）
- 成果物: `html-page-context` で #12 抽出→collect→rebase→render→(ON なら)sanitize→`<template id="riddle-tip--{term-id}">` を `context['body']` 末尾へ。`setup` で connect。**template ID 規約適用**。
- テスト: `:term:` ページに DISTINCT な template がサニタイズ済み全文で存在、参照0ページに無し。

**14. [hardening] 敵対 fixture build 側検証**（依存: 13｜S）
- 成果物: `.. raw:: html` に攻撃ペイロードを仕込む敵対 testroot。
- テスト: `riddle_sanitize=True` で template 内に危険トークン 0 件。**`False` では危険トークンが残ること（一次防御 OFF の明示）も対で検証**（二次防御 #17/#24 とペア）。

**15. [scaffold] アセット登録 + static 同梱**（依存: 13｜S）
- 成果物: `add_js_file`/`add_css_file` を HTML format ガード下で無条件登録、`static/riddle.js`・`riddle.css` プレースホルダ同梱。
- テスト: `_static` に両アセット・HTML が参照・非 HTML builder でエラーなし。

**16. [tooling] JS テスト基盤（dev-only）**（依存: 1,15｜S）
- 成果物: `package.json`(private, devDeps)、`eslint.config.mjs`(+`no-unsanitized`)、`tests/js` 雛形。wheel 非同梱を include/exclude で保証。
- テスト: ダミー JS の lint と jsdom テストが各1本走り `no-unsanitized` が発火。

### Phase 1（実行時 JS・CSS）

**17. [js] riddle.js 骨格＋二次防御（不可分）**（依存: 9,16｜M）
- 成果物: `document` 単一委譲リスナ + term-id 導出（`decodeURIComponent` try/catch）+ `getElementById` + `instanceof HTMLTemplateElement` 検証 + `cloneNode(true)` + **append 前 `TreeWalker` allowlist 走査（fail-closed・二次防御）** + click 表示。挿入と検査を同一単位で実装。
- テスト(jsdom): term-id 導出・template 検証・`on*`/`javascript:`/`script` を含む clone から危険属性/要素が走査後 0 件・良性保持。
- DoD: 無検査挿入の経路が存在しない。

**18. [js] 位置決め（計算分離）**（依存: 17｜M）
- 成果物: `getBoundingClientRect`+clamp/flip、CSSOM プロパティ代入、rAF スロットルで scroll/resize 追従。
- テスト(jsdom): **純ジオメトリ計算関数（rect 入力→配置出力）を単体**。実配置は #24 へ。

**19. [css] riddle.css**（依存: 17,18｜S）
- 成果物: `.riddle-popover` の見た目・`max-height`+`overflow`・`--riddle-*`（light/dark）。
- テスト: **CSS テキスト/CSSOM への静的アサーション**（セレクタ/プロパティ/変数定義の存在）。computed style の効きは #24。

**20. [js] トリガ/閉じる/a11y/interactive/再帰防止**（依存: 17,18｜M）
- 成果物: hover/focus/both（単一タイマー delay）・Esc/外側/blur 閉じ・`role=tooltip`/`aria-describedby`/フォーカス復帰・interactive・ポップ内リンクにトリガを張らない。
- テスト(jsdom): **状態機械（イベント→開閉状態）を単体**。focus/aria 実挙動は #24。

### Phase 1（横断ハードニング）

**21. [integration] builder: dirhtml**（依存: 11,13｜S）
- 成果物/テスト: dirhtml testroot で相対 URI 整合（rebase はビルダ非依存なので testroot 追加が主）。

**22. [integration] builder: singlehtml 分岐**（依存: 11,13｜S）
- 成果物: 同一ページ参照のため**再ベース不要分岐**。
- テスト: singlehtml で `#term-*` 同一ページ参照・id 衝突なし。

**23. [hardening] 並列/増分**（依存: 13,21,22｜M）
- 成果物: `-j` 整合・`env-purge-doc`。**env_version 要否ゲート**（自前 env 蓄積が無いことを assert、あれば `env_version`+`env-merge-info` を追加）。
- テスト: 並列で template 欠落なし・増分で最新へ置換。

**24. [hardening] Playwright E2E**（依存: 14,17,20｜M）
- 成果物: 実ブラウザで hover/focus/click 表示・Esc/外側/blur 閉じ・clamp/flip 数値・scroll/resize 追従・`file://` 起動・strict CSP 違反0・**XSS 実行非発火（`window.__pwned` 全 undefined）**・**`riddle_sanitize=False`×敵対入力×二次防御で実行非発火**のペア検証。
- テスト: 上記シナリオが実ブラウザで green。

**25. [docs] CI 配線 + デモ docs + 仕上げ**（依存: 23,24｜M）
- 成果物: CI に lint/js/e2e ジョブ追加、デモ docs（glossary + 各種定義）、README、`exclude_patterns` 最終確認。

### Phase 2（将来・各々独立単位）
- `riddle_retypeset_math`（clone 後 `MathJax.typesetPromise`）/ `riddle_retypeset_mermaid`。
- `riddle_use_tippy`（ユーザ vendoring tippy へ委譲）。
- `riddle_skip_terms` / `riddle_skip_urls`。
- `riddle_theme_vars` / `riddle_css_files` / `riddle_js_files`。

---

## 棄却した代替案（investigation §10 要約）

- sphinx-tippy: 5要素切り詰め固定・無効化不可。
- hoverxref/RTD Embed API: 実行時 fetch でオフライン破綻・hoverxref はアーカイブ済。
- JSON sidecar + fetch: `file://` で fetch 失敗・JSON エスケープ。
- inline `data-*` 属性: 属性エスケープ脆弱・定義重複でページ肥大。
- BeautifulSoup スクレイプ: bs4 依存・id↔要素マップ再構築・テーマ依存・別名対応が脆い（doctree が権威的）。
- tippy.js / `@floating-ui/dom`: 依存追加 or オフライン破綻 or 対話層自前。

---

## 次のステップ
- 注意: `docs/` は将来 Sphinx ドキュメント本体になるため、`conf.py` の `exclude_patterns` に `superpowers/**` を含め、`-W` ビルドで本 spec md が toctree 警告を出さないようにする。
- 実装は本タスク範囲外（指示「実装はしない」）。実装に進む際は writing-plans で実装計画を作成する。
