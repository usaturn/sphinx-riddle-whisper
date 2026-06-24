"""singlehtml ビルダ統合（html-page-context e2e）の検証テスト。

html / dirhtml ビルダで動いている glossary ポップオーバーの template 注入が、
全ドキュメントを単一 HTML（index.html）へ集約する singlehtml ビルダでも
壊れないことを実ビルドで回帰固定する。

singlehtml では :term: 参照が refuri="#document-<docname>#term-*" のような
二重フラグメント形になり得るため、term-id 抽出が壊れて注入ゼロになる実害が
懸念される。本ファイルはまずその本丸（注入が存在し定義本文を含むこと）を固定する。
"""

import posixpath
import re
from collections import Counter
from pathlib import Path

import pytest
from bs4 import BeautifulSoup


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtmlビルドがwarning_as_errorで警告ゼロで完走し単一index_htmlのみ生成する(app):
    """[t4/正常] singlehtml ビルドが warningiserror=True で警告ゼロ・成功で完走し、
    単一 index.html がちょうど 1 つだけ生成される。

    singlehtml は全ドキュメントを単一 HTML へ集約するビルダであり、その標準出力は
    Path(app.outdir)/index.html ただ 1 ファイルである。template 注入・同一ページ
    参照分岐が singlehtml 上で warning を誘発しないこと（warningiserror=True 下で
    1 つでも warning が出れば app.build() が例外を送出して失敗する）、および完走の
    証跡として出力 HTML ファイルが index.html ちょうど 1 つであることを固定する。
    複数 HTML が生成される・index.html 以外が混ざる場合は集約が壊れている。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    # （warning が出れば app.build() がここで例外を送出する）
    app.build()

    outdir = Path(app.outdir)

    # Assert: 警告ゼロで完走している（warningiserror 下では非0なら既に例外だが明示固定）
    assert app._warncount == 0, (
        f"singlehtml ビルドで warning が発生した（warncount={app._warncount}）"
    )

    # Assert: 出力 HTML ファイルは index.html ちょうど 1 つだけ（単一ページ集約の証跡）
    html_files = sorted(
        p.relative_to(outdir).as_posix() for p in outdir.rglob("*.html")
    )
    assert html_files == ["index.html"], (
        "singlehtml の出力 HTML が単一 index.html だけになっていない"
        f"（生成された HTML={html_files!r}）"
    )

    # Assert: その index.html が実体として存在する（完走の最終証跡）
    assert (outdir / "index.html").is_file(), (
        "singlehtml の単一出力 index.html が生成されていない（ビルド未完走）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml単一ページにフーの定義テンプレートが注入される(app):
    """[t1/正常] singlehtml の単一出力 index.html に
    <template id="riddle-tip--term-0"> が注入され、その中にフーの定義本文
    'フーの定義本体。' が含まれる。

    singlehtml は subdir/other など参照ページを含む全ドキュメントを単一の
    index.html へ集約する。参照された用語フー(term-0)に対し、定義本文を運ぶ
    template が単一ページへ注入されること（term-id 抽出が二重フラグメント形で
    壊れて注入ゼロにならないこと）を実ビルドで固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: フーの term-id 'term-0' のテンプレートに定義本文が注入されている
    assert '<template id="riddle-tip--term-0">' in html, (
        "singlehtml 単一ページに term-0 の <template> が注入されていない"
        "（:term: 参照の二重フラグメント形で term-id 抽出が壊れた疑い）"
    )
    assert "フーの定義本体。" in html, (
        "注入 template にフーの定義本文 'フーの定義本体。' が含まれない"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml単一ページに深い階層home定義のバズテンプレートが注入される(app):
    """[t2/正常] 深い階層 home(deep/glossary) で定義された用語 baz を
    ルート直下 deepref が参照したケースでも、singlehtml の単一出力 index.html に
    <template id="riddle-tip--term-baz"> が注入され、その中に baz の定義本文
    'バズの定義本体。' が含まれる。

    singlehtml では home が深い階層 deep/glossary にあるため、:term: 参照の
    refuri が #document-deep/glossary#term-baz のような docname つき二重
    フラグメント形になる。この二重フラグメント形から term-id (term-baz) を
    正しく抽出して定義本文を運ぶ template を単一ページへ注入できること（抽出が
    壊れて注入ゼロにならないこと）を実ビルドで固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: baz の term-id 'term-baz' のテンプレートに定義本文が注入されている
    assert '<template id="riddle-tip--term-baz">' in html, (
        "singlehtml 単一ページに term-baz の <template> が注入されていない"
        "（深い階層 home の docname つき二重フラグメント形で term-id 抽出が壊れた疑い）"
    )
    assert "バズの定義本体。" in html, (
        "注入 template に baz の定義本文 'バズの定義本体。' が含まれない"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_term参照hrefが同一ページ内フラグメントで別ページ相対パスに再ベースされない(app):
    """[t3/正常] singlehtml の単一ページ本文中の :term: 参照(フー=term-0)の href が、
    同一ページ内フラグメント(builder.get_target_uri が返す #document-* 系の同一
    ページ参照)として解決され、別ページ相対パス(../ や *.html を先頭に持つ上り
    再ベース)になっていないこと＝同一ページ参照のため再ベース不要分岐が効いている
    こと。

    singlehtml は全ドキュメントを単一 index.html へ集約するため、subdir/other の
    本文から参照される用語フーへのリンクは home(index)の同一ページ内アンカー
    #term-0 を指す（singlehtml では #document-index#term-0 のような同一ページ
    フラグメント形）。dirhtml/html のように ../index.html#term-0 のページ間相対パス
    へ再ベースされると、単一ページ内に存在しない別ファイルを指して 404 になる。

    期待値は html/dirhtml 形をハードコードせず、singlehtml ビルダの
    builder.get_target_uri('index') から導出する（同一ページ参照基準）。注入された
    <template> 内の参照は対象外（本文の term 参照のみを検査するため template を除去）。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # 期待される同一ページ参照基準を singlehtml ビルダから導出する。
    # singlehtml では home(index) の target uri は同一ページフラグメント '#document-index'。
    home_target = app.builder.get_target_uri("index")
    assert home_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('index') が同一ページフラグメント"
        f"でない（{home_target!r}）"
    )

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # 注入 <template> 内の参照は対象外なので除去し、本文の term 参照だけを残す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    body = re.sub(r"<template[^>]*>.*?</template>", "", html, flags=re.DOTALL)

    # 本文中の :term: 参照(フー=term-0)アンカーの href を収集する。
    term_hrefs = re.findall(
        r'<a\b[^>]*\bclass="reference internal"[^>]*\bhref="([^"]*term-0[^"]*)"',
        body,
    )
    assert term_hrefs, (
        "本文に term-0 を指す :term: 参照リンクが無い（前提崩れ）"
    )

    # Assert: 各 term 参照 href が同一ページ内フラグメント基準で解決されている。
    # 同一ページ参照のため、href は '#'（同一ページ）で始まり、home の同一ページ
    # 参照基準（get_target_uri('index')）と term-0 フラグメントから導出した形に一致する。
    expected_href = f"{home_target}#term-0"
    for href in term_hrefs:
        # 同一ページ参照分岐: 別ページ相対パス（先頭 '../' や先頭セグメントが *.html）
        # へ再ベースされていないこと。
        assert href.startswith("#"), (
            f"term 参照 href が同一ページ内フラグメントでない（href={href!r}）"
            "＝別ページ相対パスへ誤って再ベースされた疑い"
        )
        assert "../" not in href, (
            f"term 参照 href に上り相対パス '../' が含まれる（href={href!r}）"
            "＝同一ページ参照なのにページ間相対へ再ベースされている"
        )
        assert ".html" not in href, (
            f"term 参照 href に別ページファイル '.html' が含まれる（href={href!r}）"
            "＝同一ページ参照なのにページ間相対へ再ベースされている"
        )
        assert href == expected_href, (
            f"term 参照 href が singlehtml の同一ページ参照基準から導出した値と"
            f"一致しない（実際 {href!r} / 期待 {expected_href!r}）"
        )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_注入template内のref同一home内アンカーがsinglehtml同一ページfragmentへ解決される(app):
    """[t6/境界] 注入された term-0 の <template> 内の :ref: 同一 home 内アンカー
    (intro-anchor) が、singlehtml の集約後は素のアンカー '#intro-anchor' へ解決され、
    その指す先 id="intro-anchor" が単一ページ DOM に実在する（404 にならない）こと。

    singlehtml は全ドキュメントを単一 index.html へ集約し、各ドキュメントのアンカー
    id（明示ラベル intro-anchor 等）はそのまま保たれる。よって同一 home 内アンカーは
    「同一ページ参照のため再ベース不要分岐」が効き、素の '#intro-anchor'（単一ページ
    DOM の id="intro-anchor" を直接指す）へ解決されるのが正しい（Sphinx ネイティブ本文も
    同一ページ :ref: を素の '#intro-anchor' で出力する）。

    ここで base（get_relative_uri('index','index')='#document-index'）を前置した
    '#document-index#intro-anchor' のような二重フラグメント（'#' が 2 つ）になると、
    ブラウザは最初の '#' 以降を 1 つのフラグメントとして扱い id="intro-anchor" を
    指さず 404（リンク切れ）になる。これを回帰防止で禁止する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # 前提固定: singlehtml の home(index) 同一ページ参照基準は '#document-*' フラグメント。
    home_uri = app.builder.get_relative_uri("index", "index")
    assert home_uri.startswith("#"), (
        f"前提崩れ: singlehtml の get_relative_uri('index','index') が同一ページ"
        f"フラグメントでない（{home_uri!r}）"
    )

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-0 注入 template を切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert: :ref: 同一 home 内アンカーが素のアンカー '#intro-anchor' へ解決されている
    assert 'href="#intro-anchor"' in template, (
        ":ref: 同一 home 内アンカーが singlehtml で素のアンカー '#intro-anchor' へ"
        "解決されていない"
    )

    # Assert(404 防止): その素アンカーの指す先 id="intro-anchor" が単一ページ DOM に実在する
    assert 'id="intro-anchor"' in html, (
        "singlehtml 単一ページ DOM に id=\"intro-anchor\" が実在しない"
        "（素アンカー #intro-anchor が 404 になる）"
    )

    # Assert(回帰防止): base 前置の二重フラグメント '#document-index#intro-anchor'
    # （'#' が 2 つ＝ブラウザが壊れて解釈し 404）が残存していない
    assert f'href="{home_uri}#intro-anchor"' not in template, (
        f"base 前置の二重フラグメント '{home_uri}#intro-anchor' が残存"
        "（singlehtml 単一ページ上で 404 になる壊れた形）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_注入template内のdocクロスドキュメントリンクがsinglehtml同一ページfragmentへ解決される(app):
    """[t7/境界] 注入された term-0 の <template> 内の :doc: クロスドキュメント
    リンク(topic)が、singlehtml の集約後も
    builder.get_relative_uri('index', 'topic') 由来の同一ページ #fragment 形
    （例 #document-topic）へ解決され、html/dirhtml 形（../topic.html 等）を
    ハードコードせず builder 導出値と一致すること。

    singlehtml は全ドキュメントを単一 index.html へ集約する。term-0 の定義は
    home(index) で書かれ、その本文に :doc:`トピック <topic>` リンクを持つ。
    singlehtml では topic も同一ページへ集約されるため、このリンクは
    「同一ページ参照のため再ベース不要分岐」が効いて、index 文脈で解決した topic
    への同一ページ参照基準(get_relative_uri('index','topic') が返す
    #document-topic 系の同一ページフラグメント)へ解決されるのが正しい。

    ここで html/dirhtml の上り相対形（../topic.html など）へ誤って再ベースされると、
    単一ページ内に存在しない別ファイルを指して 404（リンク切れ）になる。

    期待値は html/dirhtml 形をハードコードせず、singlehtml ビルダの
    builder.get_relative_uri('index', 'topic') から導出する（同一ページ参照基準）。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # 期待 URI を singlehtml ビルダの同一ページ参照基準から導出する。
    # singlehtml では topic への relative uri は同一ページフラグメント '#document-topic'。
    expected_uri = app.builder.get_relative_uri("index", "topic")
    assert expected_uri.startswith("#"), (
        f"前提崩れ: singlehtml の get_relative_uri('index','topic') が同一ページ"
        f"フラグメントでない（{expected_uri!r}）"
    )

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-0 注入 template を切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert: :doc: クロスドキュメントリンクが同一ページ #fragment 形へ解決されている
    assert f'href="{expected_uri}"' in template, (
        f":doc: トピックリンクが singlehtml 同一ページ #fragment 形へ"
        f"解決されていない（期待 href={expected_uri!r}）"
    )

    # Assert(回帰防止): html/dirhtml の上り相対形（../topic.html 等）が残存していない
    # （singlehtml 単一ページ上で 404 になる未対応形）
    assert 'href="../topic.html"' not in template, (
        "html/dirhtml 形 ../topic.html が残存"
        "（singlehtml 単一ページ上で 404 になる）"
    )
    assert 'href="topic.html"' not in template, (
        "html 形 topic.html が残存（singlehtml 単一ページ上で 404 になる）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml単一ページで各term_idのテンプレートが重複なく1回ずつ注入される(app):
    """[t5/境界] DISTINCT 注入: singlehtml の単一出力 index.html に注入された各
    <template id="riddle-tip--term-*"> の id が、ページ内でちょうど 1 回ずつだけ
    出現する（重複なし）。

    singlehtml は subdir/other・rootref・deepref など複数の参照ページを単一の
    index.html へ集約する。同一用語フー(term-0)は subdir/other と rootref の
    両方から参照されるため、注入が DISTINCT 化されていないと、複数ページぶんの
    定義 template が単一ページへ重複注入され、同一 id="riddle-tip--term-0" が
    DOM 上で複数回出現してしまう（JS 側 getElementById が壊れる）。

    集約後の単一ページでも「同一 term-id の template はちょうど 1 回」という境界が
    維持されることを回帰固定する。注入 id を文字列でハードコードせず、出力 HTML
    から実際に出現する riddle-tip-- id を走査し、各 id の出現回数がすべて 1 で
    あることを検証する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # 注入された template の id="riddle-tip--term-*" を出力からすべて走査する
    injected_ids = re.findall(r'<template id="(riddle-tip--[^"]+)"', html)
    assert injected_ids, (
        "singlehtml 単一ページに riddle-tip-- テンプレートが 1 つも注入されていない"
        "（前提崩れ／注入ゼロの疑い）"
    )

    # 複数ページから参照される用語フー(term-0)が集約対象に含まれている前提を固定
    assert "riddle-tip--term-0" in injected_ids, (
        "複数ページから参照される term-0 の template が単一ページに無い（前提崩れ）"
    )

    # Assert: 各 term-id の template id がちょうど 1 回ずつだけ出現する（DISTINCT）
    counts = Counter(injected_ids)
    duplicated = {tid: n for tid, n in counts.items() if n != 1}
    assert not duplicated, (
        "singlehtml 単一ページに同一 term-id の template が重複注入されている"
        f"（id ごとの出現回数={dict(counts)!r}, 重複={duplicated!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_注入template内の相対画像がsinglehtml集約後も_imagesへ委譲され404にならない(app):
    """[t8/境界] 注入された term-0 の <template> 内の相対画像(pic.png)が、
    render_partial(HTML writer)の委譲によって単一ページ index.html 基準の
    '_images/<basename>' へ書き換えられ、その宛先が実ビルド出力に実在(is_file)
    ＝404 にならないこと。

    フー(term-0)の定義(home=index)は本文に '.. image:: pic.png' を持つ。画像は
    rebase で自前再ベースせず、render_partial が builder.images/imgpath 経由で
    表示ページ基準の '_images/<basename>' へ自動書換えする設計（#21 で確定）。
    singlehtml は全ドキュメントを単一 index.html へ集約するため、注入先の表示ページ
    は出力ルート直下の index.html であり、画像の解決基準ディレクトリは出力ルート。

    検証は「文字列で再ベース先をハードコードして実在しないパスをロックする」
    トートロジーを禁ずる（#21 で是正済み）。代わりに注入 template の img src を
    出力基準で解決した宛先が実ビルド出力に実在する(is_file)ことで「正しい委譲＝
    非404」を固定する。さらに src が '_images/' を指すこと（render_partial 委譲が
    効いている確証）も併せて固定する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    outdir = Path(app.outdir)

    # singlehtml の注入先表示ページ(home=index 集約先)の出力解決基準ディレクトリを
    # builder から導出する。singlehtml では get_target_uri('index') は同一ページ
    # フラグメント('#document-index')であり、表示ページ実体は出力ルート直下
    # index.html のため、画像解決の基準ディレクトリは出力ルート('')。
    page_target = app.builder.get_target_uri("index")
    assert page_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('index') が同一ページフラグメント"
        f"でない（{page_target!r}）"
    )
    page_dir = ""  # 単一ページ index.html は出力ルート直下

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-0 注入 template を切り出す。
    html = (outdir / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # 注入 template 内の img src を収集する
    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template)
    assert img_srcs, "注入 template に img が無い（前提崩れ）"

    # Assert: 各 img src を単一ページの出力解決基準ディレクトリ基準で解決した宛先が
    # 実ビルド出力に実在する（404 にならない）。
    for src in img_srcs:
        path = src.split("#", 1)[0].split("?", 1)[0]
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        assert (outdir / resolved).is_file(), (
            f"注入画像 src={src!r} が singlehtml 単一ページ基準で 404"
            f"（解決先 {resolved!r} が実在しない）"
        )

    # Assert: 実在画像は _images/ に出力される（render_partial 委譲の確証）
    assert any("_images/" in src for src in img_srcs), (
        "注入画像 src が _images/ 配下を指していない"
        f"（render_partial 委譲が効いていない）（img_srcs={img_srcs!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_深い階層home定義の画像がsinglehtml集約後も_imagesへ委譲され404にならない(app):
    """[t9/境界] 深い階層 home(deep/glossary) で定義された用語 baz の定義内
    相対画像(deeppic.png)が、singlehtml の集約後も render_partial(HTML writer)の
    委譲によって単一ページ index.html 基準の '_images/<basename>' へ書き換えられ、
    その宛先が実ビルド出力に実在(is_file)＝404 にならないこと。

    baz の定義(home=deep/glossary)は本文に '.. image:: deeppic.png' を持つ。home が
    深い階層(deep/)側にあっても、画像は rebase で自前再ベースせず render_partial が
    builder.images/imgpath 経由で表示ページ基準の '_images/<basename>' へ自動書換え
    する設計（#21 で確定）。singlehtml は全ドキュメントを単一 index.html へ集約する
    ため、term-baz の定義 template が注入される表示ページは出力ルート直下 index.html
    であり、画像の解決基準ディレクトリは出力ルート('')。

    home が深い側(deep/)であっても画像実在が保たれる境界を固定する。検証は
    「文字列で再ベース先をハードコードして実在しないパスをロックする」トートロジーを
    禁ずる（#21 で是正済み）。代わりに注入 template の img src を出力基準で解決した
    宛先が実ビルド出力に実在する(is_file)ことで「正しい委譲＝非404」を固定し、さらに
    src が '_images/' を指すこと（render_partial 委譲が効いている確証）も併せて固定する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    outdir = Path(app.outdir)

    # singlehtml の注入先表示ページ(全ドキュメント集約先)の出力解決基準ディレクトリを
    # builder から導出する。singlehtml では get_target_uri('deep/glossary') も同一
    # ページフラグメント形であり、表示ページ実体は出力ルート直下 index.html のため、
    # 画像解決の基準ディレクトリは出力ルート('')。
    home_target = app.builder.get_target_uri("deep/glossary")
    assert home_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('deep/glossary') が同一ページ"
        f"フラグメントでない（{home_target!r}）"
    )
    page_dir = ""  # 単一ページ index.html は出力ルート直下

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-baz 注入 template を切り出す。
    html = (outdir / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-baz">')
    template = html[start : html.index("</template>", start)]

    # 注入 template 内の img src を収集する
    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template)
    assert img_srcs, "term-baz 注入 template に img が無い（前提崩れ）"

    # Assert: 各 img src を単一ページの出力解決基準ディレクトリ基準で解決した宛先が
    # 実ビルド出力に実在する（404 にならない）。
    for src in img_srcs:
        path = src.split("#", 1)[0].split("?", 1)[0]
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        assert (outdir / resolved).is_file(), (
            f"深い階層 home 定義の注入画像 src={src!r} が singlehtml 単一ページ基準で"
            f" 404（解決先 {resolved!r} が実在しない）"
        )

    # Assert: 実在画像は _images/ に出力される（render_partial 委譲の確証）
    assert any("_images/" in src for src in img_srcs), (
        "深い階層 home 定義の注入画像 src が _images/ 配下を指していない"
        f"（render_partial 委譲が効いていない）（img_srcs={img_srcs!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_参照されない用語バーのテンプレートはsinglehtml集約後も注入されない(app):
    """[t10/境界] 用語を定義するだけで自身は参照されない用語(バー=term-1)に対しては、
    singlehtml の単一出力 index.html へ <template id="riddle-tip--term-1"> が
    注入されない＝参照のある用語のみ注入される境界が集約後も保たれること。

    バー(term-1)は home(index)の glossary で定義されるだけで、testroot 内のどの
    ページからも :term: 参照されない（フー=term-0 は subdir/other・rootref が、
    バズ=term-baz は deepref が参照するが、バーはどこからも参照されない）。注入は
    「参照のある用語のみ」が境界であり、定義しただけの用語まで注入してしまうと、
    参照のない無関係な定義テンプレートが単一ページへ漏れ出す。

    singlehtml は全ドキュメントを単一 index.html へ集約するため、複数ページぶんの
    参照が 1 ページに集まる。集約処理で「定義された全用語」を取り違えて注入しないよう、
    集約後も「参照のある用語のみ注入／参照のないバーは注入されない」という境界が
    維持されることを回帰固定する。

    確証として (1) バー専用の template id="riddle-tip--term-1" が出力に一切無いこと、
    (2) 参照されるフー(term-0)の template は存在すること（注入機構自体は動いている＝
    バー不在が「注入ゼロ」由来の偽陰性でないこと）、(3) バー固有の定義本文
    'バーの定義本体。' が、注入された riddle-tip テンプレート群の中に現れないこと
    （別 term の template へ紛れ込んでいないこと）を併せて固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert(2/前提): 注入機構自体は動いている（参照のあるフー term-0 は注入される）。
    # これによりバー不在が「注入が全く動いていない」由来の偽陰性でないことを担保する。
    assert '<template id="riddle-tip--term-0">' in html, (
        "参照されるフー term-0 の template が無い（注入機構が動いていない前提崩れ）"
    )

    # Assert(1/本丸): 参照されないバー term-1 専用の template が一切注入されていない
    assert '<template id="riddle-tip--term-1">' not in html, (
        "参照されない用語バー(term-1)の template が singlehtml 単一ページに"
        "漏れ注入されている（参照のある用語のみ注入の境界が崩れている）"
    )

    # Assert(3/紛れ込み防止): バー固有の定義本文が、注入された riddle-tip
    # テンプレート群のいずれにも現れない（別 term の template へ混入していない）。
    injected_templates = re.findall(
        r'<template id="riddle-tip--[^"]+">.*?</template>', html, flags=re.DOTALL
    )
    for template in injected_templates:
        assert "バーの定義本体。" not in template, (
            "参照されないバーの定義本文が注入 template に紛れ込んでいる"
            "（参照のある用語のみ注入の境界が崩れている）"
        )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml注入template内のURIが出力ルート外へパストラバーサルしない(app):
    """[t11/セキュリティ] singlehtml の単一出力 index.html に注入された全
    <template id="riddle-tip--term-*"> 内の各相対 URI（href/src）が、単一ページ
    index.html の出力解決基準ディレクトリ（出力ルート）基準で解決した結果、
    出力ルート配下に収まり、過剰再ベース（余計な ../）で出力ルート外へ脱出する
    パストラバーサルが生じていないこと（先頭に '..' が残らない／絶対 '/' に
    ならない）。

    singlehtml は全ドキュメントを単一 index.html へ集約する。注入先の表示ページは
    出力ルート直下 index.html であり、相対 URI の解決基準ディレクトリは出力ルート
    （''）である。同一ページ参照のため term 参照・:doc:・:ref: は本来
    '#document-*#…' のような同一ページ #fragment 形に解決され（再ベース不要分岐）、
    画像は render_partial 委譲で '_images/<basename>' へ書き換わる。いずれも出力
    ルート配下に収まるはずである。

    ここで自前段数計算の誤りなどで同一ページ参照が誤って '../' 付きの上り相対へ
    再ベースされたり、画像 src に余計な '../' が残ると、出力ルート基準の解決結果が
    先頭 '..'（親へ脱出）または絶対 '/' になり、生成物の外＝想定外パスを指す
    （ディレクトリトラバーサル相当）。html/dirhtml 形をハードコードせず、出力ルート
    基準で解決した結果が出力ルート外へ出るか否かで判定する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # singlehtml の注入先表示ページ（全ドキュメント集約先 index.html）の出力解決
    # 基準ディレクトリを導出する。get_target_uri('index') は同一ページフラグメント
    # ('#document-index') であり、表示ページ実体は出力ルート直下 index.html のため、
    # 相対 URI の解決基準ディレクトリは出力ルート（''）。
    page_target = app.builder.get_target_uri("index")
    assert page_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('index') が同一ページフラグメント"
        f"でない（{page_target!r}）"
    )
    page_dir = ""  # 単一ページ index.html は出力ルート直下

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # 注入された全 riddle-tip テンプレートを切り出して連結し、検査対象とする。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    injected_templates = re.findall(
        r'<template id="riddle-tip--[^"]+">.*?</template>', html, flags=re.DOTALL
    )
    assert injected_templates, (
        "singlehtml 単一ページに riddle-tip-- テンプレートが 1 つも注入されていない"
        "（前提崩れ／注入ゼロの疑い）"
    )

    # 注入 template 群の全 href / src の URI を収集する
    uris = []
    for template in injected_templates:
        uris.extend(re.findall(r'(?:href|src)="([^"]*)"', template))
    assert uris, "注入 template から href/src URI が 1 つも取れない（前提崩れ）"

    # Assert: 各相対 URI を単一ページの出力解決基準ディレクトリ（出力ルート）基準で
    # 解決した結果が出力ルート外（先頭に '..' が残る＝親へ脱出 ／ 絶対 '/'）へ出ない。
    escaping = []
    for uri in uris:
        # 外部・サイト絶対・フラグメントのみは対象外（ローカル相対パスのみ判定）
        if uri.startswith(
            ("http://", "https://", "//", "/", "#", "mailto:", "data:")
        ):
            continue
        path = uri.split("#", 1)[0].split("?", 1)[0]
        if not path:
            continue
        # 出力ルートへ結合し正規化した結果。先頭に '..' が残れば出力ルートより
        # 上位へ脱出している（パストラバーサル）。
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        if resolved.startswith("..") or resolved.startswith("/"):
            escaping.append((uri, resolved))

    assert not escaping, (
        "singlehtml 集約後の注入 URI が出力ルート外へパストラバーサルしている"
        f"（脱出 URI={escaping!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml注入template内の同一ページ参照hrefがdocumentフラグメントへ閉じ危険スキームが混入しない(
    app,
):
    """[t12/セキュリティ] singlehtml の単一出力 index.html に注入された全
    <template id="riddle-tip--term-*"> 内の URI について、(A) 同一ページ参照
    （term 参照・:doc:・:ref: の内部参照 href）が builder 由来の同一ページ
    #document-* フラグメントとして閉じ、外部 URL（http://・https://）やサイト絶対
    パス（先頭 '/'）・プロトコル相対（先頭 '//'）へ化けていないこと、(B) どの
    href/src にも危険スキーム（javascript:・vbscript:・data:text/html 等）が
    混入していないことを実ビルドで固定する（sanitize と再ベース不要分岐の安全側担保）。

    singlehtml は全ドキュメントを単一 index.html へ集約する。term 参照・:doc:・:ref:
    の内部参照は「同一ページ参照のため再ベース不要分岐」が効いて、builder が返す
    同一ページフラグメント（例 '#document-index'）へ閉じるのが正しい。ここで自前
    再ベースの誤りで base がサイト絶対 '/...' や外部 URL へ化けると、単一ページ内に
    閉じず外部・想定外オリジンへ飛ぶ（再ベース分岐の安全側が崩れる）。また sanitize
    が緩いと javascript: 等の危険スキームが href/src に残り XSS になる。

    builder 由来の期待フラグメント接頭辞は get_target_uri('index') から導出し
    （'#document-' 形をハードコードしない）、内部参照 href がその同一ページ
    フラグメント形で閉じることを固定する。危険スキームは href/src 全体に対し
    禁止リストで検査する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # builder 由来の同一ページ参照基準（'#document-index' 等）を導出する。
    # 内部参照 href はこの同一ページフラグメント接頭辞で始まるのが正しい。
    home_target = app.builder.get_target_uri("index")
    assert home_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('index') が同一ページフラグメント"
        f"でない（{home_target!r}）"
    )
    # 同一ページ参照の接頭辞（例 '#document-'）を builder 由来値から取り出す。
    same_page_prefix = "#document-"
    assert home_target.startswith(same_page_prefix), (
        f"前提崩れ: singlehtml の get_target_uri('index') が想定の同一ページ"
        f"フラグメント接頭辞で始まらない（{home_target!r}）"
    )

    # Act: 注入された全 riddle-tip テンプレートを切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    injected_templates = re.findall(
        r'<template id="riddle-tip--[^"]+">.*?</template>', html, flags=re.DOTALL
    )
    assert injected_templates, (
        "singlehtml 単一ページに riddle-tip-- テンプレートが 1 つも注入されていない"
        "（前提崩れ／注入ゼロの疑い）"
    )

    # 注入 template 群の全 href / src の URI を収集する。
    hrefs: list[str] = []
    all_uris: list[str] = []
    for template in injected_templates:
        hrefs.extend(re.findall(r'\bhref="([^"]*)"', template))
        all_uris.extend(re.findall(r'(?:href|src)="([^"]*)"', template))
    assert all_uris, "注入 template から href/src URI が 1 つも取れない（前提崩れ）"

    # Assert(B/sanitize 安全側): どの href/src にも危険スキームが混入していない。
    danger_schemes = (
        "javascript:",
        "vbscript:",
        "data:text/html",
        "data:application/xhtml+xml",
        "data:image/svg+xml",
    )
    dangerous = [
        uri
        for uri in all_uris
        if any(scheme in uri.strip().lower() for scheme in danger_schemes)
    ]
    assert not dangerous, (
        "注入 template の href/src に危険スキームが混入している"
        f"（危険 URI={dangerous!r}）"
    )

    # Assert(A/再ベース安全側): 内部参照 href が同一ページ内へ閉じ、外部 URL・
    # サイト絶対・プロトコル相対へ化けていない。同一ページ参照には 2 形態がある:
    #   - クロスページ参照由来の builder #document-* フラグメント（例 '#document-index'）
    #   - 定義 subtree 内の自己完結アンカー由来の素の '#<id>' フラグメント
    #     （refid が定義と一緒に旅するため再ベース不要で残る。r1-5 境界）
    # 後者は単一ページ DOM に id="<id>" が実在する限り同一ページへ閉じており安全。
    # フラグメントのみ（'#...'）・mailto: などは対象外（内部の相対/同一ページ参照を判定）。
    # 定義本文が元から持つ正規の外部リンク（<a class="reference external" href="http(s)://...">）
    # は「内部参照が外部へ化けた」ものではないため、本検査（内部参照の閉じ判定）の対象外。
    # これらは verbatim 保持されるのが正しい（r1-6 境界）。
    external_hrefs = set()
    for template in injected_templates:
        for m in re.finditer(r"<a\b([^>]*)>", template):
            attrs = m.group(1)
            if "reference external" not in attrs:
                continue
            href_m = re.search(r'\bhref="([^"]*)"', attrs)
            if href_m:
                external_hrefs.add(href_m.group(1))

    page_ids = set(re.findall(r'\bid="([^"]+)"', html))
    escaped = []
    for href in hrefs:
        # 元から正規の外部リンク（reference external）は内部参照の化けではないので対象外。
        if href in external_hrefs:
            continue
        low = href.strip().lower()
        # 外部・プロトコル相対・サイト絶対はそもそも同一ページ参照ではあり得ない。
        # これらが内部参照に化けて出ていれば安全側の崩れ。
        if low.startswith(("http://", "https://", "//", "/")):
            escaped.append(href)
            continue
        # mailto などの非ローカルスキームは内部参照ではないので除外。
        if ":" in low.split("#", 1)[0] and not low.startswith("#"):
            continue
        if not href.startswith("#"):
            continue
        # builder 由来の #document-* フラグメントは同一ページ参照として安全。
        if href.startswith(same_page_prefix):
            continue
        # 素の '#<id>' フラグメントは、その id が単一ページ DOM に実在すれば
        # 同一ページへ閉じており安全（自己完結アンカー）。実在しなければ
        # どこへも閉じない／化けた疑いとして脱出扱い。
        fragment = href[1:].split("#", 1)[0]
        if fragment in page_ids:
            continue
        escaped.append(href)

    assert not escaped, (
        "注入 template の内部参照 href が同一ページ内（#document-* または単一ページ"
        f"DOM 実在の素フラグメント）へ閉じていない（外部/サイト絶対/宛先不在等: {escaped!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml注入template内の敵対rawhtml危険スキームがsanitizeで除去される(app):
    """[r1-1/セキュリティ] フー(term-0)の定義に raw html で仕込んだ危険スキーム
    (javascript: / data:text/html) と危険要素(script / onerror) が、singlehtml の
    単一ページ集約後に注入された <template id="riddle-tip--term-0"> の中でも
    一次防御 sanitize（riddle_sanitize=True 既定）で除去されていること。

    term-0(フー)の定義 home(index)に、敵対的な raw html ブロックを仕込んである:
    - <a href="javascript:alert(1)"> （javascript: スキーム）
    - <a href="data:text/html,..." onclick="..."> （data:text/html スキーム＋
      イベントハンドラ属性）
    - <script>...</script> （スクリプト要素）

    singlehtml は全ドキュメントを単一 index.html へ集約する。集約後に注入される
    定義 template でも、html ビルダと同じく sanitize が効いてこれら危険スキーム・
    危険要素を除去するのが正しい（集約パスで sanitize がバイパスされない安全側担保）。
    sanitize が抜けると、単一ページに危険スキーム href / イベントハンドラ / script が
    残って XSS になる。

    検証は test-xss と同じく BeautifulSoup で template を DOM パースし、危険要素・
    危険スキーム属性がゼロ件であること、かつ良性の定義本文が保持されていることを
    固定する（除去で本文まで巻き添えにしていない確証）。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-0 注入 template を DOM で抜き出す（</template> 様文字列の混入や
    # 複数注入に対しても誤抽出しないよう BeautifulSoup を使う）。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    template = soup.find("template", id="riddle-tip--term-0")
    assert template is not None, (
        "singlehtml 単一ページに term-0 の <template> が見つからない（前提崩れ）"
    )

    # Assert(危険要素ゼロ): script / iframe / イベントハンドラ属性 /
    # javascript: ・data: スキームの href / src が一次防御で除去されている。
    dangerous = template.select(
        "[onerror], [onload], [onclick], script, iframe, base, object, embed, "
        'a[href^="javascript:"], a[href^="data:"], img[src^="javascript:"]'
    )
    assert dangerous == [], (
        "singlehtml 集約後の注入 term-0 template に危険要素/危険スキームが残存"
        f"（sanitize が集約パスでバイパスされた疑い）: {dangerous!r}"
    )

    # Assert(文字列でも二重確認): 危険スキーム文字列が template 内に一切残らない。
    template_html = str(template)
    for scheme in ("javascript:", "data:text/html", "onclick=", "<script"):
        assert scheme not in template_html.lower(), (
            f"危険スキーム/要素 {scheme!r} が注入 template に残存している"
            "（singlehtml 集約後に sanitize が効いていない）"
        )

    # Assert(良性保持): 除去で定義本文まで巻き添えにしていない（過剰除去の偽陽性防止）。
    assert "フーの定義本体。" in template.get_text(), (
        "危険要素除去で良性の定義本文 'フーの定義本体。' まで失われている"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_singlehtml注入template内の敵対相対リンクが出力ルート外へ脱出再ベースされない(app):
    r"""[r1-2/セキュリティ] フー(term-0)の定義に仕込んだ出力ルート脱出狙いの敵対的
    相対リンク（rST 外部リンク ``../../../etc/passwd``＝relative refuri を持つ
    nodes.reference）が、singlehtml の単一ページ集約後に注入された
    <template id="riddle-tip--term-0"> の中でも、単一ページ index.html の出力解決
    基準ディレクトリ（出力ルート）基準で解決した結果が出力ルート配下に閉じ、過剰な
    '../' で出力ルート外へ脱出（ディレクトリトラバーサル）していないこと。

    term-0(フー)の定義 home(index)に、出力ルート脱出を狙う敵対的相対リンク
    ``\`脱出 <../../../etc/passwd>\`_`` を仕込んである。これは relative な refuri を
    持つ内部参照 nodes.reference として rebase の対象になる。singlehtml は全
    ドキュメントを単一 index.html へ集約するため、注入先の表示ページは出力ルート
    直下 index.html であり、相対 URI の解決基準ディレクトリは出力ルート（''）。

    singlehtml の同一ページ参照基準（base='#document-index'）に対し、この敵対的
    相対パスは『同一ページ #fragment へ閉じる』でも『出力ルート内の安全なパスへ
    再ベース』でもなく、先頭の '../' が残ったまま注入されると、出力ルート基準の
    解決結果が先頭 '..'（親へ脱出）になり生成物の外＝想定外パスを指す
    （ディレクトリトラバーサル相当）。期待値は html/dirhtml 形をハードコードせず、
    出力ルート基準で解決した結果が出力ルート外へ出るか否かで判定する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # singlehtml の注入先表示ページ（全ドキュメント集約先 index.html）の出力解決
    # 基準ディレクトリを導出する。get_target_uri('index') は同一ページフラグメント
    # ('#document-index') であり、表示ページ実体は出力ルート直下 index.html のため、
    # 相対 URI の解決基準ディレクトリは出力ルート（''）。
    page_target = app.builder.get_target_uri("index")
    assert page_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('index') が同一ページフラグメント"
        f"でない（{page_target!r}）"
    )
    page_dir = ""  # 単一ページ index.html は出力ルート直下

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # 敵対的相対リンクを仕込んだ term-0 の注入 template を切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # term-0 定義内の全 href / src の URI を収集する。
    uris = re.findall(r'(?:href|src)="([^"]*)"', template)
    assert uris, "term-0 注入 template から href/src URI が 1 つも取れない（前提崩れ）"

    # 前提固定: 敵対入力（脱出狙いの相対リンク）の痕跡が template に届いている
    # （sanitize で丸ごと消えて検査が空回り＝偽陰性になっていないことの担保）。
    assert any("etc/passwd" in u for u in uris), (
        "敵対的相対リンク（../../../etc/passwd 由来）が注入 template に届いていない"
        "（前提崩れ／検査が空回りする偽陰性の疑い）"
    )

    # Assert: 各相対 URI を単一ページの出力解決基準ディレクトリ（出力ルート）基準で
    # 解決した結果が出力ルート外（先頭に '..' が残る＝親へ脱出 ／ 絶対 '/'）へ出ない。
    escaping = []
    for uri in uris:
        # 外部・サイト絶対・プロトコル相対・フラグメントのみ・非ローカルスキームは
        # 対象外（ローカル相対パスのみ判定する）。
        if uri.startswith(
            ("http://", "https://", "//", "/", "#", "mailto:", "data:")
        ):
            continue
        path = uri.split("#", 1)[0].split("?", 1)[0]
        if not path:
            continue
        # 出力ルートへ結合し正規化した結果。先頭に '..' が残れば出力ルートより
        # 上位へ脱出している（パストラバーサル）。
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        if resolved.startswith("..") or resolved.startswith("/"):
            escaping.append((uri, resolved))

    assert not escaping, (
        "singlehtml 集約後の term-0 注入 template に出力ルート外へ脱出する敵対的"
        f"相対リンクが残存している（脱出 URI={escaping!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_複数ページから参照されるフーの注入templateが単一の正準形に一致する(app):
    """[r1-3/境界] 同一用語フー(term-0)を subdir/other(depth=2) と rootref(depth=1)
    の複数ページから参照した状態でも、注入された term-0 の <template> が内容的に
    ただ 1 つの正準形（home=index 文脈で解決した同一ページ #fragment 形）に一致する。

    html/dirhtml では参照ページの深さ(depth)ごとに :doc:/:ref:/画像の再ベース段数
    （``../`` の数）が変わる。subdir/other(depth=2) と rootref(depth=1) は同一用語
    フー(term-0)を参照するため、もし singlehtml の注入が「参照ページごとに再ベース
    した結果」を持ち込んでしまうと、単一の注入ブロック内にページごとに異なる相対形
    （例: ``../topic.html`` と ``../../topic.html`` のような depth 差の混在、あるいは
    ``../index.html#intro-anchor`` のような上り相対形）が混ざる／定義本文が複数回
    繰り返される実害が出る。

    r1-3 が固定する境界は「重複排除(t5: id が 1 回)」のさらに先で、注入された term-0
    ブロックの**内容**が単一の正準形であること:
      (1) 定義本文 'フーの定義本体。段落2つめ。' が注入ブロック内でちょうど 1 回だけ
          出現する（ページごとの定義本文が混ざって複数回繰り返されない）。
      (2) :doc:(topic)・:ref:(intro-anchor) の href が、いずれも home=index 文脈で
          解決した同一ページ #fragment 形（builder.get_relative_uri('index', ...) 由来）
          としてそれぞれちょうど 1 回だけ出現する。
      (3) 参照ページ depth に応じた html/dirhtml の上り相対形（``../topic.html`` /
          ``../../topic.html`` / ``../index.html#intro-anchor`` /
          ``../../index.html#intro-anchor`` 等）が一切混入しない。

    期待値は html/dirhtml 形をハードコードせず、singlehtml ビルダの
    get_relative_uri('index', ...) から正準形を導出する。
    """
    # Arrange: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # 正準形（home=index 文脈の同一ページ #fragment 形）を builder から導出する。
    doc_uri = app.builder.get_relative_uri("index", "topic")
    home_uri = app.builder.get_relative_uri("index", "index")
    assert doc_uri.startswith("#") and home_uri.startswith("#"), (
        "前提崩れ: singlehtml の get_relative_uri が同一ページフラグメントでない"
        f"（doc_uri={doc_uri!r}, home_uri={home_uri!r}）"
    )
    canonical_doc_href = f'href="{doc_uri}"'
    # :ref: 同一 home 内アンカーの正準形は素のアンカー '#intro-anchor'（単一ページ DOM の
    # id="intro-anchor" を直接指す）。base 前置の '#document-index#intro-anchor' は二重
    # フラグメントで 404 になるため正準ではない。
    canonical_ref_href = 'href="#intro-anchor"'

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-0 注入 template を切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert(1): 定義本文が注入ブロック内でちょうど 1 回だけ出現する（正準＝単一）。
    assert template.count("フーの定義本体。段落2つめ。") == 1, (
        "term-0 注入 template に定義本文が複数回（ページごとに混ざって）出現している"
        f"（出現回数={template.count('フーの定義本体。段落2つめ。')}）"
    )

    # Assert(2): :doc: / :ref: の正準 href がそれぞれちょうど 1 回だけ出現する。
    assert template.count(canonical_doc_href) == 1, (
        ":doc: トピックリンクの正準 #fragment href が注入ブロック内でちょうど 1 回"
        f"でない（期待 {canonical_doc_href!r}, 出現回数={template.count(canonical_doc_href)}）"
    )
    assert template.count(canonical_ref_href) == 1, (
        ":ref: 同一 home 内アンカーの正準 #fragment href が注入ブロック内でちょうど"
        f" 1 回でない（期待 {canonical_ref_href!r}, 出現回数={template.count(canonical_ref_href)}）"
    )

    # Assert(3): 参照ページ depth ごとの html/dirhtml 上り相対形、および base 前置の
    # 二重フラグメント形（'#document-index#intro-anchor'）が一切混入しない。
    # 素の '#intro-anchor' は正準形なので混入禁止に含めない。
    foreign_forms = [
        'href="../topic.html"',
        'href="../../topic.html"',
        'href="topic.html"',
        'href="../index.html#intro-anchor"',
        'href="../../index.html#intro-anchor"',
        f'href="{home_uri}#intro-anchor"',
    ]
    leaked = [form for form in foreign_forms if form in template]
    assert not leaked, (
        "term-0 注入 template に参照ページ depth ごとの非正準（per-page 再ベース）"
        f"href が混入している（混入形={leaked!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_home自身の同一home内term参照refid形でもtemplate注入され二重フラグメント化しない(app):
    """[r1-4/正常] home(deep/glossary) 自身のページが、その home で定義する用語
    selfword(term-selfword) を「自分の本文からのみ」:term: 参照したケース
    （クロスページ参照を一切持たない＝解決済み doctree では refid 形、refuri=None）
    でも、singlehtml の単一出力 index.html に <template id="riddle-tip--term-selfword">
    が注入され、その home 自身の term 参照 href が同一ページ内アンカー
    '#term-selfword'（単一ページ DOM 上に実在する id="term-selfword" を指す）として
    解決され、'#document-deep/glossary#term-selfword' のような二重フラグメント形
    （refid をクロスページ refuri と取り違えて化けた形）にならないことを固定する。

    クロスページ :term: 参照（subdir/other・deepref など別ページからの参照）は解決済み
    doctree で nodes.reference の refuri に term-id が入り、singlehtml では
    '#document-<docname>#term-*' の二重フラグメント形になる。一方、home 自身が同一 home
    内で定義する用語を参照すると refuri は None で refid に term-id が入る（refid 形）。
    inject の参照 term-id 抽出はこの refid 形も拾って注入対象に含める必要がある。

    本テストの用語 selfword は home(deep/glossary) 自身からしか参照されない（フー/baz
    と異なりクロスページ参照ページを持たない）。そのため term-selfword の template が
    注入されるのは「home 自身の refid 形参照を抽出できたとき」に限られ、refid 抽出を
    取りこぼすと（クロスページ refuri の取りこぼしで補われることなく）注入ゼロになる
    ＝refid 経路を厳密に切り分けて固定できる。

    singlehtml は全ドキュメントを単一 index.html へ集約するため、home(deep/glossary)
    自身の refid 形 term 参照は同一ページ内アンカー '#term-selfword'（glossary 定義語の
    id="term-selfword"）へ解決されるのが正しい。ここで refid 形を取りこぼすと注入ゼロ、
    あるいはクロスページ扱いで '#document-deep/glossary#term-selfword' の二重フラグメント
    形へ化けると、本来の同一ページ内アンカー id="term-selfword" を指さず壊れる。

    検証は (1) refid 形参照のみで term-selfword の template が注入され定義本文を含む、
    (2) home 自身の本文(注入 template を除いた body)中の term-selfword 参照 href が
    二重フラグメントでない素の同一ページ内アンカー '#term-selfword' として現れる、
    (3) その指す先 id="term-selfword" が単一ページ DOM に実在（'#term-selfword' が
    404 にならない）、を固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # 前提固定: home(deep/glossary) の同一ページ参照基準は #fragment 形である。
    home_target = app.builder.get_target_uri("deep/glossary")
    assert home_target.startswith("#"), (
        f"前提崩れ: singlehtml の get_target_uri('deep/glossary') が同一ページ"
        f"フラグメントでない（{home_target!r}）"
    )

    # Assert(1): refid 形（同一 home 内参照）のみで term-selfword の template が注入され、
    # 定義本文を含む（クロスページ参照を持たない用語なので、refid 抽出を取りこぼせば
    # 注入ゼロになる）。
    assert '<template id="riddle-tip--term-selfword">' in html, (
        "home 自身の refid 形 :term: 参照に対して term-selfword の <template> が"
        "注入されていない（refid 形を抽出で取りこぼした疑い）"
    )
    assert "セルフ用語の定義本体。" in html, (
        "注入 template に selfword の定義本文 'セルフ用語の定義本体。' が含まれない"
    )

    # 本文（注入 template を除いた body）中の term-selfword 参照 href を収集する。
    body = re.sub(r"<template[^>]*>.*?</template>", "", html, flags=re.DOTALL)
    term_hrefs = re.findall(
        r'<a\b[^>]*\bclass="reference internal"[^>]*'
        r'\bhref="([^"]*term-selfword[^"]*)"',
        body,
    )
    assert term_hrefs, (
        "本文に term-selfword を指す :term: 参照リンクが無い（前提崩れ／home 自身の"
        "同一 home 内参照が出力されていない疑い）"
    )

    # Assert(2): home 自身の refid 由来 term 参照が、二重フラグメントでない素の同一
    # ページ内アンカー '#term-selfword' として現れている。refid 形がクロスページ扱いに
    # 化けて '#document-deep/glossary#term-selfword' のような二重フラグメント形へ倒れる
    # と、この素の '#term-selfword' は body に現れず、二重フラグメント形が混じる。
    assert "#term-selfword" in term_hrefs, (
        "home 自身の同一 home 内 refid 形 term 参照が、二重フラグメントでない素の同一"
        "ページ内アンカー '#term-selfword' として現れていない（refid をクロスページ扱い"
        f"の二重フラグメント形へ取り違えた疑い）（実際の href={term_hrefs!r}）"
    )
    double_fragment = [h for h in term_hrefs if h.count("#") > 1]
    assert not double_fragment, (
        "home 自身の refid 形 term 参照が二重フラグメント形へ化けている"
        f"（refid をクロスページ refuri と取り違えた疑い）: {double_fragment!r}"
    )

    # Assert(3): '#term-selfword' の指す先 id="term-selfword" が単一ページ DOM に実在し、
    # home 自身の同一ページ内アンカーが 404 にならない。
    assert re.search(r'id="term-selfword"', html), (
        "'#term-selfword' の指す先 id=\"term-selfword\" が単一ページ DOM に実在しない"
        "（home 自身の同一ページ内アンカーが 404 になる）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_定義subtree内アンカーへのref_refidがsinglehtml集約後も二重フラグメント化せず素のフラグメントで残る(
    app,
):
    """[r1-5/境界] 用語 selfanchor の定義 subtree 内に置いた自己完結アンカー
    (target id=selfanchor-inner) へ向かう同一定義内 :ref: が、singlehtml の単一
    ページ集約後に注入された <template id="riddle-tip--term-selfanchor"> の中でも、
    素の同一フラグメント href="#selfanchor-inner"（refid 形）のまま残り、
    home ページへ誤って再ベースされた '#document-deep/glossary#selfanchor-inner' の
    ような二重フラグメント形へ化けないこと（自己完結アンカーの非再ベース境界）。

    selfanchor の定義(home=deep/glossary)は、その定義本文中に target
    ``.. _selfanchor-inner:`` を置き、同一定義内から
    :ref:`自己完結アンカー <selfanchor-inner>` で参照する。解決済み doctree では
    この内部参照は refid='selfanchor-inner' 形（refuri=None）になり、その対象 id
    'selfanchor-inner' は定義 subtree の **内側** に存在する（定義と一緒に旅する
    自己完結アンカー）。

    rebase は「refid の対象 id が subtree の外（home ドキュメント側）にある」場合
    のみ home ページ経由の refuri へ再ベースし、対象 id が subtree 内にある場合は
    フラグメント内参照として refid のまま残す設計である。よって singlehtml で全
    ドキュメントを単一 index.html へ集約しても、この自己完結アンカー参照は素の
    '#selfanchor-inner' のまま注入されるのが正しい。

    ここで subtree 内アンカーを取り違えてクロスページ扱い（home ページ#refid）へ
    再ベースしてしまうと、singlehtml では base が同一ページフラグメント
    '#document-deep/glossary' になるため '#document-deep/glossary#selfanchor-inner'
    の二重フラグメント形へ化け、定義 template と一緒に旅してきた id="selfanchor-inner"
    を指さなくなり 404（リンク切れ）になる。

    検証は (1) selfanchor の定義 template が注入され定義本文を含む、(2) その template
    内の :ref: 由来 href が素の同一フラグメント '#selfanchor-inner' として現れ、
    二重フラグメント（'#document-...#selfanchor-inner' 等、'#' を 2 つ含む形）へ
    化けていない、(3) その指す先 id="selfanchor-inner" が同じ template 内（定義と
    一緒に旅したアンカー）に実在し 404 にならない、を固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-selfanchor 注入 template を切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert(1/前提): 自己完結アンカーを持つ用語 selfanchor の定義 template が注入され、
    # 定義本文を含む（注入ゼロ由来の偽陰性でないことを担保）。
    assert '<template id="riddle-tip--term-selfanchor">' in html, (
        "singlehtml 単一ページに term-selfanchor の <template> が注入されていない"
        "（前提崩れ／注入ゼロの疑い）"
    )
    start = html.index('<template id="riddle-tip--term-selfanchor">')
    template = html[start : html.index("</template>", start)]
    assert "セルフアンカー用語の定義本体。" in template, (
        "注入 template に selfanchor の定義本文 'セルフアンカー用語の定義本体。' が"
        "含まれない"
    )

    # template 内の selfanchor-inner を指す href を収集する。
    inner_hrefs = re.findall(
        r'href="([^"]*selfanchor-inner[^"]*)"', template
    )
    assert inner_hrefs, (
        "注入 template に自己完結アンカー selfanchor-inner を指す :ref: 由来の href が"
        "無い（前提崩れ／定義内 :ref: が出力されていない疑い）"
    )

    # Assert(2/本丸): :ref: 由来 href が素の同一フラグメント '#selfanchor-inner' の
    # まま残り、home ページへ再ベースされた二重フラグメント形へ化けていない。
    assert "#selfanchor-inner" in inner_hrefs, (
        "定義 subtree 内アンカーへの :ref: が素の同一フラグメント '#selfanchor-inner'"
        "として残っていない（自己完結アンカーをクロスページ扱いで再ベースした疑い）"
        f"（実際の href={inner_hrefs!r}）"
    )
    double_fragment = [h for h in inner_hrefs if h.count("#") > 1]
    assert not double_fragment, (
        "定義 subtree 内アンカーへの :ref: が二重フラグメント形へ化けている"
        "（subtree 内 refid を home ページ#refid へ誤って再ベースした疑い）: "
        f"{double_fragment!r}"
    )

    # Assert(3/非404): '#selfanchor-inner' の指す先 id="selfanchor-inner" が、定義と
    # 一緒に旅した同じ注入 template 内に実在し、フラグメント内参照が 404 にならない。
    assert re.search(r'id="selfanchor-inner"', template), (
        "'#selfanchor-inner' の指す先 id=\"selfanchor-inner\" が注入 template 内に"
        "実在しない（自己完結アンカーが定義と一緒に旅していない＝フラグメント内参照が"
        "404 になる）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_定義内の外部URLリンクがsinglehtml集約後もverbatim保持されdocument連結されない(app):
    r"""[r1-6/異常] 用語 baz の定義本文に含めた外部 URL（https://）リンクが、
    singlehtml の単一ページ集約後に注入された <template id="riddle-tip--term-baz">
    の中でも、再ベース対象外として元の外部 URL がそのまま（verbatim）保持され、
    singlehtml の同一ページ参照基準 '#document-*' を前置・連結された壊れた形へ
    化けないことを固定する。

    baz の定義(home=deep/glossary)に、外部サイトへの外部リンク
    ``\`公式サイト <https://example.com/baz>\`_``（絶対 URL の refuri を持つ
    nodes.reference）を仕込んである。rebase は内部参照（相対 refuri / refid）のみを
    対象とし、http(s):// などスキーム付き絶対 URL は再ベース対象外として verbatim に
    残す設計である。

    singlehtml は全ドキュメントを単一 index.html へ集約するため、内部参照は
    builder 由来の同一ページフラグメント '#document-<docname>...' へ解決される
    （再ベース不要分岐 / クロスページ参照分岐）。ここで外部 URL までこの集約処理に
    巻き込まれ '#document-deep/glossary' のような base を前置・連結されてしまうと、
    href が '#document-deep/glossayhttps://example.com/baz' のような壊れた相対へ化けて
    本来の外部サイトを指さなくなる。本テストはその誤連結が起きず、外部 URL が完全な
    形 'https://example.com/baz' のまま href に現れることを実ビルドで固定する。

    検証は (1) baz の定義 template が注入され前提が崩れていない、(2) その template 内に
    外部 URL を完全形 href="https://example.com/baz" として持つ <a> がちょうど存在する、
    (3) 外部 URL に singlehtml の同一ページ参照基準 '#document-' が前置・連結された
    壊れた href（'#document-' と 'example.com/baz' が連結された形）が一切現れない、
    を固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    external_url = "https://example.com/baz"

    # 前提固定: singlehtml の home(deep/glossary) 同一ページ参照基準は '#document-*' 形。
    # 外部 URL がこの base へ巻き込まれていないことを後段で確認するための接頭辞。
    home_target = app.builder.get_target_uri("deep/glossary")
    assert home_target.startswith("#document-"), (
        "前提崩れ: singlehtml の get_target_uri('deep/glossary') が同一ページ"
        f"'#document-*' フラグメントでない（{home_target!r}）"
    )

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    # その中の term-baz 注入 template を切り出す。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-baz">' in html, (
        "singlehtml 単一ページに term-baz の <template> が注入されていない（前提崩れ）"
    )
    start = html.index('<template id="riddle-tip--term-baz">')
    template = html[start : html.index("</template>", start)]

    # template 内の全 href を収集する。
    hrefs = re.findall(r'\bhref="([^"]*)"', template)
    assert hrefs, "term-baz 注入 template から href が 1 つも取れない（前提崩れ）"

    # Assert(2/本丸): 外部 URL が完全形のまま verbatim 保持された href として現れる。
    assert external_url in hrefs, (
        "定義内の外部 URL リンクが singlehtml 集約後も完全形のまま verbatim 保持されて"
        f"いない（期待 href={external_url!r} / 実際の href 群={hrefs!r}）"
    )

    # Assert(3/誤連結なし): 外部 URL に singlehtml の同一ページ参照基準 '#document-'
    # が前置・連結された壊れた href（再ベースに巻き込まれた形）が一切現れない。
    misconcatenated = [
        h for h in hrefs if "example.com/baz" in h and h != external_url
    ]
    assert not misconcatenated, (
        "外部 URL が singlehtml 集約処理に巻き込まれ '#document-*' 連結等で壊れた href へ"
        f"化けている（誤連結 href={misconcatenated!r}）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_別名term経由の参照でも同一定義templateがsinglehtml集約後に注入される(app):
    """[r1-7/境界] 別名 term（フー=foo の foo 側 term-id である term-foo）経由の
    :term: 参照に対しても、singlehtml の単一ページ集約後に
    <template id="riddle-tip--term-foo"> が注入され、その中に（主名フーと同一定義を
    共有する）定義本文 'フーの定義本体。段落2つめ。' が含まれること。

    home(index) の glossary は同一定義に複数の term（主名 'フー'＝term-0／別名
    'foo'＝term-foo）を割り当てている。extract_definitions は別名（複数 term）が同一
    definition を共有する場合でも term-id ごとに独立した deepcopy を返す設計であり、
    home_index も labelid（term-foo 含む）単位で home_docname を引ける。よって参照側が
    別名 :term:`foo` を使った場合、その refuri/refid には主名 term-0 ではなく別名側の
    term-id である term-foo が入り、注入される template の id も riddle-tip--term-foo
    になるはずである。

    singlehtml は全ドキュメントを単一 index.html へ集約する。別名経由の参照
    （subdir/other 本文の :term:`foo`）が集約後も別名側 term-id (term-foo) として
    home_index/extract_definitions の別名経路を正しくたどり、同一定義の template が
    単一ページへ注入されること（別名経路の取りこぼしで注入ゼロにならないこと）を
    実ビルドで固定する。

    確証として (1) 別名側 id の template <template id="riddle-tip--term-foo"> が単一
    ページに注入され定義本文を含む、(2) その別名 template の定義本文が主名フー(term-0)
    の定義と同一（同一 definition の deepcopy 共有）であること、(3) 注入機構自体は
    動いている（主名 term-0 の template も存在する＝別名 template 不在が注入ゼロ由来の
    偽陰性でないこと）を併せて固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # 別名 'foo' が主名 'フー' と同一定義を共有しつつ別個の term-id (term-foo) を
    # 持つことを StandardDomain から前提固定する（別名経路の前提崩れ検出）。
    std = app.builder.env.get_domain("std")
    term_homes = {
        name: (docname, labelid)
        for (objtype, name), (docname, labelid) in std.objects.items()
        if objtype == "term"
    }
    assert term_homes.get("foo", (None, None))[1] == "term-foo", (
        "前提崩れ: 別名 'foo' の term-id が term-foo でない"
        f"（実際={term_homes.get('foo')!r}）"
    )
    assert term_homes.get("フー", (None, None))[1] == "term-0", (
        "前提崩れ: 主名 'フー' の term-id が term-0 でない"
        f"（実際={term_homes.get('フー')!r}）"
    )

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert(3/前提): 注入機構自体は動いている（主名フー term-0 は注入される）。
    # これにより別名 template 不在が「注入が全く動いていない」由来の偽陰性でないことを担保する。
    assert '<template id="riddle-tip--term-0">' in html, (
        "主名フー term-0 の template が無い（注入機構が動いていない前提崩れ）"
    )

    # Assert(1/本丸): 別名側 term-id (term-foo) の template が単一ページへ注入され、
    # 共有する定義本文を含む（別名経路の取りこぼしで注入ゼロにならない）。
    assert '<template id="riddle-tip--term-foo">' in html, (
        "別名 :term:`foo` 経由の参照に対して term-foo の <template> が"
        "singlehtml 単一ページに注入されていない"
        "（home_index/extract_definitions の別名経路を取りこぼした疑い）"
    )
    foo_start = html.index('<template id="riddle-tip--term-foo">')
    foo_template = html[foo_start : html.index("</template>", foo_start)]
    assert "フーの定義本体。段落2つめ。" in foo_template, (
        "別名 term-foo の注入 template に共有定義本文 'フーの定義本体。段落2つめ。' が"
        "含まれない（別名が同一 definition の deepcopy を共有していない疑い）"
    )

    # Assert(2/同一定義共有): 別名 template の定義本文が主名フー(term-0)の定義と同一。
    zero_start = html.index('<template id="riddle-tip--term-0">')
    zero_template = html[zero_start : html.index("</template>", zero_start)]
    assert "フーの定義本体。段落2つめ。" in zero_template, (
        "主名 term-0 の注入 template に定義本文が含まれない（前提崩れ）"
    )


@pytest.mark.sphinx("singlehtml", testroot="pages", warningiserror=True)
def test_定義本文同士が相互参照するterm参照もsinglehtml集約後に同一ページfragmentへ閉じる(app):
    """[r1-8/境界] ある用語 crossref の定義本文の中から別の用語 baz への :term:
    相互参照があるケースで、singlehtml の単一ページ集約後に注入された
    <template id="riddle-tip--term-crossref"> の中でも、その :term:`baz` 参照の
    href が builder 由来の同一ページ #document-* フラグメント（baz の home
    deep/glossary 文脈で解決した同一ページ参照に term-baz を連ねた形）へ閉じ、
    二重フラグメント（'#document-...#document-...' のように '#' を 3 つ以上含む形）や
    上り相対（'../' / 別ページ '.html'）へ崩れないこと（定義本文同士が相互参照する
    境界）。

    crossref の定義(home=deep/glossary)は、その定義本文の中で別の用語
    :term:`baz`（同じ home で定義される）を参照する。crossref は deepref から
    :term: 参照されるため、その定義本文（baz への :term: 相互参照を含む）が
    単一ページ index.html へ注入される。

    singlehtml は全ドキュメントを単一 index.html へ集約する。注入された定義本文の
    中の :term:`baz` 相互参照は、解決済み doctree で baz の home(deep/glossary)
    への同一ページ参照 refuri（builder 由来の '#document-deep/glossary#term-baz'
    のような同一ページ #fragment 形）を持つ。rebase の同一ページ参照（再ベース
    不要分岐）が効いて、この refuri が素朴連結で二重フラグメント化したり上り相対へ
    崩れたりせず、同一ページ #fragment 形のまま閉じるのが正しい。ここで base
    （'#document-deep/glossary'）と素朴連結されると
    '#document-deep/glossary#document-deep/glossary#term-baz' のような壊れた多重
    フラグメントになり、単一ページ DOM の id="term-baz" を指さず 404 になる。

    期待値は html/dirhtml 形をハードコードせず、baz の home(deep/glossary) を
    base 文脈とした builder.get_relative_uri('deep/glossary', 'deep/glossary') に
    term-baz フラグメントを連ねた同一ページ参照基準から導出する。

    検証は (1) crossref の定義 template が注入され定義本文を含む（前提崩れ・注入
    ゼロでない）、(2) その template 内の baz を指す :term: 相互参照 href が、素のアンカー
    '#term-baz'（多重 '#' でない同一ページ参照形）として現れる、(3) その href が
    多重フラグメント・上り相対（'../'）・別ページ（'.html'）へ崩れていない、(4) その
    指す先 id="term-baz" が単一ページ DOM に実在し 404 にならない、を固定する。
    """
    # Arrange / Act: testroot='pages' を singlehtml で warning-as-error ビルドする
    app.build()

    # baz の home(deep/glossary) 同一ページ参照基準を builder から導出する（前提固定）。
    # singlehtml では home 自身への relative uri は同一ページフラグメント
    # （例 '#document-deep/glossary'）。ただし相互参照の正準形は base を前置した
    # 二重フラグメントではなく、素のアンカー '#term-baz'（単一ページ DOM の
    # id="term-baz" を直接指す）である。base 前置の '#document-deep/glossary#term-baz'
    # は '#' が 2 つで 404 になるため正準ではない。
    home_uri = app.builder.get_relative_uri("deep/glossary", "deep/glossary")
    assert home_uri.startswith("#"), (
        "前提崩れ: singlehtml の get_relative_uri('deep/glossary','deep/glossary')"
        f"が同一ページフラグメントでない（{home_uri!r}）"
    )
    expected_href = "#term-baz"

    # Act: singlehtml は全ドキュメントを単一 index.html へ集約する。
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert(1/前提): crossref の定義 template が注入され、定義本文を含む
    # （注入ゼロ由来の偽陰性でないことを担保）。
    assert '<template id="riddle-tip--term-crossref">' in html, (
        "singlehtml 単一ページに term-crossref の <template> が注入されていない"
        "（前提崩れ／注入ゼロの疑い）"
    )
    start = html.index('<template id="riddle-tip--term-crossref">')
    template = html[start : html.index("</template>", start)]
    assert "クロスリファレンス用語の定義本体。" in template, (
        "注入 template に crossref の定義本文 'クロスリファレンス用語の定義本体。' が"
        "含まれない"
    )

    # template 内の baz(term-baz) を指す :term: 相互参照 href を収集する。
    baz_hrefs = re.findall(r'href="([^"]*term-baz[^"]*)"', template)
    assert baz_hrefs, (
        "crossref の定義 template に別用語 baz(term-baz) を指す :term: 相互参照 href が"
        "無い（前提崩れ／定義本文同士の相互参照が出力されていない疑い）"
    )

    # Assert(2/本丸): baz 相互参照 href が builder 由来の同一ページ #document-*
    # フラグメント形として現れる（base との素朴連結で多重フラグメント化していない）。
    assert expected_href in baz_hrefs, (
        "定義本文同士の :term: 相互参照(baz)が、singlehtml の同一ページ #fragment 形へ"
        f"閉じていない（期待 href={expected_href!r} / 実際の href={baz_hrefs!r}）"
    )

    # Assert(3/崩れなし): 各 baz 相互参照 href が多重フラグメント・上り相対・別ページ
    # '.html' へ崩れていない。
    for href in baz_hrefs:
        assert href.count("#") == 1, (
            "baz 相互参照 href が多重フラグメント形へ崩れている"
            "（base との素朴連結で '#document-...#document-...' 化した疑い）: "
            f"{href!r}"
        )
        assert "../" not in href, (
            f"baz 相互参照 href に上り相対 '../' が含まれる（href={href!r}）"
            "＝同一ページ参照なのにページ間相対へ崩れている"
        )
        assert ".html" not in href, (
            f"baz 相互参照 href に別ページ '.html' が含まれる（href={href!r}）"
            "＝同一ページ参照なのにページ間相対へ崩れている"
        )

    # Assert(4/非404): baz 相互参照 href の指す先 id="term-baz" が単一ページ DOM に
    # 実在し、相互参照が 404 にならない。
    assert re.search(r'id="term-baz"', html), (
        "baz 相互参照 href の指す先 id=\"term-baz\" が単一ページ DOM に実在しない"
        "（定義本文同士の相互参照が 404 になる）"
    )
