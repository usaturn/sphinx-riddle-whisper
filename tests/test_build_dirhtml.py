"""dirhtml ビルダ統合（html-page-context e2e）の検証テスト。

html ビルダで動いている glossary ポップオーバーの template 注入と相対 URI
再ベースが dirhtml ビルダでも壊れないことを実ビルドで回帰固定する。

dirhtml では各 docname がディレクトリ化され、subdir/other → subdir/other/index.html
として出力される（master=index は index.html）。
"""

import posixpath
import re
from pathlib import Path

import pytest


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_dirhtmlビルドがwarning_as_errorで警告ゼロで完走する(app):
    """[t5/正常] dirhtml ビルドが warningiserror=True で警告ゼロ・成功で完走する。

    template 注入と再ベースが dirhtml ビルダ上で warning を誘発しないことを固定する。
    warningiserror=True のため、ビルド中に warning が 1 つでも出れば app.build() が
    例外を送出してこのテストは失敗する。完走の証跡として、dirhtml の標準出力である
    master(index → index.html) と参照ページ(subdir/other → subdir/other/index.html)が
    実際に生成されていること、および Sphinx の累積 warning カウントが 0 であることを
    検証する。
    """
    # Arrange / Act: testroot='pages' を dirhtml で warning-as-error ビルドする
    # （warning が出れば app.build() がここで例外を送出する）
    app.build()

    # Assert: ビルドが完走し dirhtml の標準出力ファイルが生成されている
    assert (Path(app.outdir) / "index.html").is_file(), (
        "dirhtml の master 出力 index.html が生成されていない（ビルド未完走）"
    )
    assert (Path(app.outdir) / "subdir" / "other" / "index.html").is_file(), (
        "dirhtml の参照ページ出力 subdir/other/index.html が生成されていない"
    )

    # Assert: 警告ゼロで完走している（warningiserror 下では非0なら既に例外だが明示固定）
    assert app._warncount == 0, (
        f"dirhtml ビルドで warning が発生した（warncount={app._warncount}）"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_dirhtml参照ページにフーの定義テンプレートが注入される(app):
    """dirhtml の参照ページ出力 subdir/other/index.html に
    <template id="riddle-tip--term-0"> が注入され、その中にフーの定義本文
    'フーの定義本体。' が含まれる（dirhtml 出力パス化の本丸回帰固定）。"""
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # Act: dirhtml 出力では subdir/other → subdir/other/index.html
    html = (Path(app.outdir) / "subdir" / "other" / "index.html").read_text(
        encoding="utf-8"
    )

    # Assert: フーの term-id 'term-0' のテンプレートに定義本文が注入されている
    assert '<template id="riddle-tip--term-0">' in html
    assert "フーの定義本体。" in html


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_注入template内のdocリンクがdirhtml構造へ再ベースされる(app):
    """[t2/異常] 注入された term-0 の <template> 内の :doc: トピックリンクが、
    参照ページ subdir/other（dirhtml では subdir/other/index.html）から
    topic（dirhtml では topic/index.html）へ 404 にならない相対 URI へ
    再ベースされている。

    期待値は html 形（../topic.html）をハードコードせず、dirhtml ビルダの
    builder.get_relative_uri('subdir/other', 'topic') から導出する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # 期待 URI を dirhtml ビルダの再ベース基準から導出する
    expected_uri = app.builder.get_relative_uri("subdir/other", "topic")

    # Act: dirhtml 出力 subdir/other/index.html の注入 template を切り出す
    html = (Path(app.outdir) / "subdir" / "other" / "index.html").read_text(
        encoding="utf-8"
    )
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert: :doc: リンクが dirhtml 構造基準の相対 URI へ再ベースされている
    assert f'href="{expected_uri}"' in template, (
        f":doc: トピックリンクが dirhtml 構造へ再ベースされていない"
        f"（期待 href={expected_uri!r}）"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_注入template内のref同一home内アンカーがdirhtml構造へ再ベースされる(app):
    """[t3/異常] 注入された term-0 の <template> 内の :ref: 同一 home 内アンカー
    (intro-anchor) が、参照ページ subdir/other（dirhtml では
    subdir/other/index.html）から home（index、dirhtml では index.html）の
    #intro-anchor へ 404 にならない相対 URI へ再ベースされている。

    また、未再ベースの素の '#intro-anchor'（home 基準のまま）が残存していない
    こと（残ると subdir/other/index.html 上で 404 になる）。

    期待値は html 形（../index.html#intro-anchor）をハードコードせず、dirhtml
    ビルダの builder.get_relative_uri('subdir/other', 'index') から導出する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # 期待 URI を dirhtml ビルダの再ベース基準から導出する
    # (home=index への相対 URI + アンカー fragment)
    home_uri = app.builder.get_relative_uri("subdir/other", "index")
    expected_uri = f"{home_uri}#intro-anchor"

    # Act: dirhtml 出力 subdir/other/index.html の注入 template を切り出す
    html = (Path(app.outdir) / "subdir" / "other" / "index.html").read_text(
        encoding="utf-8"
    )
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert: :ref: 同一 home 内アンカーが dirhtml 構造基準の相対 URI へ再ベース
    assert f'href="{expected_uri}"' in template, (
        f":ref: 同一 home 内アンカーが dirhtml 構造へ再ベースされていない"
        f"（期待 href={expected_uri!r}）"
    )

    # Assert(回帰防止): home 基準のままの素の #intro-anchor が残存していない
    assert 'href="#intro-anchor"' not in template, (
        "未再ベースの #intro-anchor が残存"
        "（subdir/other/index.html 上で 404 になる）"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_注入template内の相対画像がdirhtml構造へ再ベースされる(app):
    """[t4/境界] 注入された term-0 の <template> 内の相対画像が、参照ページ
    subdir/other（dirhtml では subdir/other/index.html）から見て 404 にならない
    実在パスへ解決される。

    画像は rebase で自前再ベースせず、render_partial（HTML writer）が
    builder.images/imgpath 経由でページ P 基準の '_images/<basename>' へ書き換える。
    Sphinx は画像を常に _images/ にのみ出力するため、期待値を文字列でハードコード
    （かつてのトートロジー検証 '../../pic.png' は実在せず 404 だった）せず、注入
    template の img src を参照ページの出力ディレクトリ基準で解決した宛先が実ビルド
    出力に実在することで「正しい再ベース＝非404」を検証する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    outdir = Path(app.outdir)

    # Act: dirhtml 出力 subdir/other/index.html の注入 template を切り出す
    html = (outdir / "subdir" / "other" / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # 注入 template 内の img src を収集する
    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template)
    assert img_srcs, "注入 template に img が無い（前提崩れ）"

    # Assert: 各 img src を参照ページ(subdir/other/)の出力ディレクトリ基準で解決した
    # 宛先が実ビルド出力に実在する（404 にならない）。dirhtml では subdir/other は
    # subdir/other/index.html に出力されるので解決基準ディレクトリは 'subdir/other'。
    page_dir = "subdir/other"
    for src in img_srcs:
        path = src.split("#", 1)[0].split("?", 1)[0]
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        assert (outdir / resolved).is_file(), (
            f"注入画像 src={src!r} が subdir/other/index.html 基準で 404"
            f"（解決先 {resolved!r} が実在しない）"
        )

    # Assert: 実在画像は _images/ に出力される（render_partial 委譲の確証）
    assert any("_images/" in src for src in img_srcs), (
        f"注入画像 src が _images/ 配下を指していない（render_partial 委譲が効いていない）"
        f"（img_srcs={img_srcs!r}）"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_用語を定義するだけのindexページにはテンプレートが注入されない(app):
    """[t6/境界] index ページは glossary 用語（フー/バー）を定義するだけで
    どの用語も参照しないため、dirhtml の index 出力（master=index → index.html）に
    riddle-tip-- テンプレートが一切注入されない。

    定義しただけのページに注入してしまうと、参照のないページに無関係な定義
    テンプレートが漏れ出す。dirhtml ビルダでもこの境界（定義のみページ＝注入対象外）
    が維持されることを回帰固定する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # Act: dirhtml の master 出力（index → index.html）を読む
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: 定義のみの index ページには riddle-tip-- テンプレートが一切無い
    assert "riddle-tip--" not in html, (
        "用語を定義するだけで参照しない index ページに riddle-tip-- が漏れている"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_同一term_idのテンプレートはdirhtml参照ページに重複なく1回だけ注入される(app):
    """[t7/境界] DISTINCT 注入: dirhtml の参照ページ出力
    subdir/other/index.html に term-0 の template が重複なくちょうど 1 回だけ
    出力される。

    参照ページ subdir/other は本文中で同一用語フー(term-0)を参照する。注入が
    DISTINCT 化されておらず参照ごと・処理ごとに重複注入されると、同一 term-id の
    template が複数出てしまう（DOM 上で id 重複となり JS 側の getElementById が
    壊れる）。dirhtml ビルダでもこの境界（同一 term-id はちょうど 1 回）が維持される
    ことを回帰固定する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # Act: dirhtml 出力では subdir/other → subdir/other/index.html
    html = (Path(app.outdir) / "subdir" / "other" / "index.html").read_text(
        encoding="utf-8"
    )

    # Assert: term-0 の template が重複なくちょうど 1 回だけ注入されている
    _term0_count = html.count('id="riddle-tip--term-0"')
    assert _term0_count == 1, (
        "dirhtml 参照ページに term-0 の template が重複注入されている"
        f"（出現回数={_term0_count}）"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_depth1参照ページでもdoc_ref_画像がdirhtml構造へ正しく再ベースされる(app):
    """[r1-1/境界] 参照ページが home と異なる深さから :term: 参照したときも、
    定義に含まれる :doc:/:ref:/画像が dirhtml 構造へ正しく再ベースされる。

    既存の参照ページ subdir/other は depth=2（出力 subdir/other/index.html、
    出力ディレクトリ subdir/other/）。本テストはルート直下の rootref（depth=1、
    出力 rootref/index.html、出力ディレクトリ rootref/）から同一用語フー(term-0)
    を参照する。depth が浅いぶん再ベースの ``../`` 段数が subdir/other とは
    変わる（depth 差で段数が変わるケースの回帰固定）。

    期待値は html 形をハードコードせず、dirhtml ビルダの
    builder.get_relative_uri('rootref', ...) から導出する。rebase.py の
    再ベース基準（home ページへの相対 base のディレクトリ部へ結合・正規化）と
    同じ式で画像 URI も導出する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # :doc:/:ref: の期待 URI を depth=1 の参照ページ rootref を base に導出する
    # （これらは render_partial が verbatim 出力するため自前再ベースが効く）。
    expected_doc = app.builder.get_relative_uri("rootref", "topic")
    home_uri = app.builder.get_relative_uri("rootref", "index")
    expected_ref = f"{home_uri}#intro-anchor"

    # Act: dirhtml 出力では rootref → rootref/index.html
    outdir = Path(app.outdir)
    html = (outdir / "rootref" / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # Assert: depth=1 基準で :doc:/:ref: が正しく再ベースされている（段数が depth で変わる）
    assert f'href="{expected_doc}"' in template, (
        f"depth=1 参照ページで :doc: トピックリンクが再ベースされていない"
        f"（期待 href={expected_doc!r}）"
    )
    assert f'href="{expected_ref}"' in template, (
        f"depth=1 参照ページで :ref: 同一 home 内アンカーが再ベースされていない"
        f"（期待 href={expected_ref!r}）"
    )
    # 画像は render_partial 委譲。img src を rootref の出力ディレクトリ基準で解決した
    # 宛先が実在する（404 にならない）ことで depth=1 でも正しく解決されるのを固定する。
    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template)
    assert img_srcs, "注入 template に img が無い（前提崩れ）"
    for src in img_srcs:
        path = src.split("#", 1)[0].split("?", 1)[0]
        resolved = posixpath.normpath(posixpath.join("rootref", path))
        assert (outdir / resolved).is_file(), (
            f"depth=1 参照ページで画像 src={src!r} が 404"
            f"（解決先 {resolved!r} が実在しない）"
        )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_注入先より深い階層にhomeがある下り方向の再ベースが404にならない(app):
    """[r1-2/境界] 注入先ページより home が「深い階層」にある（逆方向＝下り方向の
    再ベース）場合に、dirhtml で内部参照が 404 にならない正しい相対 URI になる。

    既存の参照ページ（subdir/other, rootref）はいずれも home（index, ルート）と
    同じか深い位置にあり、再ベースは ``../`` で「上る」方向だった。本テストは逆向き
    の境界を固定する: 参照ページ deepref はルート直下（depth=1）にあり、参照する用語
    baz の home は ``deep/glossary``（より深い階層）にある。このとき定義に含まれる
    :ref: 同一 home 内アンカー・相対画像は、注入先 deepref から見て ``deep/`` 配下へ
    「下る」相対 URI へ再ベースされる必要がある。

    html 形のパスをハードコードせず、注入 template 内の各相対 URI を注入先ページ
    deepref の dirhtml 出力ディレクトリ基準で解決した宛先が、実ビルド出力に実在する
    （= 404 にならない）ことで「正しい下り方向の再ベース」を検証する。宛先がディレクトリ
    URI（末尾 '/'）の場合は dirhtml の index.html を、ファイルの場合はそのファイルを
    実体として確認する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    outdir = Path(app.outdir)

    # 注入先ページ deepref（ルート直下 depth=1）の dirhtml 出力ディレクトリを
    # builder から導出する（deepref → deepref/index.html、出力ディレクトリ 'deepref'）。
    page_target = app.builder.get_target_uri("deepref")  # 例: 'deepref/'
    page_dir = posixpath.dirname(page_target.rstrip("/") + "/")  # 'deepref'

    # Act: dirhtml 出力 deepref/index.html の注入 template（term-baz）を切り出す
    html = (outdir / "deepref" / "index.html").read_text(encoding="utf-8")
    start = html.index('<template id="riddle-tip--term-baz">')
    template = html[start : html.index("</template>", start)]

    # 定義本文が下り方向の home から運ばれていること（前提確認）
    assert "バズの定義本体。" in template, (
        "深い階層 home の定義本文が注入されていない（前提崩れ）"
    )

    # template 内の全 href / src の相対 URI を収集する
    uris = re.findall(r'(?:href|src)="([^"]*)"', template)
    assert uris, "注入 template から href/src URI が 1 つも取れない（前提崩れ）"

    # Assert: 各相対 URI を注入先ページ deepref の出力ディレクトリ基準で解決した
    # 宛先が、実ビルド出力に実在する（下り方向の再ベースが 404 にならない）。
    missing = []
    for uri in uris:
        # 外部・サイト絶対・フラグメントのみは対象外（ローカル相対パスのみ判定）
        if uri.startswith(
            ("http://", "https://", "//", "/", "#", "mailto:", "data:")
        ):
            continue
        path = uri.split("#", 1)[0].split("?", 1)[0]
        if not path:
            continue
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        # 宛先がディレクトリ URI（末尾 '/'）なら dirhtml の index.html を実体とする
        target = (
            posixpath.join(resolved, "index.html")
            if path.endswith("/")
            else resolved
        )
        if not (outdir / target).exists():
            missing.append((uri, target))

    assert not missing, (
        "下り方向に再ベースした内部参照の宛先が実ビルド出力に存在しない"
        f"（404 になる相対 URI: {missing!r}）"
    )


@pytest.mark.sphinx("dirhtml", testroot="pages", warningiserror=True)
def test_注入template内の再ベースURIが出力ルート外へパストラバーサルしない(app):
    """[t8/セキュリティ] 注入された term-0 の <template> 内の :doc:・:ref:・画像 URI
    に、参照ページ階層を突き抜けて出力ルート外へ出るパストラバーサル
    （過剰な ../ で _images や topic より上位＝出力ルート外へ脱出する）が
    生じていないことを確認する。

    dirhtml では参照ページ subdir/other は subdir/other/index.html として出力され、
    その属する出力ディレクトリは ``subdir/other/`` （出力ルートから 2 階層深い）。
    template 内の各相対 URI（href/src）を、この参照ページの出力ディレクトリ基準で
    解決した結果が出力ルート配下に収まる（先頭に余計な ../ が残って _images や
    topic より上＝ルート外へ出ない）ことを検証する。

    過剰再ベース（自前段数計算の誤りなどで ../ が増える）が起きると、解決結果が
    出力ルートより上位へ脱出し、生成物の外＝想定外パスを指すことになる
    （ディレクトリトラバーサル相当）。html 形にハードコードせず、参照ページの
    出力ディレクトリ深さから「ルート外脱出」を判定する。
    """
    # Arrange: testroot='pages' を dirhtml で warning-as-error ビルドする
    app.build()

    # dirhtml の参照ページ出力パス（subdir/other → subdir/other/index.html）と、
    # その属する出力ディレクトリ（subdir/other/）の出力ルートからの深さを導出する。
    page_output = app.builder.get_target_uri("subdir/other")  # 例: 'subdir/other/'
    page_dir = posixpath.dirname(page_output.rstrip("/") + "/")  # 'subdir/other'
    page_depth = len([seg for seg in page_dir.split("/") if seg])

    # Act: dirhtml 出力 subdir/other/index.html の注入 template を切り出す
    html = (Path(app.outdir) / "subdir" / "other" / "index.html").read_text(
        encoding="utf-8"
    )
    start = html.index('<template id="riddle-tip--term-0">')
    template = html[start : html.index("</template>", start)]

    # template 内の全 href / src の URI を収集する
    uris = re.findall(r'(?:href|src)="([^"]*)"', template)
    assert uris, "注入 template から href/src URI が 1 つも取れない（前提崩れ）"

    # Assert: 各相対 URI を参照ページの出力ディレクトリ基準で解決した結果が
    # 出力ルート外（先頭に ../ が残る＝親へ脱出）へ出ない。
    escaping = []
    for uri in uris:
        # 外部・サイト絶対・フラグメントのみは対象外（ローカル相対パスのみ判定）
        if uri.startswith(("http://", "https://", "//", "/", "#", "mailto:", "data:")):
            continue
        path = uri.split("#", 1)[0].split("?", 1)[0]
        if not path:
            continue
        # 参照ページの出力ディレクトリへ結合し正規化した結果。先頭に '..' が
        # 残れば出力ルートより上位へ脱出している（パストラバーサル）。
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        if resolved.startswith("..") or resolved.startswith("/"):
            escaping.append((uri, resolved))

    assert not escaping, (
        f"再ベース後の URI が出力ルート外へパストラバーサルしている"
        f"（参照ページ深さ={page_depth}, 脱出 URI={escaping!r}）"
    )
