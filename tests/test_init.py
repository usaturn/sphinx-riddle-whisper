"""sphinx_riddle_whisper.setup の振る舞いを検証するテスト。"""

import importlib.metadata
from unittest.mock import MagicMock

from sphinx_riddle_whisper import setup


def test_PackageNotFoundError時にversionが空でないフォールバック文字列になる(monkeypatch):
    """バージョン取得が PackageNotFoundError を送出しても、'version' は空でない文字列を返す。"""
    # Arrange: importlib.metadata.version が必ず PackageNotFoundError を送出するようにする
    def _raise(*args, **kwargs):
        raise importlib.metadata.PackageNotFoundError

    monkeypatch.setattr(importlib.metadata, "version", _raise)

    # Act
    result = setup(MagicMock())

    # Assert: 'version' は空でない文字列
    assert isinstance(result["version"], str)
    assert result["version"] != ""


def test_setupはparallel_read_safeをTrueで返す():
    """並列読み取り安全フラグが metadata に含まれ True である。"""
    result = setup(MagicMock())

    assert result["parallel_read_safe"] is True


def test_setupはparallel_write_safeをTrueで返す():
    """並列書き込み安全フラグが metadata に含まれ True である。"""
    result = setup(MagicMock())

    assert result["parallel_write_safe"] is True


def test_setupの戻り値のversionは空でない文字列():
    """実環境のデフォルト経路で 'version' キーが空でない文字列で存在する。"""
    result = setup(MagicMock())

    assert isinstance(result["version"], str)
    assert result["version"] != ""
