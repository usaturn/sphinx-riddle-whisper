"""ランタイム設定の配信（#riddle-config JSON 注入）。

conf.py の ``riddle_*`` 設定を JS 向け camelCase の JSON へ変換し、各 HTML ページへ
``<script type="application/json" id="riddle-config">`` として注入する。フロント側
（riddle.js の ``readRiddleConfig``）はこの要素を読み、``installRiddlePopover`` を発動させる。

設定値そのものは ``config.py`` の ``validate_config`` で検証済み。本モジュールは配信のみを担い、
``<script>`` ブレイクアウト対策として JSON 文字列の ``<`` 等をエスケープする（fail-closed）。
"""

from __future__ import annotations

import json
from typing import Any

from docutils import nodes
from sphinx.application import Sphinx
from sphinx.config import Config

#: 注入する JSON 設定要素の id（riddle.js の RIDDLE_CONFIG_ID と整合）。
_RIDDLE_CONFIG_ID = "riddle-config"

#: JS の文字列リテラルで行終端と解釈され得る行区切り文字（U+2028/U+2029）。
_LINE_SEPARATOR = chr(0x2028)
_PARAGRAPH_SEPARATOR = chr(0x2029)


def build_runtime_config(config: Config) -> dict[str, object]:
    """conf の ``riddle_*`` 設定を JS 向け camelCase の dict へ変換する純関数。

    :param config: ``riddle_*`` 属性を持つ Sphinx Config 互換オブジェクト。
    :returns: フロントへ渡す設定 dict（camelCase キー）。
    """
    return {
        "trigger": config.riddle_trigger,
        "openDelayMs": config.riddle_open_delay_ms,
        "closeDelayMs": config.riddle_close_delay_ms,
        "interactive": config.riddle_interactive,
        "maxHeight": config.riddle_max_height,
        "maxWidth": config.riddle_max_width,
        "footnotes": config.riddle_footnotes,
        "imagePopup": config.riddle_image_popup,
        "nested": config.riddle_nested,
    }


def encode_config_json(payload: dict[str, object]) -> str:
    """設定 dict を ``<script>`` へ安全に埋め込める JSON 文字列へ符号化する。

    ``</script>`` や ``<!--`` によるブレイクアウトを封じるため ``<`` を ``\\u003c`` へ、
    行区切り U+2028/U+2029 もエスケープする。いずれも ``JSON.parse`` は復号して読めるため
    値は無変換で復元できる（fail-closed）。

    :param payload: 符号化する設定 dict。
    :returns: ``<script type="application/json">`` の中身に使える JSON 文字列。
    """
    encoded = json.dumps(payload, ensure_ascii=False)
    return (
        encoded.replace("<", "\\u003c")
        .replace(_LINE_SEPARATOR, "\\u2028")
        .replace(_PARAGRAPH_SEPARATOR, "\\u2029")
    )


def inject_runtime_config(
    app: Sphinx,
    pagename: str,
    templatename: str,
    context: dict[str, Any],
    doctree: nodes.document | None,
) -> None:
    """html-page-context ハンドラ。#riddle-config の JSON 設定要素を body 末尾へ注入する。

    ``doctree`` が ``None``（非ドキュメントページ）なら何もしない。それ以外の document
    ページには、conf の ``riddle_*`` を符号化した
    ``<script type="application/json" id="riddle-config">`` を 1 つ追記する。

    :param app: Sphinx アプリケーション。
    :param pagename: 表示ページのドキュメント名。
    :param templatename: 使用テンプレート名（未使用）。
    :param context: HTML テンプレートコンテキスト。``'body'`` を更新する。
    :param doctree: 解決済み doctree。非ドキュメントページでは ``None``。
    """
    if doctree is None:
        return

    payload = build_runtime_config(app.config)
    encoded = encode_config_json(payload)
    element = (
        f'<script type="application/json" id="{_RIDDLE_CONFIG_ID}">{encoded}</script>'
    )
    context["body"] = context.get("body", "") + element
