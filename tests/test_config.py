"""sphinx_riddle_whisper.config の設定値検証を確認するテスト。"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sphinx.errors import ExtensionError

from sphinx_riddle_whisper import setup
from sphinx_riddle_whisper.config import register_config_values, validate_config

#: register_config_values が登録すべき設定名（仕様 §設定オプションの MVP 分）。
_EXPECTED_CONFIG_NAMES = {
    "riddle_trigger",
    "riddle_max_height",
    "riddle_max_width",
    "riddle_open_delay_ms",
    "riddle_close_delay_ms",
    "riddle_interactive",
    "riddle_include_term_title",
    "riddle_strip_classes",
    "riddle_sanitize",
    "riddle_allowed_tags",
    "riddle_allowed_attributes",
    "riddle_allowed_schemes",
    "riddle_footnotes",
    "riddle_image_popup",
    "riddle_nested",
}


def _make_default_config(**overrides):
    """全 riddle_* 既定値を持つ擬似 config を作るヘルパ。overrides で上書き可能。"""
    values = {
        "riddle_trigger": "both",
        "riddle_max_height": "24rem",
        "riddle_max_width": "32rem",
        "riddle_open_delay_ms": 150,
        "riddle_close_delay_ms": 100,
        "riddle_interactive": True,
        "riddle_footnotes": True,
        "riddle_image_popup": True,
        "riddle_nested": True,
        "riddle_include_term_title": True,
        "riddle_strip_classes": ("headerlink", "sd-stretched-link"),
        "riddle_sanitize": True,
        "riddle_allowed_tags": None,
        "riddle_allowed_attributes": None,
        "riddle_allowed_schemes": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_riddle_triggerが許可外の値のときExtensionErrorを送出する():
    """riddle_trigger が許可値（hover/click/both）以外なら validate_config が ExtensionError を raise する。"""
    # Arrange: 許可外の値を持つ擬似 config を用意する
    config = _make_default_config(riddle_trigger="hoverr")
    app = SimpleNamespace()

    # Act & Assert: 不正な trigger で ExtensionError が送出される
    try:
        validate_config(app, config)
    except ExtensionError:
        pass
    else:
        raise AssertionError(
            "riddle_trigger='hoverr' で ExtensionError が送出されなかった"
        )


def test_riddle_open_delay_msが負の値のときExtensionErrorを送出する():
    """riddle_open_delay_ms が負（例 -1）なら validate_config が ExtensionError を raise する。"""
    # Arrange: 負の open_delay_ms を持つ擬似 config を用意する
    config = _make_default_config(riddle_open_delay_ms=-1)
    app = SimpleNamespace()

    # Act & Assert: 負値で ExtensionError が送出される
    try:
        validate_config(app, config)
    except ExtensionError:
        pass
    else:
        raise AssertionError(
            "riddle_open_delay_ms=-1 で ExtensionError が送出されなかった"
        )


def test_riddle_open_delay_msが非intのときExtensionErrorを送出する():
    """riddle_open_delay_ms が非 int（例 '150'）なら validate_config が ExtensionError を raise する。"""
    # Arrange: int でない open_delay_ms を持つ擬似 config を用意する
    config = _make_default_config(riddle_open_delay_ms="150")
    app = SimpleNamespace()

    # Act & Assert: 非 int で ExtensionError が送出される
    try:
        validate_config(app, config)
    except ExtensionError:
        pass
    else:
        raise AssertionError(
            "riddle_open_delay_ms='150' で ExtensionError が送出されなかった"
        )


def test_riddle_close_delay_msが負の値のときExtensionErrorを送出する():
    """riddle_close_delay_ms が負（例 -1）なら validate_config が ExtensionError を raise する。"""
    # Arrange: 負の close_delay_ms を持つ擬似 config を用意する
    config = _make_default_config(riddle_close_delay_ms=-1)
    app = SimpleNamespace()

    # Act & Assert: 負値で ExtensionError が送出される
    try:
        validate_config(app, config)
    except ExtensionError:
        pass
    else:
        raise AssertionError(
            "riddle_close_delay_ms=-1 で ExtensionError が送出されなかった"
        )


def test_riddle_close_delay_msが非intのときExtensionErrorを送出する():
    """riddle_close_delay_ms が非 int（例 '100'）なら validate_config が ExtensionError を raise する。"""
    # Arrange: int でない close_delay_ms を持つ擬似 config を用意する
    config = _make_default_config(riddle_close_delay_ms="100")
    app = SimpleNamespace()

    # Act & Assert: 非 int で ExtensionError が送出される
    try:
        validate_config(app, config)
    except ExtensionError:
        pass
    else:
        raise AssertionError(
            "riddle_close_delay_ms='100' で ExtensionError が送出されなかった"
        )


@pytest.mark.parametrize("name", ["riddle_open_delay_ms", "riddle_close_delay_ms"])
def test_delay_msにboolを与えるとExtensionErrorを送出する(name):
    """bool は int のサブクラスだが、delay_ms の int としては受け入れない。"""
    config = _make_default_config(**{name: True})

    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


@pytest.mark.parametrize(
    "name",
    [
        "riddle_sanitize",
        "riddle_interactive",
        "riddle_include_term_title",
        "riddle_footnotes",
    ],
)
def test_bool設定に非boolを与えるとExtensionErrorを送出する(name):
    """未検証だった bool 設定も、bool 以外なら ExtensionError を raise する。"""
    config = _make_default_config(**{name: "yes"})

    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


@pytest.mark.parametrize("name", ["riddle_max_height", "riddle_max_width"])
def test_size設定に非strを与えるとExtensionErrorを送出する(name):
    """CSS サイズとして配信される max_height / max_width は str のみ受け入れる。"""
    config = _make_default_config(**{name: 24})

    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_strip_classesに非str要素があるとExtensionErrorを送出する():
    """riddle_strip_classes の要素が str でなければ ExtensionError を raise する。"""
    config = _make_default_config(riddle_strip_classes=["ok", 1])
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_allowed_tagsに非str要素があるとExtensionErrorを送出する():
    """riddle_allowed_tags が指定（非 None）で str 以外を含めば ExtensionError を raise する。"""
    config = _make_default_config(riddle_allowed_tags=["p", 2])
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_allowed_schemesに非str要素があるとExtensionErrorを送出する():
    """riddle_allowed_schemes が指定（非 None）で str 以外を含めば ExtensionError を raise する。"""
    config = _make_default_config(riddle_allowed_schemes=["https", 3])
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_allowed_attributesがdictでないとExtensionErrorを送出する():
    """riddle_allowed_attributes が指定（非 None）で dict でなければ ExtensionError を raise する。"""
    config = _make_default_config(riddle_allowed_attributes=["not", "a", "dict"])
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_allowed_attributesの値が文字列集合でないとExtensionErrorを送出する():
    """riddle_allowed_attributes の値（属性集合）が str の集合でなければ ExtensionError を raise する。"""
    config = _make_default_config(riddle_allowed_attributes={"a": ["href", 9]})
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_全既定値のconfigではvalidate_configが例外を出さない():
    """全設定が既定値の擬似 config では validate_config が例外を出さず正常終了する。"""
    config = _make_default_config()
    validate_config(SimpleNamespace(), config)  # 例外が出なければ成功


def test_riddle_footnotesを含む全既定configでvalidate_configが例外を出さない():
    """riddle_footnotes=True を含む全既定 config では validate_config が例外を出さず正常終了する（専用バリデータなしの多層防御方針）。"""
    # Arrange: 既定 True の riddle_footnotes を明示的に含む擬似 config を用意する
    config = _make_default_config(riddle_footnotes=True)

    # Act & Assert: 専用バリデータを持たないため例外なく正常終了する
    validate_config(SimpleNamespace(), config)  # 例外が出なければ成功


def test_riddle_footnotesがFalseのときvalidate_configが例外を出さない():
    """riddle_footnotes=False は正当な bool 値として validate_config が受け入れる。"""
    config = _make_default_config(riddle_footnotes=False)

    validate_config(SimpleNamespace(), config)  # 例外が出なければ成功


def test_riddle_footnotesが非boolのときExtensionErrorを送出する():
    """riddle_footnotes が bool 以外（例 'no'）なら validate_config が ExtensionError を raise する。"""
    config = _make_default_config(riddle_footnotes="no")

    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_妥当な上書きでvalidate_configが例外を出さない():
    """許可値・境界値・正当な allowed_* の上書きでは例外を出さない。"""
    config = _make_default_config(
        riddle_trigger="hover",
        riddle_open_delay_ms=0,
        riddle_close_delay_ms=0,
        riddle_strip_classes=["x"],
        riddle_allowed_tags={"p", "a"},
        riddle_allowed_schemes=["https", "mailto"],
        riddle_allowed_attributes={"a": {"href", "title"}},
    )
    validate_config(SimpleNamespace(), config)  # 例外が出なければ成功


def test_文字列iterable設定のgeneratorは検証時にtupleへ正規化される():
    """one-shot generator を検証で消費して空設定にせず、再走査可能な tuple として保持する。"""
    config = _make_default_config(
        riddle_strip_classes=(x for x in ["headerlink", "sd-stretched-link"]),
        riddle_allowed_tags=(x for x in ["p", "a"]),
        riddle_allowed_schemes=(x for x in ["https", "mailto"]),
        riddle_allowed_attributes={"a": (x for x in ["href", "title"])},
    )

    validate_config(SimpleNamespace(), config)

    assert config.riddle_strip_classes == ("headerlink", "sd-stretched-link")
    assert config.riddle_allowed_tags == ("p", "a")
    assert config.riddle_allowed_schemes == ("https", "mailto")
    assert config.riddle_allowed_attributes == {"a": ("href", "title")}


def test_riddle_triggerの各許可値で例外を出さない():
    """riddle_trigger が hover / click / both のいずれでも例外を出さない。"""
    for trigger in ("hover", "click", "both"):
        validate_config(SimpleNamespace(), _make_default_config(riddle_trigger=trigger))


def test_register_config_valuesが全設定名をadd_config_valueで登録する():
    """register_config_values が期待する全 riddle_* 名について add_config_value を呼ぶ。"""
    app = MagicMock()

    register_config_values(app)

    registered = {call.args[0] for call in app.add_config_value.call_args_list}
    assert registered >= _EXPECTED_CONFIG_NAMES


def test_riddle_footnotesの既定値がTrueのboolで登録される():
    """register_config_values が riddle_footnotes を既定値 True（bool）で add_config_value 登録する。"""
    # Arrange: add_config_value 呼び出しを記録する擬似 app を用意する
    app = MagicMock()

    # Act: 設定値を登録する
    register_config_values(app)

    # Assert: riddle_footnotes の既定値が True かつ bool 型で登録されている
    defaults = {
        call.args[0]: call.args[1] for call in app.add_config_value.call_args_list
    }
    assert "riddle_footnotes" in defaults
    default = defaults["riddle_footnotes"]
    assert default is True
    assert isinstance(default, bool)


def test_riddle_strip_classesの既定値がtupleで登録される():
    """register_config_values が riddle_strip_classes を tuple 既定値で登録する。"""
    app = MagicMock()

    register_config_values(app)

    defaults = {
        call.args[0]: call.args[1] for call in app.add_config_value.call_args_list
    }
    assert defaults["riddle_strip_classes"] == ("headerlink", "sd-stretched-link")
    assert isinstance(defaults["riddle_strip_classes"], tuple)


def test_riddle_footnotesがrebuild区分htmlで登録される():
    """register_config_values が riddle_footnotes を rebuild 区分 'html' で add_config_value 登録する。"""
    # Arrange: add_config_value 呼び出しを記録する擬似 app を用意する
    app = MagicMock()

    # Act: 設定値を登録する
    register_config_values(app)

    # Assert: riddle_footnotes が rebuild 区分 'html'（第 3 引数）で登録されている
    rebuilds = {
        call.args[0]: call.args[2] for call in app.add_config_value.call_args_list
    }
    assert "riddle_footnotes" in rebuilds
    assert rebuilds["riddle_footnotes"] == "html"


def test_登録既定値で解決したconfigにriddle_footnotesが含まれvalidate_configが例外を出さない():
    """register_config_values で登録した既定値を Sphinx Config で解決した config では、
    riddle_footnotes が欠落せず（既定 True が解決され）、validate_config が例外を出さない（登録と検証の結合）。"""
    # Arrange: 実際の Sphinx Config に register_config_values 経由で全設定を登録し、既定値を解決する
    from sphinx.config import Config

    config = Config({}, {})

    class _AppShim:
        def add_config_value(self, name, default, rebuild):
            config.add(name, default, rebuild, ())

        def connect(self, *args, **kwargs):
            pass

    register_config_values(_AppShim())
    config.init_values()

    # Act & Assert: add_config_value のデフォルト解決を経た config で riddle_footnotes が欠落せず例外も出ない
    assert config.riddle_footnotes is True
    validate_config(SimpleNamespace(), config)  # 例外が出なければ成功


def test_register_config_valuesがvalidate_configをconfig_initedにconnectする():
    """register_config_values が 'config-inited' に validate_config を connect する。"""
    app = MagicMock()

    register_config_values(app)

    app.connect.assert_any_call("config-inited", validate_config)


def test_riddle_image_popupが非boolのときExtensionErrorを送出する():
    """riddle_image_popup が bool 以外（例 'yes'）なら validate_config が ExtensionError を raise する。"""
    # Arrange: bool でない値を持つ擬似 config を用意する
    config = _make_default_config(riddle_image_popup="yes")

    # Act & Assert: 非 bool で ExtensionError が送出される
    with pytest.raises(ExtensionError):
        validate_config(SimpleNamespace(), config)


def test_riddle_image_popupの既定値がTrueのboolで登録される():
    """register_config_values が riddle_image_popup を既定値 True（is True かつ isinstance bool）で add_config_value 登録する。"""
    # Arrange: add_config_value 呼び出しを記録する擬似 app を用意する
    app = MagicMock()

    # Act: 設定値を登録する
    register_config_values(app)

    # Assert: riddle_image_popup の既定値が True かつ bool 型で登録されている
    defaults = {
        call.args[0]: call.args[1] for call in app.add_config_value.call_args_list
    }
    assert "riddle_image_popup" in defaults
    assert defaults["riddle_image_popup"] is True
    assert isinstance(defaults["riddle_image_popup"], bool)


@pytest.mark.parametrize("popup_value", [True, False])
def test_riddle_image_popupがbool値のときvalidate_configが例外を出さない(popup_value):
    """riddle_image_popup が True または False（bool）のとき validate_config が例外を出さず正常終了する（bool 検証の正常系境界）。"""
    # Arrange: bool 値（True / False）を持つ擬似 config を用意する
    config = _make_default_config(riddle_image_popup=popup_value)

    # Act & Assert: 正当な bool 値では例外が出ない
    validate_config(SimpleNamespace(), config)  # 例外が出なければ成功


def test_riddle_nestedが非boolのときExtensionErrorを送出する():
    """riddle_nested が bool 以外なら validate_config が ExtensionError を raise する。"""
    # Arrange: 非 bool（文字列）の riddle_nested を持つ擬似 config を用意する
    config = _make_default_config(riddle_nested="yes")
    app = SimpleNamespace()

    # Act & Assert: 非 bool で ExtensionError が送出される
    with pytest.raises(ExtensionError):
        validate_config(app, config)


def test_setupがregister_config_valuesを呼びメタデータを返す(monkeypatch):
    """setup(app) が config 登録を行いつつ ExtensionMetadata を返す。"""
    called = {}

    def _spy(app):
        called["app"] = app

    monkeypatch.setattr("sphinx_riddle_whisper.register_config_values", _spy)
    app = MagicMock()

    result = setup(app)

    assert called.get("app") is app
    assert result["parallel_read_safe"] is True
    assert result["parallel_write_safe"] is True
