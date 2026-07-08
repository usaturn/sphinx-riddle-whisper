"""アセット（riddle.js / riddle.css）の登録と static 同梱を検証するテスト。"""

from pathlib import Path

import pytest
from bs4 import BeautifulSoup


@pytest.mark.sphinx("html", testroot="min", warningiserror=True)
def test_html_build後にriddleのjsとcssが_staticへコピーされる(app):
    """html builder で build 後、_static に riddle.js / riddle-init.js / riddle.css が揃う。

    riddle.js は riddle-init.js からの import 経由で評価されるため、script タグでは
    参照されないが、static_dir を html_static_path へ追加した結果 _static へコピーされる。
    """
    # Arrange: app fixture が tests/roots/test-min を testroot='min' として配線している前提

    # Act: HTML ビルドを実行する
    app.build()

    # Assert: riddle.js / riddle-init.js / riddle.css が _static にコピーされている
    static_dir = Path(app.outdir) / "_static"
    assert (static_dir / "riddle.js").exists()
    assert (static_dir / "riddle-init.js").exists()
    assert (static_dir / "riddle.css").exists()


@pytest.mark.sphinx("html", testroot="min", warningiserror=True)
def test_html_build後にriddle_initがtype_moduleのscriptとして読み込まれる(app):
    """html builder で build 後、index.html の riddle-init.js を参照する script タグに
    type="module" が付く（riddle.js は ESM のためモジュールとして読み込む）。"""
    # Arrange: app fixture が tests/roots/test-min を testroot='min' として配線している前提

    # Act: HTML ビルドを実行し index.html を読む
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    # Assert: riddle-init.js を参照する <script ...> タグはすべて type="module" を持つ
    init_script_tags = [
        script
        for script in soup.find_all("script")
        if "riddle-init.js" in (script.get("src") or "")
    ]
    assert init_script_tags, (
        "riddle-init.js を参照する script タグが index.html に存在しない"
    )
    assert all(script.get("type") == "module" for script in init_script_tags), (
        f'riddle-init.js の script タグに type="module" が無い: {init_script_tags}'
    )


@pytest.mark.sphinx("html", testroot="min", warningiserror=True)
def test_html内でriddle_initとcssが参照される(app):
    """index.html 内で riddle-init.js（ESM エントリ）と riddle.css の両方が参照されている。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert "riddle-init.js" in html
    assert "riddle.css" in html


@pytest.mark.sphinx("text", testroot="min", warningiserror=True)
def test_非HTML_builderでもビルドが例外なく完走する(app):
    """text（非 HTML）builder では format ガードでアセット登録がスキップされ、ビルドが成功する。"""
    # 例外が出なければ成功（HTML format ガードの有効性）
    app.build()
