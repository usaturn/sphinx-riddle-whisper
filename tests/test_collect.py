"""collect.py の term-id → home_docname 索引ロジックを検証するテスト。"""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from docutils import nodes

from sphinx_riddle_whisper.collect import (
    HomeDoctreeCache,
    build_term_entry_index_by_name,
    build_term_home_index,
    extract_definitions,
)


def test_objtypeがterm以外のエントリは索引に含まれない():
    """objtype が 'term' 以外（('label','x')->('doc','id-x')）の labelid は索引のキーに現れない。"""
    # Arrange: term エントリと label エントリを併せ持つ擬似 std ドメインを用意する
    fake_std = SimpleNamespace(
        objects={
            ("term", "foo"): ("index", "term-foo"),
            ("label", "x"): ("doc", "id-x"),
        }
    )

    # Act: 索引を構築する
    index = build_term_home_index(fake_std)

    # Assert: label 由来の labelid 'id-x' は索引のキーに含まれない
    assert "id-x" not in index


def test_termとlabel混在時はterm由来だけが索引に残りlabel由来は完全に除外される():
    """term と label が混在する objects で、term 由来の term-id だけが索引に含まれ、
    label 由来は件数・内容の両面で完全に除外される。"""
    # Arrange: 2 件の term エントリと 2 件の label エントリを併せ持つ擬似 std ドメインを用意する
    fake_std = SimpleNamespace(
        objects={
            ("term", "foo"): ("index", "term-foo"),
            ("term", "バー"): ("index", "term-1"),
            ("label", "x"): ("doc", "lbl-x"),
            ("label", "ラベル"): ("other", "lbl-1"),
        }
    )

    # Act: 索引を構築する
    index = build_term_home_index(fake_std)

    # Assert: 件数は term 件数（2）に一致し、中身は term 由来のみで label 由来は含まれない
    assert index == {"term-foo": "index", "term-1": "index"}


def test_別名の2つのterm_idが両方とも同一docnameを指す():
    """同一定義を共有する別名（フー/foo）の term-id が両方とも索引に含まれ、各々正しい docname を指す。"""
    # Arrange: 別名（同一 docname 'index' を共有する term-0 と term-foo）を持つ擬似 std ドメイン
    fake_std = SimpleNamespace(
        objects={
            ("term", "フー"): ("index", "term-0"),
            ("term", "foo"): ("index", "term-foo"),
        }
    )

    # Act
    index = build_term_home_index(fake_std)

    # Assert: 両 term-id が別キーで存在し、いずれも 'index' を指す
    assert index["term-0"] == "index"
    assert index["term-foo"] == "index"


def test_同一home_docnameに対しgetを2回呼んでも解決は1回しか行われない():
    """同一 home_docname を get で2回取得しても env.get_and_resolve_doctree は1回しか呼ばれない（メモ化）。"""
    # Arrange: get_and_resolve_doctree を spy 化した擬似 env と擬似 builder で cache を作る
    fake_env = SimpleNamespace(get_and_resolve_doctree=Mock(return_value=object()))
    fake_builder = SimpleNamespace()
    cache = HomeDoctreeCache(fake_env, fake_builder)

    # Act: 同一 home_docname 'index' を2回取得する
    cache.get("index")
    cache.get("index")

    # Assert: 解決処理は1回しか呼ばれていない
    assert fake_env.get_and_resolve_doctree.call_count == 1


def test_異なるhome_docnameはそれぞれ1回ずつ解決される():
    """異なる home_docname 'a' と 'b' を取得すると解決処理が2回呼ばれる。"""
    fake_env = SimpleNamespace(
        get_and_resolve_doctree=Mock(side_effect=[object(), object()])
    )
    cache = HomeDoctreeCache(fake_env, SimpleNamespace())

    cache.get("a")
    cache.get("b")

    assert fake_env.get_and_resolve_doctree.call_count == 2


def test_getは解決結果のオブジェクトをそのまま返す():
    """get の戻り値は env.get_and_resolve_doctree の戻り値と同一オブジェクトである。"""
    sentinel = object()
    fake_env = SimpleNamespace(get_and_resolve_doctree=Mock(return_value=sentinel))
    cache = HomeDoctreeCache(fake_env, SimpleNamespace())

    assert cache.get("index") is sentinel


def test_同一home_docnameの2回目は1回目と同一オブジェクトを返す():
    """メモ化により、同一 home_docname の2回目の get が1回目と同一オブジェクトを返す。"""
    fake_env = SimpleNamespace(get_and_resolve_doctree=Mock(return_value=object()))
    cache = HomeDoctreeCache(fake_env, SimpleNamespace())

    first = cache.get("index")
    second = cache.get("index")

    assert first is second


def test_getはbuilderを解決処理に渡す():
    """get は env.get_and_resolve_doctree に builder を引数として渡す。"""
    fake_builder = SimpleNamespace()
    fake_env = SimpleNamespace(get_and_resolve_doctree=Mock(return_value=object()))
    cache = HomeDoctreeCache(fake_env, fake_builder)

    cache.get("index")

    args, _kwargs = fake_env.get_and_resolve_doctree.call_args
    assert fake_builder in args


@pytest.mark.sphinx("html", testroot="min")
def test_解決済みdoctreeに未解決のpending_xrefが残らない(app):
    """DoD: HomeDoctreeCache.get が返す doctree に未解決 pending_xref が残っていない。"""
    from sphinx import addnodes

    app.build()
    cache = HomeDoctreeCache(app.env, app.builder)

    doctree = cache.get("index")

    assert not list(doctree.findall(addnodes.pending_xref))


@pytest.mark.sphinx("html", testroot="min")
def test_実ビルドのstd_objectsから索引が構築できる(app):
    """実ビルドの StandardDomain.objects 構造前提が崩れていないことを保証するスモークテスト。"""
    # Arrange & Act: testroot='min' をビルドし std ドメインから索引を構築する
    app.build()
    std = app.env.get_domain("std")

    index = build_term_home_index(std)

    # Assert: ascii 用語 foo の term-id 'term-foo' が home docname 'index' を指す
    assert index["term-foo"] == "index"


@pytest.mark.sphinx("html", testroot="min")
def test_extract_definitionsの戻り値に別名の両term_idが含まれる(app):
    """別名（フー/foo）の term-id 'term-0' と 'term-foo' が両方ともキーとして含まれる。"""
    # Arrange: testroot='min' をビルドし解決済み doctree を取得する
    app.build()
    doctree = HomeDoctreeCache(app.env, app.builder).get("index")

    # Act: 解決済み doctree から term-id → definition を抽出する
    result = extract_definitions(doctree)

    # Assert: 別名の両 term-id がキーとして存在する
    assert "term-0" in result
    assert "term-foo" in result


@pytest.mark.sphinx("html", testroot="min")
def test_別名の両term_idの定義本文が等しく共有される(app):
    """別名 term-0 と term-foo の定義本文(.astext())が等しく 'フーの定義本体。' である。"""
    app.build()
    result = extract_definitions(HomeDoctreeCache(app.env, app.builder).get("index"))

    assert result["term-0"].astext() == "フーの定義本体。"
    assert result["term-foo"].astext() == result["term-0"].astext()


@pytest.mark.sphinx("html", testroot="min")
def test_別名のdefinitionは独立した別オブジェクトである(app):
    """別名ごとに deepcopy された別オブジェクトが返り、一方の改変が他方に波及しない。"""
    app.build()
    result = extract_definitions(HomeDoctreeCache(app.env, app.builder).get("index"))

    assert result["term-0"] is not result["term-foo"]
    result["term-0"].append(nodes.paragraph(text="追記"))
    assert "追記" not in result["term-foo"].astext()


@pytest.mark.sphinx("html", testroot="min")
def test_単一用語の定義本文が正しい(app):
    """単一 term の用語 term-1 の本文が 'バーの定義本体。' である。"""
    app.build()
    result = extract_definitions(HomeDoctreeCache(app.env, app.builder).get("index"))

    assert result["term-1"].astext() == "バーの定義本体。"


@pytest.mark.sphinx("html", testroot="min")
def test_抽出結果の改変が元doctreeに波及しない(app):
    """戻り値の definition を書き換えても元 doctree 内の definition は変化しない（副作用なし）。"""
    app.build()
    doctree = HomeDoctreeCache(app.env, app.builder).get("index")
    result = extract_definitions(doctree)

    result["term-1"].append(nodes.paragraph(text="副作用テスト"))

    # 元 doctree から再抽出しても追記は反映されていない
    again = extract_definitions(doctree)
    assert "副作用テスト" not in again["term-1"].astext()


def test_glossaryが無いツリーでは空dictを返す():
    """glossary を含まないノードツリーでは extract_definitions が空 dict を返す。"""
    tree = nodes.section()
    tree += nodes.paragraph(text="本文のみ")

    assert extract_definitions(tree) == {}


def test_build_term_entry_index_by_nameは用語名小文字からhomeとterm_idの組を引く():
    """objects の ('term', name) エントリから name.lower() → (docname, labelid) の
    索引を構築し、term 以外の objtype は除外する。"""
    # Arrange: term 2 件と term 以外 1 件を持つ擬似 StandardDomain
    std = SimpleNamespace(
        objects={
            ("term", "Alpha"): ("glossary", "term-alpha"),
            ("term", "delta"): ("glossary2", "term-delta"),
            ("label", "intro"): ("index", "intro-anchor"),
        }
    )

    # Act
    index = build_term_entry_index_by_name(std)

    # Assert: 小文字キーで (home, term-id) が引け、term 以外は含まれない
    assert index == {
        "alpha": ("glossary", "term-alpha"),
        "delta": ("glossary2", "term-delta"),
    }
