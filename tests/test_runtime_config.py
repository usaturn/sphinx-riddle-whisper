"""ランタイム設定配信（#riddle-config JSON 注入・module 読込）の検証テスト。

installRiddlePopover を発動させる配線として、(1) conf の riddle_* を camelCase JSON 化して
``<script type="application/json" id="riddle-config">`` を各ページへ注入すること、
(2) ESM を ``<script type="module" src="..._static/riddle-init.js">`` として読み込むことを固定する。
"""

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from sphinx_riddle_whisper.runtime_config import (
    build_runtime_config,
    encode_config_json,
)


def _extract_riddle_config_json(html: str) -> dict:
    """出力 HTML から #riddle-config の JSON を取り出して parse する。"""
    match = re.search(
        r'<script type="application/json" id="riddle-config">(.*?)</script>',
        html,
        re.DOTALL,
    )
    assert match, "出力 HTML に #riddle-config の JSON 設定要素が無い"
    return json.loads(match.group(1))


def test_build_runtime_configはconf値をcamelCaseのdictへ変換する():
    """[unit] build_runtime_config が riddle_* 設定を JS 向け camelCase dict へ変換する。"""
    config = SimpleNamespace(
        riddle_trigger="click",
        riddle_open_delay_ms=42,
        riddle_close_delay_ms=7,
        riddle_interactive=False,
        riddle_max_height="9rem",
        riddle_max_width="18rem",
        riddle_footnotes=False,
        riddle_image_popup=True,
    )

    payload = build_runtime_config(config)

    assert payload == {
        "trigger": "click",
        "openDelayMs": 42,
        "closeDelayMs": 7,
        "interactive": False,
        "maxHeight": "9rem",
        "maxWidth": "18rem",
        "footnotes": False,
        "imagePopup": True,
    }


def test_build_runtime_configはfootnotesにTrueも正しく伝播する():
    """[unit/境界] riddle_footnotes=True のとき footnotes も True を伝播する。

    False 以外の bool 値でもキー名 footnotes と値が正しく対応することを固定する。
    """
    config = SimpleNamespace(
        riddle_trigger="click",
        riddle_open_delay_ms=42,
        riddle_close_delay_ms=7,
        riddle_interactive=False,
        riddle_max_height="9rem",
        riddle_max_width="18rem",
        riddle_footnotes=True,
        riddle_image_popup=True,
    )

    payload = build_runtime_config(config)

    assert payload["footnotes"] is True


def test_build_runtime_configはimage_popupをimagePopupへ伝播する():
    """[unit] build_runtime_config が riddle_image_popup を camelCase キー imagePopup へ伝播する。"""
    config = SimpleNamespace(
        riddle_trigger="both",
        riddle_open_delay_ms=150,
        riddle_close_delay_ms=100,
        riddle_interactive=True,
        riddle_max_height="24rem",
        riddle_max_width="32rem",
        riddle_footnotes=True,
        riddle_image_popup=False,
    )

    payload = build_runtime_config(config)

    assert payload["imagePopup"] is False


def test_encode_config_jsonはスクリプト閉じタグのブレイクアウトを封じる():
    """[unit/セキュリティ] encode_config_json が '<' を \\u003c へエスケープし、
    生の '</script' が出力に現れない（JSON.parse では復号され読める）。"""
    encoded = encode_config_json({"maxHeight": "1</script>rem"})

    assert "</script" not in encoded, (
        f"エスケープ後に生の </script が残っている: {encoded!r}"
    )
    assert "\\u003c" in encoded, "'<' が \\u003c へエスケープされていない"
    # エスケープ後も JSON として妥当で、復号すると元の値に戻る。
    assert json.loads(encoded)["maxHeight"] == "1</script>rem"


def test_encode_config_jsonは任意キーの値でも生の閉じタグとU2028を出力しない():
    """[unit/セキュリティ/r1-4] encode_config_json は payload 全体をエスケープするため、
    riddle_footnotes 固有ではなく任意のキーに危険文字列が混入しても安全に符号化する。

    注入経路の一般防御の回帰防止として、riddle_* 由来でない任意のキーの値に
    ``</script>`` 部分文字列と生の U+2028（行区切り）が同時に含まれても、出力に
    生の ``</script`` も生の U+2028 も現れず、かつ JSON.parse 相当で元の値へ復号できる
    （payload 全体エスケープが効いている）ことを固定する。
    """
    # Arrange: riddle_* 以外の任意キーに </script> と生 U+2028 を同時に含む値を仕込む
    line_separator = chr(0x2028)
    raw_value = "a</script>b" + line_separator + "c"

    # Act: payload 全体を符号化する
    encoded = encode_config_json({"arbitraryInjectedKey": raw_value})

    # Assert: 生の </script も生の U+2028 も出力に現れない
    assert "</script" not in encoded, (
        f"任意キーの値の生 </script が出力に残っている: {encoded!r}"
    )
    assert line_separator not in encoded, (
        f"任意キーの値の生 U+2028 が出力に残っている: {encoded!r}"
    )
    # 復号すると元の値（</script> と U+2028 を含む）へ戻る。
    assert json.loads(encoded)["arbitraryInjectedKey"] == raw_value


@pytest.mark.parametrize(
    ("footnotes", "expected_literal"),
    [(True, "true"), (False, "false")],
)
def test_encode_config_jsonはfootnotesのboolをJSONリテラルへ符号化する(
    footnotes, expected_literal
):
    """[unit/境界/r1-8] encode_config_json が footnotes(bool) を含む payload を
    符号化したとき、値が Python の True/False ではなく JSON リテラル true/false
    として出力されることを固定する（bool の JSON 表現の固定）。"""
    # Arrange & Act: footnotes に bool を持つ payload を符号化する。
    encoded = encode_config_json({"footnotes": footnotes})

    # Assert: 出力に JSON の小文字リテラル true/false が現れ、
    # Python 表現の "True"/"False" は現れない。
    assert f'"footnotes": {expected_literal}' in encoded, (
        f"footnotes が JSON リテラル {expected_literal} で符号化されていない: {encoded!r}"
    )
    assert "True" not in encoded and "False" not in encoded, (
        f"Python の bool 表現が出力に混入している: {encoded!r}"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    warningiserror=True,
    confoverrides={
        "riddle_trigger": "click",
        "riddle_open_delay_ms": 42,
        "riddle_max_height": "7rem",
    },
)
def test_実ビルドでriddle_config要素がconf上書き値を反映して注入される(app):
    """[integration] 実ビルドで index.html に #riddle-config が注入され、
    conf の上書き値（trigger/open_delay/max_height）が JSON に反映される。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    payload = _extract_riddle_config_json(html)
    assert payload["trigger"] == "click"
    assert payload["openDelayMs"] == 42
    assert payload["maxHeight"] == "7rem"
    # 未指定の設定は既定値で入る。
    assert payload["closeDelayMs"] == 100
    assert payload["interactive"] is True
    assert payload["maxWidth"] == "32rem"


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    warningiserror=True,
    confoverrides={"riddle_footnotes": False},
)
def test_実ビルドでriddle_config要素のfootnotesがconf上書き値Falseを反映する(app):
    """[integration/t6] 実ビルドで index.html に注入される #riddle-config の JSON に
    footnotes キーが含まれ、conf 上書き値（riddle_footnotes=False）が反映される。

    conf の riddle_footnotes を False に上書きしてビルドしたとき、各ページへ配信される
    #riddle-config JSON の footnotes が False になることを end-to-end で固定する
    （config.py の登録 → build_runtime_config の伝播 → inject_runtime_config の注入の
    一連の配信経路が実ビルドで繋がっていることの確証）。
    """
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    payload = _extract_riddle_config_json(html)
    assert payload["footnotes"] is False, (
        "実ビルドの #riddle-config JSON に conf 上書き値 footnotes=False が反映されていない"
        f"（実際の payload={payload!r}）"
    )


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_実ビルドでriddle_config要素のfootnotesが未指定時は既定Trueになる(app):
    """[integration/t6] conf で riddle_footnotes を未指定のままビルドしたとき、
    実ビルドの #riddle-config JSON の footnotes に既定値 True が入る。

    上書きしない既定ビルドでも footnotes キーが欠落せず、既定 True が end-to-end で
    配信されることを固定する（既定値の配信経路の確証）。
    """
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    payload = _extract_riddle_config_json(html)
    assert payload["footnotes"] is True, (
        "実ビルドの #riddle-config JSON に未指定時の既定 footnotes=True が入っていない"
        f"（実際の payload={payload!r}）"
    )


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_実ビルドでindex以外の複数ページにもfootnotesキー付きriddle_configが一貫注入される(
    app,
):
    """[r1-3/境界] 実ビルドで index.html 以外の複数ページにも footnotes キーを含む
    #riddle-config が一貫して注入される（全ページ配信の網羅確認）。

    既存の integration テストは index.html 単独しか見ていない。inject_runtime_config は
    html-page-context で全 document ページへ配信されるはずだが、index.html だけでなく
    異なる階層の複数ページ（subdir/other, rootref, topic）すべてに footnotes キー付きの
    #riddle-config が欠落なく注入されることを境界として固定する。

    既定ビルドのため footnotes は既定 True。各ページの payload を == 比較で集約し、
    全ページが index.html と同一の footnotes 値を持つ（ページ差で値が揺れない）ことを
    検証する。
    """
    # Arrange: testroot='pages' を既定 conf で実ビルドする
    app.build()
    outdir = Path(app.outdir)

    # 異なる階層の document ページ群（index 以外を複数含む）
    pages = {
        "index": outdir / "index.html",
        "subdir/other": outdir / "subdir" / "other.html",
        "rootref": outdir / "rootref.html",
        "topic": outdir / "topic.html",
    }

    # Act: 各ページの #riddle-config JSON を取り出す
    payloads = {
        name: _extract_riddle_config_json(path.read_text(encoding="utf-8"))
        for name, path in pages.items()
    }

    # Assert: index 以外の各ページにも footnotes キーが存在し既定 True で一貫している
    for name, payload in payloads.items():
        assert "footnotes" in payload, (
            f"ページ {name} の #riddle-config JSON に footnotes キーが欠落している"
            f"（実際の payload={payload!r}）"
        )
        assert payload["footnotes"] is True, (
            f"ページ {name} の #riddle-config JSON の footnotes が既定 True でない"
            f"（実際の payload={payload!r}）"
        )


def test_build_runtime_configはriddle_footnotesの非bool値を加工せず素通しする():
    """[unit/異常] riddle_footnotes に bool 以外（文字列 "false"）が来ても
    build_runtime_config は専用バリデータを持たない多層防御方針のもと加工も拒否もせず、
    その生の値を footnotes へそのまま伝播する。

    正規化（"false" → False）は JS 側の責務であり、Python 側は値を素通しすることを固定する。
    値の同一性（同じオブジェクトを素通し）を ``is`` で検証する。
    """
    # Arrange: footnotes に異常値（文字列 "false"）を持つ conf 互換オブジェクトを用意する
    sentinel = "false"
    config = SimpleNamespace(
        riddle_trigger="click",
        riddle_open_delay_ms=42,
        riddle_close_delay_ms=7,
        riddle_interactive=False,
        riddle_max_height="9rem",
        riddle_max_width="18rem",
        riddle_footnotes=sentinel,
        riddle_image_popup=True,
    )

    # Act: ランタイム設定 dict へ変換する
    payload = build_runtime_config(config)

    # Assert: 非 bool 値が拒否も加工もされず、同一オブジェクトのまま footnotes へ伝播する
    assert payload["footnotes"] is sentinel, (
        "非 bool の riddle_footnotes='false' が素通しされず加工・欠落している"
        f"（実際の payload={payload!r}）"
    )


def test_注入経路はriddle_footnotesの非bool危険値でもクラッシュせずfail_closedで符号化する():
    """[unit/異常/r1-5] riddle_footnotes に非 bool の危険値（``</script>`` を含む文字列）が
    来ても、注入経路（build_runtime_config → encode_config_json）はクラッシュせず、
    JSON として妥当でマークアップ注入に繋がらない出力を返す（fail-closed）。

    Python 側は値の正規化を担わず素通しするが（多層防御は JS 側）、注入時の符号化は
    payload 全体をエスケープするため、footnotes へ ``</script>`` を仕込んでも生の
    ``</script`` は出力に現れず、JSON.parse 相当で元の値へ復号できることを固定する。
    """
    # Arrange: footnotes にマークアップ注入を狙う非 bool 危険値を仕込んだ conf 互換を用意する
    malicious = "true</script><script>alert(1)</script>"
    config = SimpleNamespace(
        riddle_trigger="click",
        riddle_open_delay_ms=42,
        riddle_close_delay_ms=7,
        riddle_interactive=False,
        riddle_max_height="9rem",
        riddle_max_width="18rem",
        riddle_footnotes=malicious,
        riddle_image_popup=True,
    )

    # Act: 注入経路（dict 変換 → JSON 符号化）を通す
    encoded = encode_config_json(build_runtime_config(config))

    # Assert: 生の </script が出力に現れず、JSON として妥当で元の値へ復号できる
    assert "</script" not in encoded, (
        f"非 bool の footnotes 危険値の生 </script が出力に残っている: {encoded!r}"
    )
    assert json.loads(encoded)["footnotes"] == malicious, (
        "fail-closed 符号化後に footnotes 値が JSON として復号できない"
        f"（encoded={encoded!r}）"
    )


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_実ビルドでriddle_config要素のimagePopupが未指定時は既定Trueになる(app):
    """[integration] conf 未指定でビルドした #riddle-config JSON の imagePopup が既定 True。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    payload = _extract_riddle_config_json(html)
    assert payload["imagePopup"] is True, (
        f"未指定時の既定 imagePopup=True が入っていない（payload={payload!r}）"
    )


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_実ビルドでriddle_initがtype_moduleのscriptとして読み込まれる(app):
    """[integration] 実ビルドで riddle-init.js が type="module" の script として参照される。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    script_tags = re.findall(r"<script\b[^>]*>", html)
    init_tags = [tag for tag in script_tags if "riddle-init.js" in tag]
    assert init_tags, "riddle-init.js を参照する script タグが index.html に無い"
    assert all('type="module"' in tag for tag in init_tags), (
        f"riddle-init.js の script タグに type=\"module\" が付いていない: {init_tags}"
    )
