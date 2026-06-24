ルート直下参照ページ
====================

本文から :term:`フー` を参照する（ルート直下・depth=1 のクロスページ参照）。

dirhtml では rootref → rootref/index.html として出力され、出力ディレクトリは
``rootref/``（出力ルートから 1 階層）。subdir/other（depth=2）より浅い位置から
同一用語フー(term-0)を参照するため、定義に含まれる :doc:/:ref:/画像の再ベース
段数（``../`` の数）が subdir/other とは異なる。
