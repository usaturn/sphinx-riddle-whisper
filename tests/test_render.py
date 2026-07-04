"""render.py（無切り詰めレンダリング）のテスト。

採用分岐 (a)（doctree 方式維持）の下で、URI 補正済み definition サブツリーを
HTML 断片化し headerlink 等を除去する純粋関数群を検証する。
sanitize（nh3）はこの単位では呼ばない（#9/#13 で扱う）。
strip は標準ライブラリ（re, html）のみで行い、beautifulsoup4 は使わない。
"""

import pytest

from sphinx_riddle_whisper.collect import HomeDoctreeCache, extract_definitions
from sphinx_riddle_whisper.render import _strip_anchor_classes, render_definition


def test_headerlinkアンカーが属性ごと完全に除去される():
    """class="headerlink" を持つ <a ...>¶</a> が、開始タグの属性も含めて
    アンカー要素ごと完全に除去されること（headerlink の ¶ アンカー除去）。"""
    # Arrange: 段落の末尾に headerlink アンカーが付いた HTML 断片を用意する
    html = (
        "<p>本文テキスト"
        '<a class="headerlink" href="#x" title="この見出しへのパーマリンク">¶</a>'
        "</p>"
    )

    # Act: headerlink クラスのアンカーを除去する
    result = _strip_anchor_classes(html, ["headerlink"])

    # Assert: アンカー要素（属性・¶ を含む）が完全に消え、本文は残る
    assert result == "<p>本文テキスト</p>"


def test_strip対象外の通常アンカーは残る():
    """strip_classes に無いクラスの <a> は除去されない。"""
    html_fragment = '<a class="reference internal" href="a.html">テキスト</a>'

    assert _strip_anchor_classes(html_fragment, ["headerlink"]) == html_fragment


def test_class属性に複数クラスが空白区切りでも該当アンカーを除去する():
    """class="foo headerlink bar" のように複数クラスが並んでも当該アンカーを除去する。"""
    html_fragment = '<p>x<a class="foo headerlink bar" href="#y">¶</a></p>'

    assert _strip_anchor_classes(html_fragment, ["headerlink"]) == "<p>x</p>"


def test_複数のstrip_classesで両方のアンカーが除去される():
    """headerlink と sd-stretched-link の両方の <a> が除去される。"""
    html_fragment = (
        "<p>本文"
        '<a class="headerlink" href="#a">¶</a>'
        '<a class="sd-stretched-link" href="#b">link</a>'
        "</p>"
    )

    result = _strip_anchor_classes(html_fragment, ["headerlink", "sd-stretched-link"])

    assert result == "<p>本文</p>"


def test_strip_classesが空なら何も除去しない():
    """strip_classes が空（既定）のとき fragment をそのまま返す。"""
    html_fragment = '<p>x<a class="headerlink" href="#y">¶</a></p>'

    assert _strip_anchor_classes(html_fragment, []) == html_fragment


def test_term_titleを付加しない場合はriddle_term_titleが含まれない():
    """include_term_title=False のとき 'riddle-term-title' が出力に含まれない。"""
    builder = _FakeBuilder("<dd><p>定義</p></dd>")

    result = render_definition(
        builder, object(), include_term_title=False, term_text="フー"
    )

    assert "riddle-term-title" not in result


def test_term_titleが定義本文より前に付加される():
    """include_term_title=True, term_text='フー' で term タイトルが定義の前に出る。"""
    builder = _FakeBuilder("<dd><p>定義本文</p></dd>")

    result = render_definition(
        builder, object(), include_term_title=True, term_text="フー"
    )

    assert '<p class="riddle-term-title">フー</p>' in result
    assert result.index("フー") < result.index("定義本文")


def test_term_textが空ならタイトルを付加しない():
    """include_term_title=True でも term_text が None/空ならタイトルを付加しない。"""
    builder = _FakeBuilder("<dd><p>定義</p></dd>")

    result = render_definition(
        builder, object(), include_term_title=True, term_text=None
    )

    assert "riddle-term-title" not in result


def test_term_textのHTML特殊文字はエスケープされる():
    """term_text の HTML 特殊文字が html.escape され、生の '<b>' がタイトルに現れない。"""
    builder = _FakeBuilder("<dd><p>定義</p></dd>")

    result = render_definition(
        builder, object(), include_term_title=True, term_text="<b>x</b>"
    )

    assert '<p class="riddle-term-title"><b>' not in result
    assert "&lt;b&gt;x&lt;/b&gt;" in result


class _FakeBuilder:
    """render_partial のみを持つ擬似 Builder。fragment を固定で返す。"""

    def __init__(self, fragment: str) -> None:
        self._fragment = fragment

    def render_partial(self, node):
        return {"fragment": self._fragment}


@pytest.mark.sphinx("html", testroot="min", warningiserror=True)
def test_無切り詰めで定義の全要素が残る(app):
    """5要素超（複数段落・リスト・コード）を含む定義が切り詰められずに全て残る。"""
    app.build()
    definition = extract_definitions(
        HomeDoctreeCache(app.env, app.builder).get("index")
    )["term-richterm"]

    result = render_definition(
        app.builder, definition, strip_classes=["headerlink", "sd-stretched-link"]
    )

    for needle in (
        "最初の段落。",
        "二番目の段落。",
        "項目一",
        "項目二",
        "項目三",
        "print",
    ):
        assert needle in result


@pytest.mark.sphinx("html", testroot="context", warningiserror=True)
def test_numref番号がstripで誤除去されない(app):
    """#7 回帰: numref を含む定義を render しても 'Fig. 1' が残る。"""
    app.build()
    definitions = extract_definitions(
        HomeDoctreeCache(app.env, app.builder).get("index")
    )
    numref_def = next(d for d in definitions.values() if "図を" in d.astext())

    result = render_definition(app.builder, numref_def, strip_classes=["headerlink"])

    assert "Fig. 1" in result
