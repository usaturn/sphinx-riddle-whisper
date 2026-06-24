敵対ページ
==========

.. glossary::

   わな
      正常な定義テキスト。

      .. raw:: html

         <img src="x" onerror="window.__pwned1=1">
         <a href="javascript:alert(1)">悪意リンク</a>
         <script>window.__pwned2=1</script>
         <iframe src="https://evil.example"></iframe>
         <base href="https://evil.example">

本文から :term:`わな` を参照する。
