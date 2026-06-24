用語集ページ
============

.. _intro-anchor:

イントロ節
----------

イントロ本文。

.. glossary::

   フー
   foo
      フーの定義本体。段落2つめ。

      別ドキュメントへの :doc:`トピック <topic>` リンクと、同一 home 内の
      :ref:`イントロ節 <intro-anchor>` アンカーを参照する。

      出力ルート脱出を狙う敵対的相対リンク
      `脱出 <../../../etc/passwd>`_ も含む。

      .. image:: pic.png
         :alt: サンプル画像

      .. raw:: html

         <a href="javascript:alert(1)">敵対リンク</a>
         <a href="data:text/html,evil" onclick="window.__pwned=1">敵対データURI</a>
         <script>window.__pwned2=1</script>

   バー
      バーの定義本体。

.. toctree::

   topic
   subdir/other
   rootref
   deep/glossary
   deepref
