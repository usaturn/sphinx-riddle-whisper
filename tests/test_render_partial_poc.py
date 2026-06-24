"""render_partial の脚注/numref 描画挙動を pin する characterization test（spike/PoC）。

このモジュールは tests/roots/test-context（脚注[内部/外部]・numref・figure を含む
glossary を持つ）をビルドし、HomeDoctreeCache(app.env, app.builder).get('index') で
解決済み doctree を取得、extract_definitions(doctree) の各 definition に
app.builder.render_partial(definition)['fragment'] を適用したときの**現状の実挙動**を
固定する。

重要な結論（採用分岐の記録）:
    採用分岐 = (a) doctree 方式を維持。理由: get_and_resolve_doctree が
    render_partial の前に番号（numref/脚注）を焼き込むため、番号のサイレント破壊は
    起きない。自己完結脚注は局所再採番されるが内部整合する。外部参照は焼き込み番号＋
    home へのリンク（後で再ベース）で許容。よって #8 を 8a/8b に分割する必要はない
    （分割は (c) 採用時のみ）。脚注/numref 方針: home 解決時の焼き込み番号をそのまま
    用い、リンク href のみ #10/#11 で再ベースする。
"""

import pytest

from sphinx_riddle_whisper.collect import HomeDoctreeCache, extract_definitions

# 外部脚注（ページ本文側で定義され、定義外から参照される）の本体テキスト。
EXTERNAL_FOOTNOTE_BODY = "ページ本文側の共有脚注本体。"
# 外部脚注用語の定義本文に必ず現れる識別テキスト（term-id 名に依存しない選別用）。
EXTERNAL_TERM_MARKER = "ページ本文側で定義された脚注"

# 内部脚注（定義内で .. [#inner] として定義される自己完結脚注）の本体テキスト。
INTERNAL_FOOTNOTE_BODY = "定義内の脚注本体。"
# 内部脚注用語の定義本文に必ず現れる識別テキスト（term-id 名に依存しない選別用）。
INTERNAL_TERM_MARKER = "定義内で定義した脚注"

# numref が解決時に焼き込む figure 番号テキスト（既定の 'Fig. %s' 書式）。
NUMREF_BAKED_NUMBER = "Fig. 1"
# numref 用語の定義本文に必ず現れる識別テキスト（term-id 名に依存しない選別用）。
NUMREF_TERM_MARKER = "図を"


def _render_fragments(app):
    """解決済み doctree の各 definition を render_partial し term_id -> fragment を返す。"""
    doctree = HomeDoctreeCache(app.env, app.builder).get("index")
    definitions = extract_definitions(doctree)
    return {
        term_id: app.builder.render_partial(definition)["fragment"]
        for term_id, definition in definitions.items()
    }


@pytest.mark.sphinx("html", testroot="context", warningiserror=True)
def test_外部脚注用語のfragmentに外部脚注本体は含まれない(app):
    """外部脚注（定義外＝ページ本文側で定義）を参照する用語の fragment には、
    その脚注本体テキストが含まれない（本体はページ側に残る挙動を characterization で固定）。"""
    # Arrange: testroot='context' をビルドし、各 definition の fragment を得る
    app.build()
    fragments = _render_fragments(app)

    # Act: 外部脚注用語の definition の fragment を、識別テキストで選別して取り出す
    external_fragments = [
        fragment
        for fragment in fragments.values()
        if EXTERNAL_TERM_MARKER in fragment
    ]
    assert len(external_fragments) == 1, "外部脚注用語の fragment が一意に選別できること"
    external_fragment = external_fragments[0]

    # Assert: 外部脚注の本体テキストは fragment に含まれない（本体はページ側に残る）
    assert EXTERNAL_FOOTNOTE_BODY not in external_fragment


@pytest.mark.sphinx("html", testroot="context", warningiserror=True)
def test_内部脚注用語のfragmentに自己完結脚注本体が含まれる(app):
    """内部脚注（定義内で .. [#inner] として定義された自己完結脚注）を持つ用語の
    fragment には、その脚注本体テキストが含まれる（脚注本体が定義と一緒に旅する挙動を
    characterization で固定）。"""
    # Arrange: testroot='context' をビルドし、各 definition の fragment を得る
    app.build()
    fragments = _render_fragments(app)

    # Act: 内部脚注用語の definition の fragment を、識別テキストで選別して取り出す
    internal_fragments = [
        fragment
        for fragment in fragments.values()
        if INTERNAL_TERM_MARKER in fragment
    ]
    assert len(internal_fragments) == 1, "内部脚注用語の fragment が一意に選別できること"
    internal_fragment = internal_fragments[0]

    # Assert: 自己完結脚注の本体テキストが fragment に含まれる（定義と一緒に旅する）
    assert INTERNAL_FOOTNOTE_BODY in internal_fragment


@pytest.mark.sphinx("html", testroot="context", warningiserror=True)
def test_numref用語のfragmentに焼き込み番号が含まれる(app):
    """numref を含む用語の fragment には解決時に焼き込まれた番号 'Fig. 1' が含まれ、
    番号がサイレントに壊れない（採用分岐 (a) を支える挙動を characterization で固定）。"""
    # Arrange: testroot='context' をビルドし、各 definition の fragment を得る
    app.build()
    fragments = _render_fragments(app)

    # Act: numref 用語の definition の fragment を、識別テキストで選別して取り出す
    numref_fragments = [
        fragment for fragment in fragments.values() if NUMREF_TERM_MARKER in fragment
    ]
    assert len(numref_fragments) == 1, "numref 用語の fragment が一意に選別できること"
    numref_fragment = numref_fragments[0]

    # Assert: 解決時に焼き込まれた figure 番号が保持されている
    assert NUMREF_BAKED_NUMBER in numref_fragment
