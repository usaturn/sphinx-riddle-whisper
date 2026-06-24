"""sphinx-riddle-whisper のドキュメント兼デモ用 Sphinx 設定。"""

project = "sphinx-riddle-whisper"
author = "usaturn"
copyright = "2026, usaturn"

extensions = ["sphinx_riddle_whisper"]

# superpowers/ 配下（設計 spec などの作業ドキュメント）は -W ビルドの
# toctree 警告を避けるためビルド対象から除外する。
exclude_patterns = ["superpowers/**", "_build", "Thumbs.db", ".DS_Store"]

html_theme = "alabaster"
