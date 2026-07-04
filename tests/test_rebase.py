"""rebase.py（相対 URI 再ベース）のテスト。

home ドキュメント文脈で解決した reference の refuri を、別ディレクトリの
表示ページ P 基準へ再ベースする純関数群を検証する。
ビルダ非依存のため builder.get_relative_uri は Mock で擬似化する（実ビルド不要・決定的）。
"""

from unittest.mock import Mock

from docutils import nodes

from sphinx_riddle_whisper.rebase import (
    rebase_internal_references,
    rebase_refuri,
)


def _builder(return_value):
    """get_relative_uri が固定値を返す Mock builder を作る。"""
    builder = Mock()
    builder.get_relative_uri = Mock(return_value=return_value)
    return builder


def test_同一ページのアンカーはbaseが空のときそのまま返る():
    """base='' のとき rebase_refuri('#sec', home='index', page='index') が
    '#sec' を返し、get_relative_uri が ('index', 'index') で1回呼ばれること
    （html 固有の相対段数をハードコードしない検証）。"""
    # Arrange: get_relative_uri が '' を返す Mock builder を用意する
    builder = Mock()
    builder.get_relative_uri = Mock(return_value="")

    # Act: home と同一ページのアンカー refuri を再ベースする
    result = rebase_refuri(
        "#sec", home_docname="index", page_docname="index", builder=builder
    )

    # Assert: base='' なので '#sec' のまま返り、相対 URI は builder に委ねている
    assert result == "#sec"
    builder.get_relative_uri.assert_called_once_with("index", "index")


def test_サブディレクトリからのアンカーはbaseと連結される():
    """base='../index.html' のとき '#sec' が '../index.html#sec' になる。"""
    result = rebase_refuri(
        "#sec",
        home_docname="index",
        page_docname="sub/page",
        builder=_builder("../index.html"),
    )

    assert result == "../index.html#sec"


def test_外部URLはスキップされget_relative_uriを呼ばない():
    """https スキームの refuri は不変で、get_relative_uri が呼ばれない。"""
    builder = _builder("")

    result = rebase_refuri(
        "https://example.com/x",
        home_docname="index",
        page_docname="index",
        builder=builder,
    )

    assert result == "https://example.com/x"
    builder.get_relative_uri.assert_not_called()


def test_mailtoはスキップされる():
    """mailto: スキームの refuri は不変で get_relative_uri が呼ばれない。"""
    builder = _builder("")

    result = rebase_refuri(
        "mailto:a@b.com", home_docname="index", page_docname="index", builder=builder
    )

    assert result == "mailto:a@b.com"
    builder.get_relative_uri.assert_not_called()


def test_サイト絶対パスはスキップされる():
    """'/abs/path' のサイト絶対 URL は不変で get_relative_uri が呼ばれない。"""
    builder = _builder("")

    result = rebase_refuri(
        "/abs/path", home_docname="index", page_docname="index", builder=builder
    )

    assert result == "/abs/path"
    builder.get_relative_uri.assert_not_called()


def test_ネットワークロケーション付きURLはスキップされる():
    """'//host/path' のプロトコル相対 URL は不変で get_relative_uri が呼ばれない。"""
    builder = _builder("")

    result = rebase_refuri(
        "//host/path", home_docname="index", page_docname="index", builder=builder
    )

    assert result == "//host/path"
    builder.get_relative_uri.assert_not_called()


def test_falsyなrefuriはそのまま返る():
    """None / 空文字はそのまま返り get_relative_uri が呼ばれない。"""
    builder = _builder("")

    assert (
        rebase_refuri(None, home_docname="i", page_docname="i", builder=builder) is None
    )
    assert rebase_refuri("", home_docname="i", page_docname="i", builder=builder) == ""
    builder.get_relative_uri.assert_not_called()


def test_クロスドキュメント相対はディレクトリと結合される():
    """base のディレクトリ部とクロスドキュメント相対パスが結合・正規化される。"""
    # dirname が空（base='index.html'）→ そのまま
    assert (
        rebase_refuri(
            "other.html#x",
            home_docname="index",
            page_docname="index",
            builder=_builder("index.html"),
        )
        == "other.html#x"
    )
    # dirname が 'sub'（base='sub/index.html'）→ 'sub/other.html#x'
    assert (
        rebase_refuri(
            "other.html#x",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/index.html"),
        )
        == "sub/other.html#x"
    )


def test_クロスドキュメント相対のフラグメントなしも扱える():
    """フラグメントのないクロスドキュメント相対パスも正規化される。"""
    assert (
        rebase_refuri(
            "other.html",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/index.html"),
        )
        == "sub/other.html"
    )


def test_クロスドキュメント相対のquery_stringを保持する():
    """クロスドキュメント相対 refuri の query string は再ベース後も落とさない。"""
    builder = _builder("sub/index.html")

    assert (
        rebase_refuri(
            "other.html?q=1#x",
            home_docname="index",
            page_docname="p",
            builder=builder,
        )
        == "sub/other.html?q=1#x"
    )
    assert (
        rebase_refuri(
            "other.html?q=1",
            home_docname="index",
            page_docname="p",
            builder=builder,
        )
        == "sub/other.html?q=1"
    )
    assert (
        rebase_refuri(
            "dir/?q=1#x",
            home_docname="index",
            page_docname="p",
            builder=builder,
        )
        == "sub/dir/?q=1#x"
    )


def test_query_only相対refuriはhomeドキュメントpathにqueryを付ける():
    """?q=1 形の相対 refuri は home の文書 URI に query を付けて再ベースする。"""
    assert (
        rebase_refuri(
            "?q=1#x",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/index.html"),
        )
        == "sub/index.html?q=1#x"
    )
    assert (
        rebase_refuri(
            "?q=1",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/index.html"),
        )
        == "sub/index.html?q=1"
    )
    assert (
        rebase_refuri(
            "?q=1#x",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/"),
        )
        == "sub/?q=1#x"
    )
    assert (
        rebase_refuri(
            "?#x",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/index.html"),
        )
        == "sub/index.html#x"
    )
    assert (
        rebase_refuri(
            "?#x",
            home_docname="index",
            page_docname="p",
            builder=_builder("sub/"),
        )
        == "sub/#x"
    )


def test_rebase_internal_referencesがsubtree内のrefuriを書き換える():
    """subtree 内の内部参照 refuri が P 基準へ書き換わり、外部参照は不変。"""
    para = nodes.paragraph()
    internal = nodes.reference()
    internal["refuri"] = "#sec"
    external = nodes.reference()
    external["refuri"] = "https://x"
    para += internal
    para += external

    rebase_internal_references(
        para,
        home_docname="index",
        page_docname="sub/p",
        builder=_builder("../index.html"),
    )

    assert internal["refuri"] == "../index.html#sec"
    assert external["refuri"] == "https://x"


def test_rebase_internal_referencesはrefuriなしの参照をスキップする():
    """refuri 属性を持たない reference があっても例外を出さずスキップする。"""
    para = nodes.paragraph()
    refless = nodes.reference()  # refuri 属性なし（refid 等のみ想定）
    para += refless

    # 例外が出なければ成功
    rebase_internal_references(
        para, home_docname="index", page_docname="index", builder=_builder("")
    )
