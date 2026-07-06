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
