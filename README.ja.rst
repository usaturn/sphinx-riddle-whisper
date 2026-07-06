=====================
sphinx-riddle-whisper
=====================

.. |pypi| image:: https://img.shields.io/pypi/v/sphinx-riddle-whisper
   :target: https://pypi.org/project/sphinx-riddle-whisper/
   :alt: PyPI

.. |python| image:: https://img.shields.io/pypi/pyversions/sphinx-riddle-whisper
   :target: https://pypi.org/project/sphinx-riddle-whisper/
   :alt: Python versions

.. |license| image:: https://img.shields.io/badge/License-MIT-yellow.svg
   :target: https://opensource.org/licenses/MIT
   :alt: License: MIT

.. |lang-en| image:: https://img.shields.io/badge/lang-English-blue
   :target: README.rst
   :alt: English

|pypi| |python| |license| |lang-en|

用語集（glossary）の定義をポップアップで丸ごと表示する Sphinx 拡張です。切り詰め
なし、オフライン、Vanilla JS で動作します。

読者が ``:term:`` 参照にホバー／クリックすると、用語集の完全な定義がその場の
ポップオーバーに表示されます。用語集ページへ往復する必要がありません。

特徴
====

- **切り詰めなし** — 用語集の定義を丸ごと表示します。最大高さ／幅は設定可能で、
  長い定義はスクロールできます。
- **オフライン** — 定義はビルド時にレンダリングされ、インラインの ``<template>``
  要素として埋め込まれます。ネットワーク要求も CDN もありません。
- **Vanilla JS** — 第三者のランタイムライブラリを同梱しません。
- **ホバーとクリック** — ホバー／クリック／その両方でポップオーバーを開けます。
- **脚注・引用** — 脚注や引用の本文も、同じポップオーバー形式で表示できます
  （任意）。
- **画像ライトボックス** — リンクされた画像を、フォーカストラップ付きの
  ライトボックスで開けます（任意）。
- **多層サニタイズ** — HTML はビルド時に
  `nh3 <https://pypi.org/project/nh3/>`_ でサニタイズし、ブラウザ側でも再検査する
  二次防御を備えます。
- **増分ビルド対応** — 用語の定義元が変更されると、その用語を参照しているページが
  再ビルドされます。
- **ネストポップアップ** — ポップアップ内の ``:term:`` リンクから2段目の
  ポップアップを開ける（固定2段・設定で無効化可能）。

動作要件
========

- Python >= 3.11
- Sphinx >= 9

インストール
============

PyPI から:

.. code-block:: bash

   pip install sphinx-riddle-whisper

ソースから:

.. code-block:: bash

   pip install git+https://github.com/usaturn/sphinx-riddle-whisper.git

クローンしてローカルにインストール（本プロジェクトは
`uv <https://docs.astral.sh/uv/>`_ を使用します）:

.. code-block:: bash

   git clone https://github.com/usaturn/sphinx-riddle-whisper.git
   cd sphinx-riddle-whisper
   uv pip install .

クイックスタート
================

``conf.py`` に拡張を追加します:

.. code-block:: python

   extensions = ["sphinx_riddle_whisper"]

標準の ``glossary`` ディレクティブで用語を定義します:

.. code-block:: rst

   .. glossary::

      reStructuredText
          プレーンテキストのマークアップ構文とパーサー群であり、Sphinx が
          既定で用いるマークアップ言語です。

任意のページから ``:term:`` ロールで参照します:

.. code-block:: rst

   Sphinx のドキュメントは通常 :term:`reStructuredText` で記述します。

あとは通常どおり HTML をビルドするだけです。``:term:`` 参照にホバー／クリックすると、
追加のマークアップなしで完全な定義がポップオーバー表示されます。

設定
====

すべてのオプションは ``conf.py`` で設定します。表示・機能に関するオプションと既定値は
次のとおりです。

.. list-table::
   :header-rows: 1
   :widths: 28 12 22 38

   * - オプション
     - 型
     - 既定値
     - 説明
   * - ``riddle_trigger``
     - str
     - ``"both"``
     - ポップオーバーの開き方: ``"hover"`` / ``"click"`` / ``"both"``。
   * - ``riddle_max_height``
     - str
     - ``"24rem"``
     - ポップオーバーの最大高さ（任意の CSS 長）。
   * - ``riddle_max_width``
     - str
     - ``"32rem"``
     - ポップオーバーの最大幅（任意の CSS 長）。
   * - ``riddle_open_delay_ms``
     - int
     - ``150``
     - ホバー時に開くまでの遅延（ミリ秒、>= 0）。
   * - ``riddle_close_delay_ms``
     - int
     - ``100``
     - ホバーが外れてから閉じるまでの遅延（ミリ秒、>= 0）。
   * - ``riddle_interactive``
     - bool
     - ``True``
     - ポインタがポップオーバー上にある間は開いたままにします。
   * - ``riddle_include_term_title``
     - bool
     - ``True``
     - ポップオーバー先頭に用語名を見出しとして表示します。
   * - ``riddle_footnotes``
     - bool
     - ``True``
     - 脚注・引用参照のポップオーバーを有効にします。
   * - ``riddle_image_popup``
     - bool
     - ``True``
     - 画像ライトボックスを有効にします。
   * - ``riddle_nested``
     - bool
     - ``True``
     - ポップアップ内の ``:term:`` リンクから2段目のポップアップを開く。

既定値を明示した例:

.. code-block:: python

   riddle_trigger = "both"
   riddle_max_height = "24rem"
   riddle_max_width = "32rem"
   riddle_open_delay_ms = 150
   riddle_close_delay_ms = 100
   riddle_interactive = True
   riddle_include_term_title = True
   riddle_footnotes = True
   riddle_image_popup = True
   riddle_nested = True

脚注・引用・画像ライトボックス
==============================

``riddle_footnotes = True``\ （既定）では、脚注・引用の参照をクリック／ホバーすると、
同一ページ内の脚注・引用本文がポップオーバー表示されます。読者は読んでいる場所を
見失わずに参照を確認できます。

``riddle_image_popup = True``\ （既定）では、リンクされた画像がフォーカストラップ付き・
スクロールロック付きのライトボックスで開きます。安全な画像 URL（許可スキーム上の
画像拡張子）のみが対象です。

いずれも ``False`` にするとその機能を無効化できます。

ネストポップアップ
==================

``riddle_nested = True``\ （既定）では、表示中のポップアップ内の ``:term:``
リンクにホバー / クリックすると、2段目のポップアップが1段目に重ねて表示され、
他の用語を参照する定義をページを離れずに辿れます。ネストは固定2段で、2段目の
ポップアップ内の ``:term:`` は通常のリンクとして機能します。1段目に表示中の
用語と同じ用語へのリンクでは重複表示しません。Esc キーは内側（2段目）から順に
閉じます。``False`` にするとポップアップ内の ``:term:`` リンクは従来どおり
何も開きません。

セキュリティ
============

用語集の定義には任意のインライン HTML を含められるため、本拡張は内容を2層で
サニタイズします。

- **ビルド時** — 定義の断片は、埋め込み前に
  `nh3 <https://pypi.org/project/nh3/>`_ で、タグ・属性・URL スキームの組み込み
  許可リストに対してサニタイズされます。
- **ランタイム** — ポップオーバー表示の直前に、複製した断片をブラウザ側で再走査
  します。許可リスト外の要素は除去し、``on*`` ハンドラや危険な URL スキームを
  取り除き、``target="_blank"`` のリンクには ``rel="noopener noreferrer"`` を付与
  します。

安全性に関するオプションで、ビルド時の許可リストを調整・置換できます。

.. list-table::
   :header-rows: 1
   :widths: 30 18 18 34

   * - オプション
     - 型
     - 既定値
     - 説明
   * - ``riddle_sanitize``
     - bool
     - ``True``
     - nh3 によるビルド時 HTML サニタイズを有効にします。
   * - ``riddle_allowed_tags``
     - tuple[str] | None
     - ``None``
     - 許可する HTML タグ。``None`` で組み込み許可リストを使用します。
   * - ``riddle_allowed_attributes``
     - dict[str, tuple[str]] | None
     - ``None``
     - タグごとの許可属性。``None`` で組み込み許可リストを使用します。
   * - ``riddle_allowed_schemes``
     - tuple[str] | None
     - ``None``
     - 許可する URL スキーム。``None`` で組み込み許可リストを使用します。
   * - ``riddle_strip_classes``
     - tuple[str]
     - ``("headerlink", "sd-stretched-link")``
     - 定義から除去するアンカーの CSS クラス名。

ドキュメント
============

完全なドキュメントは、本リポジトリの ``docs/`` ディレクトリから Sphinx でビルド
できます。

ライセンス
==========

MIT
