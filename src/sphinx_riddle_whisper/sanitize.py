"""ビルド時 XSS 一次防御のためのサニタイズ純関数。

render 後の最終 HTML 文字列を nh3 の許可リストでサニタイズする純関数
``sanitize_html`` を提供する。Sphinx 依存を持ち込まない独立モジュール。
"""

from __future__ import annotations

import re

import nh3

# 安全な画像 data: URI の MIME プレフィックス許可リスト（svg+xml は意図的に除外）。
_SAFE_IMAGE_DATA_MIME = (
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
)

_C0_CONTROL_OR_SPACE = "".join(chr(codepoint) for codepoint in range(0x21))
_URL_SEPARATOR_CHARACTERS = ("\t", "\n", "\r")
_URL_ASCII_TAB_OR_NEWLINE = {
    ord(character): None for character in _URL_SEPARATOR_CHARACTERS
}
_URL_LIST_SEPARATOR_NORMALIZATION = {
    ord(character): " " for character in _URL_SEPARATOR_CHARACTERS
}
_DATA_SCHEME_CANDIDATE_WITH_COMMA = re.compile(
    r"(?:^|[\s,])[\x00-\x20]*data:",
    re.IGNORECASE,
)
_DATA_SCHEME_CANDIDATE_WITHOUT_COMMA = re.compile(
    r"(?:^|[\s])[\x00-\x20]*data:",
    re.IGNORECASE,
)
_URL_BEARING_ATTRIBUTES: set[str] = {
    "href",
    "src",
    "data",
    "codebase",
    "archive",
    "classid",
    "srcset",
    "ping",
    "longdesc",
    "dynsrc",
    "lowsrc",
    "poster",
    "action",
    "formaction",
    "cite",
    "background",
}
_URL_LIST_ATTRIBUTES_FOR_DATA_SCAN: set[str] = {
    "srcset",
    "ping",
    "archive",
}


def _is_safe_image_data_uri(value: str) -> bool:
    """``data:`` URI のペイロードが安全な画像 MIME 接頭辞かを判定する。

    ``value`` は ``data:`` を除いた残り（例 ``image/png;base64,...``）。
    許可リスト ``_SAFE_IMAGE_DATA_MIME`` のいずれかに**完全一致**するか、その
    直後が MIME 区切り（``;`` パラメータ / ``,`` データ本体）であるときのみ
    ``True``。``image/pngX`` のような接頭辞偽装や svg+xml・非画像 ``data:`` は
    ``False``（fail-closed）。
    """
    head = value.lstrip().lower()
    return any(
        head == mime or head.startswith(mime + ";") or head.startswith(mime + ",")
        for mime in _SAFE_IMAGE_DATA_MIME
    )


def _preprocess_url_for_scheme(value: str) -> str:
    """ブラウザの URL scheme 判定に近づけるため、C0/空白系の難読化を除去する。"""
    return value.translate(_URL_ASCII_TAB_OR_NEWLINE).lstrip(
        _C0_CONTROL_OR_SPACE
    )


def _contains_data_scheme_candidate(value: str, *, comma_is_separator: bool) -> bool:
    """URL リスト属性の内部に data: scheme 候補が含まれるかを判定する。"""
    normalized = value.translate(_URL_LIST_SEPARATOR_NORMALIZATION)
    pattern = (
        _DATA_SCHEME_CANDIDATE_WITH_COMMA
        if comma_is_separator
        else _DATA_SCHEME_CANDIDATE_WITHOUT_COMMA
    )
    return pattern.search(normalized) is not None


def _find_start_tag_end(html: str, start: int) -> int | None:
    """``start`` 位置の開始タグについて、引用符外の ``>`` 位置を返す。"""
    quote: str | None = None
    pos = start + 1
    while pos < len(html):
        char = html[pos]
        if quote is not None:
            if char == quote:
                quote = None
        elif char == '"' or char == "'":
            quote = char
        elif char == ">":
            return pos
        pos += 1
    return None


def _strip_unsafe_data_src_from_tag(tag: str) -> str:
    """1 つの開始タグから unsafe な実 ``src=data:`` 属性だけを除去する。"""
    end = len(tag) - 1
    pos = 1
    while pos < end and not tag[pos].isspace() and tag[pos] not in "/>":
        pos += 1

    removals: list[tuple[int, int]] = []
    while pos < end:
        attr_start = pos
        while pos < end and tag[pos].isspace():
            pos += 1
        if pos >= end or tag[pos] in "/>":
            break

        name_start = pos
        while pos < end and not tag[pos].isspace() and tag[pos] not in "=/>":
            pos += 1
        name = tag[name_start:pos].lower()

        while pos < end and tag[pos].isspace():
            pos += 1

        value = ""
        if pos < end and tag[pos] == "=":
            pos += 1
            while pos < end and tag[pos].isspace():
                pos += 1
            if pos < end and tag[pos] in {'"', "'"}:
                quote = tag[pos]
                pos += 1
                value_start = pos
                while pos < end and tag[pos] != quote:
                    pos += 1
                value = tag[value_start:pos]
                if pos < end:
                    pos += 1
            else:
                value_start = pos
                while pos < end and not tag[pos].isspace() and tag[pos] != ">":
                    pos += 1
                value = tag[value_start:pos]

        attr_end = pos
        preprocessed = _preprocess_url_for_scheme(value)
        if name == "src" and preprocessed.lower().startswith("data:"):
            payload = preprocessed[len("data:") :]
            if not _is_safe_image_data_uri(payload):
                removals.append((attr_start, attr_end))

    if not removals:
        return tag

    parts: list[str] = []
    last = 0
    for start, stop in removals:
        parts.append(tag[last:start])
        last = stop
    parts.append(tag[last:])
    return "".join(parts)


def _strip_unsafe_data_src(html: str) -> str:
    """``src="data:..."`` のうち安全な画像でないものを src ごと除去する。

    ユーザが ``allowed_schemes`` に ``data`` を含めても、この独立ガードが
    svg+xml・非画像 ``data:`` を必ず除去する（設定で上書き不可）。
    """

    parts: list[str] = []
    last = 0
    pos = 0
    while pos < len(html):
        if (
            html[pos] == "<"
            and pos + 1 < len(html)
            and html[pos + 1].isalpha()
        ):
            tag_end = _find_start_tag_end(html, pos)
            if tag_end is None:
                break
            parts.append(html[last:pos])
            parts.append(_strip_unsafe_data_src_from_tag(html[pos : tag_end + 1]))
            pos = tag_end + 1
            last = pos
            continue
        pos += 1
    parts.append(html[last:])
    return "".join(parts)


DEFAULT_ALLOWED_TAGS: set[str] = {
    "p",
    "br",
    "hr",
    "span",
    "div",
    "em",
    "strong",
    "b",
    "i",
    "s",
    "sub",
    "sup",
    "code",
    "pre",
    "kbd",
    "samp",
    "var",
    "blockquote",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "caption",
    "a",
    "img",
    "figure",
    "figcaption",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
}

DEFAULT_ALLOWED_ATTRIBUTES: dict[str, set[str]] = {
    "*": {"class", "id", "title"},
    "a": {"href", "target"},
    "img": {"src", "alt", "title", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}

DEFAULT_ALLOWED_SCHEMES: set[str] = {"http", "https", "mailto"}


def _data_uri_attribute_filter(tag: str, attr: str, value: str) -> str | None:
    """``data:`` URI を URL-bearing 属性上でだけ制限する。

    nh3 の ``url_schemes`` に ``data`` を許可した上で、安全な画像 ``data:`` URI
    （``image/png`` 等）の ``img[src]`` だけを通す。svg+xml・非画像 ``data:`` や、
    ``object[data]`` / ``a[href]`` / ``a[ping]`` / ``img[srcset]`` などの
    URL-bearing 属性上の
    ``data:`` は ``None`` を返して除去する（fail-closed）。``title`` や ``alt`` など
    URL として解釈されない属性値はそのまま通す。
    """
    attr_name = attr.lower()
    if attr_name not in _URL_BEARING_ATTRIBUTES:
        return value

    if (
        attr_name in _URL_LIST_ATTRIBUTES_FOR_DATA_SCAN
        and _contains_data_scheme_candidate(
            value,
            comma_is_separator=attr_name == "srcset",
        )
    ):
        return None

    preprocessed = _preprocess_url_for_scheme(value)
    if not preprocessed.lower().startswith("data:"):
        return value
    if tag == "img" and attr_name == "src":
        payload = preprocessed[len("data:") :]
        return preprocessed if _is_safe_image_data_uri(payload) else None
    return None


def sanitize_html(
    html: str,
    *,
    enabled: bool = True,
    allowed_tags: set[str] | None = None,
    allowed_attributes: dict[str, set[str]] | None = None,
    allowed_schemes: set[str] | None = None,
) -> str:
    """HTML 文字列を許可リストでサニタイズする。

    ``enabled=False`` ならバイパスして ``html`` をそのまま返す。
    ``True`` なら ``nh3.clean`` で許可リストサニタイズを行う。
    ``allowed_*`` が ``None`` なら既定の許可リスト
    （``DEFAULT_ALLOWED_TAGS`` / ``DEFAULT_ALLOWED_ATTRIBUTES`` /
    ``DEFAULT_ALLOWED_SCHEMES``）を使う。

    :param html: サニタイズ対象の HTML 文字列。
    :param enabled: ``False`` のときバイパス（無変換で返す）。
    :param allowed_tags: 許可するタグ集合。``None`` で既定値。
    :param allowed_attributes: 許可する属性マップ。``None`` で既定値。
    :param allowed_schemes: 許可する URL スキーム集合。``None`` で既定値。
    :returns: サニタイズ後（またはバイパス時は無変換）の HTML 文字列。
    """
    if not enabled:
        return html

    tags = DEFAULT_ALLOWED_TAGS if allowed_tags is None else allowed_tags
    attributes = (
        DEFAULT_ALLOWED_ATTRIBUTES
        if allowed_attributes is None
        else {tag: set(attrs) for tag, attrs in allowed_attributes.items()}
    )
    schemes = (
        DEFAULT_ALLOWED_SCHEMES if allowed_schemes is None else allowed_schemes
    )

    html = _strip_unsafe_data_src(html)

    # 安全な画像 data: URI を nh3 が剥がさないよう data を許可しつつ、
    # attribute_filter で svg+xml・非画像 data: を src/href から除去する。
    return nh3.clean(
        html,
        tags=tags,
        attributes=attributes,
        url_schemes=schemes | {"data"},
        attribute_filter=_data_uri_attribute_filter,
        link_rel="noopener noreferrer",
    )
