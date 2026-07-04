"""sphinx-riddle-whisper の設定値登録と検証。"""

from collections.abc import Iterable
from typing import Literal, TypeVar

from sphinx.application import Sphinx
from sphinx.config import Config
from sphinx.errors import ExtensionError

_T = TypeVar("_T")

#: riddle_trigger に許可される値。
_ALLOWED_TRIGGERS = ("hover", "click", "both")

#: (name, default, rebuild) のタプルで登録する設定値。
#: allowed_* の既定 None は「sanitize.py の組み込み許可リストを使う」を意味する。
_CONFIG_SPECS: tuple[tuple[str, object, Literal["html"]], ...] = (
    ("riddle_trigger", "both", "html"),
    ("riddle_max_height", "24rem", "html"),
    ("riddle_max_width", "32rem", "html"),
    ("riddle_open_delay_ms", 150, "html"),
    ("riddle_close_delay_ms", 100, "html"),
    ("riddle_interactive", True, "html"),
    ("riddle_include_term_title", True, "html"),
    ("riddle_strip_classes", ("headerlink", "sd-stretched-link"), "html"),
    ("riddle_sanitize", True, "html"),
    ("riddle_allowed_tags", None, "html"),
    ("riddle_allowed_attributes", None, "html"),
    ("riddle_allowed_schemes", None, "html"),
    ("riddle_footnotes", True, "html"),
    ("riddle_image_popup", True, "html"),
)


def register_config_values(app: Sphinx) -> None:
    """全 riddle_* 設定値を登録し、'config-inited' に検証ハンドラを接続する。"""
    for name, default, rebuild in _CONFIG_SPECS:
        app.add_config_value(name, default, rebuild)
    app.connect("config-inited", validate_config)


def _validate_type(
    name: str, value: object, expected_type: type[_T], type_name: str
) -> _T:
    """value の型が expected_type そのものでなければ ExtensionError を raise する。

    検証を通過した値は ``expected_type`` として narrowing 済みの状態で返す。
    """
    if type(value) is not expected_type:
        raise ExtensionError(f"{name} は {type_name} である必要があります: {value!r}")
    return value


def _validate_non_negative_int(name: str, value: object) -> None:
    """value が 0 以上の int でなければ ExtensionError を raise する。"""
    checked = _validate_type(name, value, int, "int")
    if checked < 0:
        raise ExtensionError(f"{name} は 0 以上である必要があります: {value!r}")


def _validate_bool(name: str, value: object) -> None:
    """value が bool でなければ ExtensionError を raise する。"""
    _validate_type(name, value, bool, "bool")


def _normalize_str_iterable(name: str, value: object) -> tuple[str, ...]:
    """value（None 不可）を検証済みの文字列 tuple へ正規化する。"""
    if isinstance(value, (str, bytes)) or not isinstance(value, Iterable):
        raise ExtensionError(
            f"{name} は文字列のリスト/集合である必要があります: {value!r}"
        )
    normalized = tuple(value)
    for item in normalized:
        _validate_type(f"{name} の要素", item, str, "str")
    return normalized


def validate_config(app: Sphinx, config: Config) -> None:
    """'config-inited' ハンドラ。riddle_* 値を検証し、不正なら ExtensionError を raise する。"""
    _validate_type("riddle_trigger", config.riddle_trigger, str, "str")
    if config.riddle_trigger not in _ALLOWED_TRIGGERS:
        raise ExtensionError(
            f"riddle_trigger は {_ALLOWED_TRIGGERS} のいずれかである必要があります: "
            f"{config.riddle_trigger!r}"
        )

    _validate_type("riddle_max_height", config.riddle_max_height, str, "str")
    _validate_type("riddle_max_width", config.riddle_max_width, str, "str")

    _validate_non_negative_int("riddle_open_delay_ms", config.riddle_open_delay_ms)
    _validate_non_negative_int("riddle_close_delay_ms", config.riddle_close_delay_ms)
    _validate_bool("riddle_interactive", config.riddle_interactive)
    _validate_bool("riddle_include_term_title", config.riddle_include_term_title)
    _validate_bool("riddle_sanitize", config.riddle_sanitize)
    _validate_bool("riddle_footnotes", config.riddle_footnotes)
    _validate_bool("riddle_image_popup", config.riddle_image_popup)

    config.riddle_strip_classes = _normalize_str_iterable(
        "riddle_strip_classes",
        config.riddle_strip_classes,
    )

    if config.riddle_allowed_tags is not None:
        config.riddle_allowed_tags = _normalize_str_iterable(
            "riddle_allowed_tags",
            config.riddle_allowed_tags,
        )

    if config.riddle_allowed_schemes is not None:
        config.riddle_allowed_schemes = _normalize_str_iterable(
            "riddle_allowed_schemes",
            config.riddle_allowed_schemes,
        )

    if config.riddle_allowed_attributes is not None:
        config.riddle_allowed_attributes = _normalize_allowed_attributes(
            config.riddle_allowed_attributes
        )


def _normalize_allowed_attributes(value: object) -> dict[str, tuple[str, ...]]:
    """riddle_allowed_attributes を dict[str, tuple[str, ...]] へ正規化する。"""
    validated = _validate_type("riddle_allowed_attributes", value, dict, "dict")
    normalized: dict[str, tuple[str, ...]] = {}
    for key, attrs in validated.items():
        _validate_type("riddle_allowed_attributes のキー", key, str, "str")
        normalized[key] = _normalize_str_iterable(
            f"riddle_allowed_attributes[{key!r}]",
            attrs,
        )
    return normalized
