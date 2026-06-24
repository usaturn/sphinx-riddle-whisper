"""実ビルドで :target: 付き image が a.image-reference[href] を生成することの guard テスト。"""

from pathlib import Path

import pytest
from bs4 import BeautifulSoup


@pytest.mark.sphinx("html", testroot="image-popup", warningiserror=True)
def test_target付きimageがimage_referenceアンカーを生成する(app):
    """:target: 付き image の出力が <a class="… image-reference" href="…"> を持つ。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.select("a.image-reference[href]")
    assert anchors, "image-reference クラスを持つアンカーが出力されていない"
    assert any(
        a.get("href") == "https://example.com/full.png" and a.find("img") is not None
        for a in anchors
    ), "img を内包する :target: 画像（image）アンカーが見つからない"


@pytest.mark.sphinx("html", testroot="image-popup", warningiserror=True)
def test_target付きfigureがimage_referenceアンカーを生成する(app):
    """:target: 付き figure の出力も <a class="… image-reference" href="…"><img> を持つ
    （JS の IMAGE_TRIGGER_SELECTOR が figure 由来アンカーにも発火する前提を固定）。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.select("a.image-reference[href]")
    assert any(
        a.get("href") == "https://example.com/fig.png" and a.find("img") is not None
        for a in anchors
    ), "img を内包する :target: 画像（figure）アンカーが見つからない"
