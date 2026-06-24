深い階層の用語集ページ
======================

.. _deep-anchor:

深いイントロ節
--------------

深いイントロ本文。同一 home 内で定義する用語 :term:`selfword` を、その home 自身の
本文からのみ参照する（クロスページ参照は持たず、解決済み doctree では refid 形になる）。

.. glossary::

   baz
      バズの定義本体。深い階層 home の定義。

      同一 home 内の :ref:`深いイントロ節 <deep-anchor>` アンカーを参照し、
      home と同じ ``deep/`` ディレクトリにある画像を埋め込む。

      外部サイトへの `公式サイト <https://example.com/baz>`_ リンクも含む
      （再ベース対象外として verbatim 保持されるべき外部 URL）。

      .. image:: deeppic.png
         :alt: 深い画像

   selfword
      セルフ用語の定義本体。home 自身の refid 形参照だけで注入される用語。

   crossref
      クロスリファレンス用語の定義本体。定義本文の中から別の用語
      :term:`baz` を :term: 参照する（定義本文同士が相互参照するケース）。

   selfanchor
      セルフアンカー用語の定義本体。自己完結アンカーを定義内に持つ用語。

      .. _selfanchor-inner:

      この定義の内部に置いたターゲット ``selfanchor-inner`` を、同一定義内の
      :ref:`自己完結アンカー <selfanchor-inner>` から参照する（refid が定義
      subtree 内に存在する自己完結アンカー）。
