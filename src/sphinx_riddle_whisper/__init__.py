"""sphinx-riddle-whisper: glossary term definition popup extension for Sphinx."""

import importlib.metadata
import os

from sphinx.application import Sphinx
from sphinx.util.typing import ExtensionMetadata

from sphinx_riddle_whisper.config import register_config_values
from sphinx_riddle_whisper.inject import (
    inject_definition_templates,
    record_page_home_dependencies,
)
from sphinx_riddle_whisper.runtime_config import inject_runtime_config

#: パッケージ未インストール時に用いるバージョンのフォールバック値。
_FALLBACK_VERSION = "0.0.0"
#: バージョン取得に用いる配布パッケージ名。
_DISTRIBUTION_NAME = "sphinx-riddle-whisper"


def _register_riddle_assets(app: Sphinx) -> None:
    """HTML ビルド時に riddle.js / riddle.css を登録し static を同梱する。

    builder-inited のタイミングで呼ばれる。非 HTML builder では何もしない。

    :param app: Sphinx アプリケーション。
    """
    if app.builder.format != "html":
        return
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if static_dir not in app.config.html_static_path:
        app.config.html_static_path.append(static_dir)
    app.add_css_file("riddle.css")
    # riddle.js は ESM（export を持つ）。riddle-init.js を type="module" で読み込み、
    # riddle.js は riddle-init.js からの import 経由で評価する（クラシック script だと
    # トップレベル export で構文エラーになる）。riddle.js / riddle-init.js は static_dir を
    # html_static_path へ追加した時点で _static/ へコピーされる。
    app.add_js_file("riddle-init.js", type="module")


def setup(app: Sphinx) -> ExtensionMetadata:
    register_config_values(app)
    app.connect("html-page-context", inject_definition_templates)
    # ランタイム設定（riddle_*）を #riddle-config(JSON) として各ページへ配信し、
    # riddle-init.js の initRiddle がそれを読んで installRiddlePopover を発動させる。
    app.connect("html-page-context", inject_runtime_config)
    app.connect("builder-inited", _register_riddle_assets)
    # 増分ビルドで home(定義ページ)変更時に参照ページを再書き出しさせる依存を、
    # 並列書き出しの fork 前・親プロセスで一括記録する（env.dependencies へ）。
    app.connect("env-updated", record_page_home_dependencies)
    try:
        version = importlib.metadata.version(_DISTRIBUTION_NAME)
    except importlib.metadata.PackageNotFoundError:
        version = _FALLBACK_VERSION
    return {
        "version": version,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
