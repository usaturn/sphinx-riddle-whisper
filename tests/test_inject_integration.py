"""inject 統合（html-page-context e2e）の検証テスト。

testroot='pages' を実ビルドし、クロスページ参照ページに glossary 用語の定義
HTML が ``<template id="riddle-tip--{term-id}">`` として注入されることを確認する。
"""

from pathlib import Path

import pytest


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_クロスページ参照ページにフーの定義テンプレートが注入される(app):
    """subdir/other.html に <template id="riddle-tip--term-0"> が出力され、
    その中にフーの定義本文 'フーの定義本体。' が含まれる（e2e の本丸）。"""
    # Arrange: testroot='pages' を実ビルドする
    app.build()

    # Act: クロスページ参照ページ subdir/other.html の出力 HTML を読む
    html = (Path(app.outdir) / "subdir" / "other.html").read_text(encoding="utf-8")

    # Assert: フーの term-id 'term-0' のテンプレートに定義本文が注入されている
    assert '<template id="riddle-tip--term-0">' in html
    assert "フーの定義本体。" in html


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_定義内の内部リンクと画像がページP基準へ再ベースされる(app):
    """最重要観点#4: subdir/other.html に注入された term-0 の <template> 内で、
    定義に含まれる内部リンク・画像が表示ページ P（subdir/other）基準へ再ベースされる。

    - :doc: クロスドキュメントリンク（refuri）→ ``../topic.html``
    - :ref: 同一 home 内アンカー（refid）→ ``../index.html#intro-anchor``
    - 相対画像（uri）→ ``../_images/pic.png``（render_partial が builder.images 経由で
      ページ P 基準の _images/ へ書き換える。画像は自前再ベースしない）

    いずれも home（index, ルート）基準のままだと subdir/other.html から 404 になる。
    :doc:/:ref: は writer が verbatim 出力するため自前再ベース、画像は writer 任せ。
    """
    # Arrange: testroot='pages' を実ビルドする
    app.build()

    # Act: クロスページ参照ページ subdir/other.html の注入 template を読む
    html = (Path(app.outdir) / "subdir" / "other.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert: 3 種の内部参照がすべて P 基準（../ を含む相対）へ再ベースされている
    assert 'href="../topic.html"' in template, (
        ":doc: リンクが P 基準へ再ベースされていない"
    )
    assert 'href="../index.html#intro-anchor"' in template, (
        ":ref: 同一 home 内アンカーが home ページ基準へ再ベースされていない"
    )
    # 画像は render_partial が builder.images 経由でページ P 基準の _images/ へ
    # 書き換える。注入 template の img src を実ビルド出力ディレクトリ基準で解決した
    # 宛先が実在する（404 にならない）ことで検証する（_images 形をハードコードしない）。
    import re

    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template)
    assert img_srcs, "注入 template に img が無い（前提崩れ）"
    page_dir = Path(app.outdir) / "subdir"
    for src in img_srcs:
        resolved = (page_dir / src.split("#", 1)[0]).resolve()
        assert resolved.is_file(), (
            f"注入画像 src={src!r} が subdir/other.html 基準で 404（{resolved}）"
        )

    # Assert(回帰防止): home 基準のままの壊れた参照が残っていない
    assert 'href="#intro-anchor"' not in template, (
        "未再ベースの #anchor が残存（subdir/other.html 上で 404 になる）"
    )
    # Assert(回帰防止): 自前再ベースしていた壊れた素の pic.png が残っていない
    assert 'src="pic.png"' not in template and 'src="../pic.png"' not in template, (
        "画像が _images へ解決されず素の pic.png 形が残存（404 になる）"
    )


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_用語を参照しないページにはテンプレートが注入されない(app):
    """index.html は用語を定義するだけで参照しないため template が無い。"""
    app.build()

    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert "riddle-tip--" not in html


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_同一term_idのテンプレートはちょうど1回だけ注入される(app):
    """DISTINCT 注入: subdir/other.html に term-0 の template が重複なく1回だけ出る。"""
    app.build()

    html = (Path(app.outdir) / "subdir" / "other.html").read_text(encoding="utf-8")

    assert html.count('id="riddle-tip--term-0"') == 1
