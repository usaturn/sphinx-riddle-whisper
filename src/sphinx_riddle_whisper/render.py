"""無切り詰めレンダリング。

URI 補正済みの definition サブツリーを ``builder.render_partial`` で HTML 断片化し、
``riddle_strip_classes`` 該当のアンカー（headerlink 等）を除去、任意で term タイトルを
付加して HTML 文字列を返す。採用分岐 (a)（doctree 方式維持）の下で動作する。

この単位ではサニタイズ（nh3）を行わない。サニタイズは sanitize.py（#9）に実装し、
inject（#13）が render→sanitize を繋ぐ。strip は標準ライブラリ（re, html）のみで行い、
beautifulsoup4（dev 専用依存）は使わない。
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable
from typing import Protocol

from docutils import nodes


class _RenderPartialBuilder(Protocol):
    """``render_partial(node)`` を持つ Sphinx Builder 互換オブジェクトの構造的型。"""

    def render_partial(self, node: nodes.Node | None) -> dict[str, str]: ...


def _strip_anchor_classes(html_fragment: str, classes: Iterable[str]) -> str:
    """``classes`` のいずれかを class 属性に含む ``<a ...>...</a>`` を除去する。

    headerlink の ¶ アンカーなどを、開始タグの属性も内容も含めて要素ごと取り除く。
    アンカーはネストしない前提で非貪欲マッチする。標準ライブラリ ``re`` のみを使う。

    :param html_fragment: 対象の HTML 断片文字列。
    :param classes: 除去対象とする class 名の集合。
    :returns: 該当アンカーを除去した HTML 文字列。
    """
    result = html_fragment
    for cls in classes:
        # class 属性値の中で当該クラスを単語境界（空白区切り）で照合し、
        # アンカー要素の本体は非貪欲（.*?）・DOTALL で取り込む。
        pattern = re.compile(
            r'<a\b[^>]*\bclass="[^"]*(?<![\w-])'
            + re.escape(cls)
            + r'(?![\w-])[^"]*"[^>]*>.*?</a>',
            re.DOTALL,
        )
        result = pattern.sub("", result)
    return result


def render_definition(
    builder: _RenderPartialBuilder,
    definition: nodes.Element,
    *,
    strip_classes: Iterable[str] = (),
    include_term_title: bool = False,
    term_text: str | None = None,
) -> str:
    """definition サブツリーを無切り詰めで HTML 断片化して返す。

    :param builder: ``render_partial(node)`` を持つ Sphinx Builder。
    :param definition: HTML 化する definition サブツリー（docutils ノード）。
    :param strip_classes: 除去するアンカーの class 名（headerlink 等）。
    :param include_term_title: True かつ ``term_text`` があれば term タイトルを先頭に付加する。
    :param term_text: term タイトルとして表示する用語名。
    :returns: 切り詰めなしの HTML 文字列。
    """
    fragment = builder.render_partial(definition)["fragment"]
    fragment = _strip_anchor_classes(fragment, strip_classes)
    if include_term_title and term_text:
        title = f'<p class="riddle-term-title">{html.escape(term_text)}</p>'
        fragment = title + fragment
    return fragment
