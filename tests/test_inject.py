"""inject.py の参照 term-id DISTINCT 抽出ロジックを検証するテスト。"""

import pytest
from docutils import nodes

from sphinx_riddle_whisper.inject import extract_referenced_term_ids


def _ref(*, refuri=None, refid=None):
    """refuri / refid を任意指定した reference ノードを作る。"""
    ref = nodes.reference()
    if refuri is not None:
        ref["refuri"] = refuri
    if refid is not None:
        ref["refid"] = refid
    return ref


def _para_with_references(*refs):
    """与えた reference ノード群を含む paragraph を作る。"""
    para = nodes.paragraph()
    for ref in refs:
        para += ref
    return para


@pytest.mark.sphinx("html", testroot="min")
def test_実ビルドの解決済みdoctreeから同一ページ参照のrefid由来term_idが抽出される(app):
    """testroot='min' をビルドして得た解決済み doctree を渡すと、
    同一ページ :term: 参照の refid 由来で 'term-0' 'term-1' 'term-richterm' が
    戻り値に含まれる。"""
    # Arrange: testroot='min' をビルドし、index ページの解決済み doctree を得る
    app.build()
    doctree = app.env.get_and_resolve_doctree(
        "index", app.builder, tags=app.builder.tags
    )

    # Act: 解決済み doctree から参照 term-id を抽出する
    term_ids = extract_referenced_term_ids(doctree)

    # Assert: 同一ページ参照（refid 由来）の 3 つの term-id がすべて含まれる
    assert "term-0" in term_ids
    assert "term-1" in term_ids
    assert "term-richterm" in term_ids


def test_クロスページ参照のrefuriフラグメントからterm_idが抽出される():
    """refuri のフラグメント '#term-foo' から 'term-foo' が抽出される。"""
    doctree = _para_with_references(_ref(refuri="glossary.html#term-foo"))

    assert extract_referenced_term_ids(doctree) == ["term-foo"]


def test_同一term_idへの複数参照は重複排除される():
    """同じ term-id を指す参照が複数あっても戻り値には1回だけ現れる。"""
    doctree = _para_with_references(_ref(refid="term-x"), _ref(refid="term-x"))

    assert extract_referenced_term_ids(doctree) == ["term-x"]


def test_refuriとrefidの混在から両方のterm_idが集まる():
    """refuri 由来と refid 由来の term-id が DISTINCT に両方集まる。"""
    doctree = _para_with_references(
        _ref(refuri="g.html#term-a"), _ref(refid="term-b")
    )

    assert set(extract_referenced_term_ids(doctree)) == {"term-a", "term-b"}


def test_term接頭辞でないアンカーは無視される():
    """'term-' で始まらない refid / refuri フラグメントは抽出されない。"""
    doctree = _para_with_references(
        _ref(refid="sec-1"), _ref(refuri="page.html#section")
    )

    assert extract_referenced_term_ids(doctree) == []


def test_refuriもrefidも無い参照はスキップされる():
    """refuri / refid のいずれも持たない reference があっても例外を出さずスキップする。"""
    doctree = _para_with_references(_ref(), _ref(refid="term-z"))

    assert extract_referenced_term_ids(doctree) == ["term-z"]


def test_出現順が保持される():
    """DISTINCT かつ最初の出現順で term-id が並ぶ。"""
    doctree = _para_with_references(
        _ref(refid="term-b"), _ref(refid="term-a"), _ref(refid="term-b")
    )

    assert extract_referenced_term_ids(doctree) == ["term-b", "term-a"]
