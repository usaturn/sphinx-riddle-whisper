"""敵対 fixture（raw html XSS）による build 側 XSS 検証テスト（#14・hardening）。

このモジュールは検証専用（characterization）であり、src/ の挙動は変更しない。
testroot='xss'（tests/roots/test-xss）を用い、glossary 用語「わな」の定義に
仕込んだ XSS ペイロードが build 後の index.html でどう扱われるかを固定する。
"""

import re
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

#: 一次防御で除去されるべき危険要素/属性を表す CSS セレクタ。
_DANGEROUS_SELECTOR = (
    "[onerror], [onload], [onclick], script, iframe, base, object, embed, "
    'a[href^="javascript:"], a[href^="data:"], img[src^="javascript:"]'
)


def _extract_template(html: str):
    """index.html から riddle-tip-- プレフィックスの <template> 要素を DOM で抜き出す。

    正規表現ではなく BeautifulSoup でパースし、id プレフィックスで一意に選別する。
    複数注入や ``</template>`` 様文字列の混入に対しても誤抽出しない。
    """
    soup = BeautifulSoup(html, "html.parser")
    template = soup.find("template", id=re.compile(r"^riddle-tip--"))
    assert template is not None, "riddle-tip-- の template が index.html に見つからない"
    return template


@pytest.mark.sphinx("html", testroot="xss", warningiserror=True)
def test_敵対fixtureでapp_buildが例外なく完走しindex_htmlが生成される(app):
    """raw html XSS 入りの敵対 fixture でも app.build() が例外なく完走し index.html が生成される。"""
    # Arrange: app fixture が tests/roots/test-xss を testroot='xss' として配線している前提

    # Act: ビルドを実行する（例外が出れば失敗）
    app.build()

    # Assert: 出力に index.html が生成されている（以降の検証の前提となるパイプライン健全性）
    index_html = Path(app.outdir) / "index.html"
    assert index_html.exists()


@pytest.mark.sphinx("html", testroot="xss", warningiserror=True)
def test_既定sanitizeの出力にriddle_tipのtemplateが実在する(app):
    """既定 sanitize=True の出力 index.html に 'riddle-tip--' を含む template が実在する。

    抽出ヘルパ（_extract_template）の前提であり、term 注入が起きていることを保証する境界ケース。
    """
    # Arrange: app fixture が tests/roots/test-xss を testroot='xss'（既定 sanitize=True）で配線

    # Act: ビルドして index.html を読み込む
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: riddle-tip-- プレフィックスの template が出力に存在する
    assert "riddle-tip--" in html


@pytest.mark.sphinx("html", testroot="xss", warningiserror=True)
def test_既定sanitizeで危険要素が全て除去され良性は残る(app):
    """riddle_sanitize=True（既定）で template 内に危険要素 0 件・良性テキスト保持。"""
    app.build()
    template = _extract_template(
        (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    )

    dangerous = template.select(_DANGEROUS_SELECTOR)
    assert dangerous == [], f"危険要素が一次防御で除去されていない: {dangerous}"
    assert "正常な定義テキスト" in template.get_text()


@pytest.mark.sphinx(
    "html",
    testroot="xss",
    warningiserror=True,
    confoverrides={"riddle_sanitize": False},
)
def test_sanitize_offでは危険要素が残る(app):
    """riddle_sanitize=False で一次防御 OFF となり危険要素が template に残る（明示）。

    一次防御 OFF の明示（二次防御 #17/#24 とペア）。
    """
    app.build()
    template = _extract_template(
        (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    )

    assert template.select(_DANGEROUS_SELECTOR), (
        "sanitize=False なのに危険要素が残っていない"
    )
    assert "正常な定義テキスト" in template.get_text()


@pytest.mark.sphinx(
    "html",
    testroot="xss",
    warningiserror=True,
    confoverrides={"riddle_sanitize": False},
)
def test_sanitize_offでrenderedが無変換で素通しされtemplateへ流れる(app):
    """riddle_sanitize=False（明示オプトアウト）時、rendered が無変換のまま
    <template> へ流れることを実ビルドで固定する。

    一次防御 OFF は利用者の意図的な選択であり、その分岐では sanitize による
    一切の変換（要素除去・属性除去・link_rel 付与・危険スキーム剥がし）が
    起きず、レンダ結果がバイト等価で素通しされるのが正しい。既定 True との
    分岐（True では下記の生ペイロード文字列が消える）を回帰ガードする。
    """
    # Arrange: app fixture が tests/roots/test-xss を testroot='xss' で配線し、
    # confoverrides で riddle_sanitize=False（明示オプトアウト）を与えている。

    # Act: ビルドして注入された template を抜き出し、その内側 HTML を得る。
    app.build()
    template = _extract_template(
        (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    )
    inner_html = template.decode_contents()

    # Assert: render 結果が無変換で素通しされている＝生ペイロードが
    # 各属性・要素ともそのままの文字列で template 内に残っている。
    # sanitize が一切作用していない（変換ゼロ）ことを表す。
    assert 'onerror="window.__pwned1=1"' in inner_html
    assert 'href="javascript:alert(1)"' in inner_html
    assert "<script>window.__pwned2=1</script>" in inner_html
