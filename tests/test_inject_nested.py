"""深さ2（ネスト）template 注入の検証テスト。

testroot='nested' の参照構造:

- index 本文 → alpha（レベル1）
- alpha の定義 → beta / delta（レベル2。delta は別 home の glossary2）
- beta の定義 → gamma（index から見て深さ3 → 注入されない）
"""

from pathlib import Path

import pytest


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_定義内から参照されるtermの定義もページへ注入される(app):
    """index は alpha だけを参照するが、alpha の定義内参照（beta）の template も
    index.html へ注入される（深さ2の推移的収集）。"""
    # Arrange & Act: testroot='nested' を実ビルドする
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: レベル1（alpha）とレベル2（beta）の両 template がある
    assert '<template id="riddle-tip--term-alpha">' in html
    assert '<template id="riddle-tip--term-beta">' in html


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_別homeの定義内参照termも注入される(app):
    """alpha の定義が参照する delta は別 home（glossary2）だが、
    その template も index.html へ注入される。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert '<template id="riddle-tip--term-delta">' in html


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_深さ3のterm定義は注入されない(app):
    """beta の定義だけが参照する gamma（深さ3）の template は
    index.html へ注入されない（固定2段）。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert "riddle-tip--term-gamma" not in html


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_本文と定義内の両方から参照されるtermのtemplateは1回だけ注入される(app):
    """both は alpha（定義内に beta 参照）と beta の両方を本文参照するが、
    beta の template は both.html にちょうど1回だけ出る（dedup）。"""
    app.build()
    html = (Path(app.outdir) / "both.html").read_text(encoding="utf-8")

    assert html.count('id="riddle-tip--term-beta"') == 1


@pytest.mark.sphinx(
    "html",
    testroot="nested",
    warningiserror=True,
    confoverrides={"riddle_nested": False},
)
def test_riddle_nested無効時はレベル2のtemplateが注入されない(app):
    """riddle_nested=False では現行（レベル1のみ）と同じ注入になる。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert '<template id="riddle-tip--term-alpha">' in html
    assert "riddle-tip--term-beta" not in html
    assert "riddle-tip--term-delta" not in html


# 依存テスト2件は srcdir を分離する（他テストと _build/doctrees の env pickle を
# 共有すると、riddle_nested の rebuild 条件が 'html'（再読み込みなし）のため
# env.dependencies が前テストのビルドから残存し、glossary の残存依存
# （glossary2.rst）が伝播行で both へ混入して検証にならない）。
@pytest.mark.sphinx(
    "html", testroot="nested", srcdir="nested-deps", warningiserror=True
)
def test_定義内参照の別home依存が記録される(app):
    """both が参照する alpha の定義は delta（home=glossary2）を参照するため、
    glossary2 のソースも both の依存として記録される（増分ビルドで glossary2
    だけ変更しても both が再書き出しされる）。

    対象ページには index でなく both を使う。record_page_home_dependencies は
    env.all_docs を docname 昇順（both → glossary → glossary2 → index）で処理し、
    home 自身の既存依存を参照ページへ伝播する既存仕様（v1.0.0 由来）がある。
    glossary.rst 自身の本文が :term:`delta` を含むため glossary → glossary2 の
    レベル1依存が riddle_nested と無関係に記録され、glossary より後に処理される
    index にはその伝播だけで glossary2 が混入してしまい新ロジックの検証にならない。
    glossary より先に処理される both なら伝播は空で、レベル2の新ロジックだけが
    glossary2 を依存へ加える。"""
    app.build()

    deps = {str(d) for d in app.env.dependencies.get("both", set())}

    assert str(app.env.doc2path("glossary2")) in deps


@pytest.mark.sphinx(
    "html",
    testroot="nested",
    srcdir="nested-deps-disabled",
    warningiserror=True,
    confoverrides={"riddle_nested": False},
)
def test_riddle_nested無効時は定義内参照の依存が記録されない(app):
    """riddle_nested=False では推移依存を記録しない（現行と同じ依存集合）。
    対象ページに both を使う理由は test_定義内参照の別home依存が記録される と同じ。"""
    app.build()

    deps = {str(d) for d in app.env.dependencies.get("both", set())}

    assert str(app.env.doc2path("glossary")) in deps  # レベル1依存は従来どおり
    assert str(app.env.doc2path("glossary2")) not in deps
