"""最小ドキュメントの HTML ビルドが拡張をロードした状態で成功することを検証するテスト。"""

import pytest


@pytest.mark.sphinx("html", testroot="min", warningiserror=True)
def test_min_testrootでapp_buildが例外なく完了し拡張がロードされる(app):
    """testroot='min' の app fixture で app.build() が例外を送出せず完了し、拡張がロードされている。"""
    # Arrange: app fixture が tests/roots/test-min を testroot='min' として配線している前提

    # Act: ビルドを実行する（例外が出れば失敗）
    app.build()

    # Assert: 拡張がロードされていること
    assert "sphinx_riddle_whisper" in app.extensions
