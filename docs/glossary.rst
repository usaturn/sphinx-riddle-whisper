.. _glossary:

======
用語集
======

概要
====

sphinx-riddle-whisper のドキュメントで用いる専門用語を定義する。

.. glossary::

    脚注/引用ポップアップ
        sphinx-riddle-whisper が提供する機能の 1 つで、HTML 上の脚注参照・引用参照に
        ホバーまたはクリックすると、同一ページ内の脚注本体（ ``aside.footnote`` ）または
        引用本体（ ``aside.citation`` ）を共有 :term:`popover` に表示するものである。
        :term:`DOM` 解決方式でクライアント側が本体を引くため、クロスページ脚注は非対応である

    popover
        参照要素の近傍に重ねて表示する小さなオーバーレイ UI である。
        本拡張では :term:`glossary` 用語と :term:`脚注/引用ポップアップ` が
        単一の ``.riddle-popover`` 要素・タイマー・表示設定を共有する

    DOM
        Document Object Model の略で、HTML 文書をツリー構造として表現したものである。
        本拡張の :term:`脚注/引用ポップアップ` は、参照アンカーの ``href`` から
        本体要素を :term:`DOM` 上で引いて内容を取得する

    DOM 契約
        :term:`脚注/引用ポップアップ` が本体を引くために前提とする HTML 要素の構造である。
        Sphinx 9.x / :term:`docutils` 0.22 の HTML5 writer が出力する
        ``aside.footnote`` / ``aside.citation`` 等のクラスとアンカー構造を指す。
        テーマによりこの構造が異なる可能性がある

    DOM clobbering
        ページ内の要素 ``id`` や ``name`` がグローバルなプロパティを上書きし、
        スクリプトが参照する値を意図せず差し替えてしまう攻撃手法である。
        本拡張の ``readRiddleConfig`` は設定値が boolean のときのみ採用し、
        非 boolean を既定値へ正規化することでこの耐性を確保する

    fail-closed
        想定外の入力や状態を検出したとき、機能を発動させず安全側に倒す設計方針である。
        本拡張では脚注/引用本体が未検出・取得要素が ``aside`` でない・想定外クラスの場合に
        ポップアップを表示しない

    runtime config
        各ドキュメントページの HTML へ注入される実行時設定であり、
        ``conf.py`` の ``riddle_*`` 設定を camelCase の JSON へ変換した
        ``<script type="application/json" id="riddle-config">`` として body 末尾に置かれる。
        クライアント側 JavaScript がこれを読んでポップアップ動作を制御する

    builder-inited
        Sphinx のビルドイベントの 1 つで、ビルダーの初期化直後に発火する。
        本拡張はこのイベントで :term:`html builder` のときだけ静的アセットを
        ``html_static_path`` に登録する

    html builder
        Sphinx が HTML を出力するためのビルダーである（ ``app.builder.format == "html"`` ）。
        本拡張のアセット登録はこのビルダーのときだけ行われ、
        非 HTML builder では何も登録されない

    doctree
        Sphinx が reStructuredText を解析して構築する文書の中間ツリー表現である。
        本拡張の :term:`runtime config` 注入は ``doctree`` が存在するドキュメントページに対して行われ、
        ``doctree`` が None の非ドキュメントページでは注入しない

    docutils
        reStructuredText を解析し HTML 等へ変換する Python ライブラリで、Sphinx の基盤である。
        本拡張の :term:`DOM 契約` は :term:`docutils` 0.22 の HTML5 writer が出力する構造を前提とする

    glossary
        用語とその定義を集約する Sphinx の機能であり、 ``.. glossary::`` ディレクティブと
        ``:term:`` ロールで構成される。本拡張は ``:term:`` 参照に対しても
        定義をポップアップ表示する

    uv
        Python のパッケージ管理・実行ツールである。
        本プロジェクトでは依存の追加・同期（ ``uv add`` / ``uv sync`` ）と
        ``uv run`` による Sphinx ビルドに使用する

    nh3
        HTML をサニタイズする Python ライブラリである。
        本拡張ではビルド時に注入する HTML 断片のサニタイズに使用する実行時依存である

    用語
        :term:`glossary` の ``.. glossary::`` で定義され ``:term:`` ロールで参照される語である。
        本拡張は ``:term:`` 参照（ ``a[href*='#term-']`` ）のホバー／クリックに対し、
        定義を :term:`popover` で表示する

    ESM
        ECMAScript Modules の略で、 ``import`` / ``export`` を用いる JavaScript の標準モジュール形式である。
        本拡張の ``riddle.js`` は :term:`ESM` であり、 ``type="module"`` で登録された
        ``riddle-init.js`` からの import 経由で評価される

    html-page-context
        Sphinx のビルドイベントの 1 つで、各 HTML ページのレンダリング直前に発火する。
        本拡張はこのイベントで :term:`runtime config` を ``context['body']`` 末尾へ注入する。
        :term:`doctree` が ``None`` の非ドキュメントページでは注入しない

    config-inited
        Sphinx のビルドイベントの 1 つで、設定の初期化完了後に発火する。
        本拡張はこのイベントへ ``validate_config`` を接続し、 ``riddle_*`` 設定を検証する

    env-updated
        Sphinx のビルドイベントの 1 つで、ソースの読み込みフェーズ完了後に親プロセスで一度だけ発火する。
        本拡張はこのイベントへ ``record_page_home_dependencies`` を接続し、各ページが参照する :term:`用語` の
        home ソースを ``env.note_dependency`` へ一括記録する。
        :term:`html-page-context` は並列書き出しのワーカーで発火し依存記録が親 ``env`` へ反映されないため、
        依存記録はこのイベントで行う

    render_partial
        Sphinx のビルダーが持つメソッドで、 :term:`doctree` の部分木を独立した HTML 断片へ変換するものである。
        本拡張の ``render_definition`` は ``builder.render_partial(definition)["fragment"]`` で
        無切り詰めの HTML 断片を得る。
        画像 ``uri`` は ``render_partial`` （ HTML writer ）が ``builder.images`` / ``imgpath`` 経由で
        表示ページ基準へ自動書換するため、本拡張は画像の再ベースを自前で行わない

    TreeWalker
        DOM の要素を順にたどるためのブラウザ標準 API （ ``document.createTreeWalker`` ）である。
        本拡張の ``sanitizeFragment`` は ``SHOW_ELEMENT`` で要素を巡回し、許可タグ以外を収集して
        走査完了後に unwrap する実行時の二次サニタイズに用いる

    ポストトランスフォーム
        post-transform
        Sphinx が :term:`doctree` の解決後に適用する変換段階である。
        本拡張は増分ビルドの利点を保つため、依存記録では未解決 :term:`doctree` を用い
        :term:`ポストトランスフォーム` 込みのフル解決を避ける。
        実行時の ``sanitizeFragment`` も、走査後にまとめて要素を除去する点でこれに類似した後処理方式を採る

    parallel_read_safe
        Sphinx 拡張が ``setup(app)`` の戻り値として宣言するメタデータで、
        ソースの並列読み込みに対して安全であることを示す。
        本拡張はこれを True で返す

    parallel_write_safe
        Sphinx 拡張が ``setup(app)`` の戻り値として宣言するメタデータで、
        成果物の並列書き出しに対して安全であることを示す。
        本拡張はこれを True で返す

    wheel
        Python パッケージの配布形式の 1 つで、 ``.whl`` 拡張子を持つビルド済みアーカイブである。
        インストール時にビルドを伴わないため、 :term:`sdist` よりインストールが速い。
        本プロジェクトでは ``uv build`` が dist/ に sdist とともに出力する

    sdist
        ソース配布物（ source distribution ）の略で、 ``.tar.gz`` 拡張子を持つアーカイブである。
        ソースコードとビルドに必要なメタデータを含み、インストール時にビルドが行われる。
        本プロジェクトでは ``uv build`` が dist/ に :term:`wheel` とともに出力する

    uv_build
        :term:`uv` が提供するビルドバックエンドである。
        pyproject.toml の ``[build-system]`` で指定し、 :term:`sdist` と :term:`wheel` を生成する。
        本プロジェクトは ``requires = ["uv_build>=0.11.21,<0.12"]`` を指定し、 src レイアウトで
        ``module-name=sphinx_riddle_whisper`` ・ ``module-root=src`` を設定している

    Trusted Publishing
        API トークンやユーザ名・パスワードを手動設定することなく、 :term:`OIDC` による短命の認証で
        PyPI へ公開する仕組みである。
        GitHub Actions では Trusted Publisher として Repository owner's name ・ Repository's name ・
        Workflow filename を PyPI 側に登録し、ワークフローからの公開を信頼させる

    OIDC
        OpenID Connect の略で、 OAuth 2.0 を基盤とする ID 認証の標準仕様である。
        :term:`Trusted Publishing` では GitHub Actions が発行する OIDC トークンを PyPI が検証することで、
        永続的なシークレットを保持せずに公開を認証する

    XSS
        Cross-Site Scripting の略で、攻撃者が用意したスクリプトを閲覧者のブラウザで実行させる脆弱性である。
        本拡張では HTML サニタイズにより危険な属性値や要素を除去し、 XSS の成立条件を減らす

    data URI
        ``data:`` スキームでデータ本体を URL に直接埋め込む表現である。
        画像埋め込みなどの用途がある一方で、文脈によってはスクリプト実行経路になりうるため、
        本拡張のサニタイズでは属性ごとに許可可否を判定する

    srcset
        ``img`` 要素などで複数画像候補を解像度や幅条件付きで指定する属性である。
        候補列の一部に危険な :term:`data URI` が含まれる場合、 fail-safe ではなく :term:`fail-closed` で
        属性全体を除去する実装を採る

    URL-bearing 属性
        ``href`` や ``src`` のように URL 値を取る HTML 属性の総称である。
        許可タグ・許可属性を拡張する構成では、 :term:`URL-bearing 属性` に対するスキーム検査範囲が
        :term:`XSS` 境界に直結する

    singlehtml
        Sphinx の ``singlehtml`` builder が出力する、 1 ページ集約型の HTML 形式である。
        本拡張では脚注/引用と :term:`glossary` 用語のトリガー解決を単一ページ内で行うため、
        断片 ID とエンコード表現の扱いが挙動に影響する

以上
