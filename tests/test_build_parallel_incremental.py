"""並列ビルド・増分ビルド・env_version 要否ゲートの横断ハードニング検証テスト。

glossary ポップオーバーの template 注入が、増分ビルド・並列ビルド・env 状態管理の
観点でも整合することを実ビルドで回帰固定する（spec Phase 1 横断ハードニング #23）。
"""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from sphinx_riddle_whisper import setup


def _extract_term_template(html: str, term_id: str) -> str:
    """注入 <template id="riddle-tip--{term_id}"> の開きタグから </template> 直前までを切り出す。

    :param html: 出力 HTML 全体。
    :param term_id: 切り出す term-id（例 'term-0'）。
    :returns: 開きタグ＋内側 HTML（閉じタグは含まない）。見つからなければ ValueError。
    """
    marker = f'<template id="riddle-tip--{term_id}">'
    start = html.index(marker)
    return html[start : html.index("</template>", start)]


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-replace",
    warningiserror=True,
)
def test_増分ビルドで定義変更後に参照ページのtemplate本文が最新へ置換される(app):
    """[t1/境界] 増分ビルド: index.rst の フー(term-0) 定義本文だけを書き換えて
    再ビルドしたとき、参照ページ subdir/other.html に注入された term-0 template の
    本文が最新定義へ置換され、旧本文が残らない。

    spec の最大失敗モード『増分で古い template 残存』を実ビルドで固定する。
    増分ビルドでは Sphinx は変更された doc とその依存のみ再書き出しするため、
    定義ページ(index)だけを変更したとき参照ページ(subdir/other)が再書き出し
    されないと、注入 template は subdir/other.html 内にあるため古い定義本文が
    残ってしまう。
    """
    # Arrange: 1 回目のビルド（初期定義 'フーの定義本体。' で注入される）
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-0">' in html_first, (
        "前提崩れ: 1 回目ビルドで subdir/other.html に term-0 template が無い"
    )
    assert "フーの定義本体。" in html_first, (
        "前提崩れ: 1 回目ビルドの注入 template に初期定義本文が無い"
    )

    # Act: 定義ページ index.rst の フー(term-0) 定義本文だけを書き換えて再ビルドする。
    # 参照ページ subdir/other.rst には一切手を触れない（増分の本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    new_body = "フーの最新定義本体。差し替え済み。"
    text = text.replace("フーの定義本体。段落2つめ。", new_body)
    assert new_body in text, "前提崩れ: index.rst の定義本文を置換できなかった"
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 参照ページ subdir/other.html の注入 template 本文が最新へ置換され、
    # 旧本文が残っていない（増分で古い template が残存しないこと）。
    html_second = out_other.read_text(encoding="utf-8")
    start = html_second.index('<template id="riddle-tip--term-0">')
    template = html_second[start : html_second.index("</template>", start)]

    assert new_body in template, (
        "増分ビルド後、参照ページ subdir/other.html の term-0 template に"
        f"最新定義本文 {new_body!r} が反映されていない（古い template が残存）"
    )
    assert "フーの定義本体。" not in template, (
        "増分ビルド後、参照ページ subdir/other.html の term-0 template に"
        "古い定義本文 'フーの定義本体。' が残存している（増分で古い template 残存）"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-include-dependency",
    warningiserror=True,
)
def test_増分ビルドで定義のincludeファイル変更が参照ページtemplateへ反映される(app):
    """[r1-5/境界] 増分ビルド: glossary home の定義本文を ``.. include::`` へ
    切り出し、その include ファイルだけを書き換えて再ビルドしたとき、参照ページ
    subdir/other.html に注入された term-0 template が最新本文へ置換される。

    home doc の source path だけを参照ページへ依存登録していると、home 自身の
    依存ファイル（include 先）が変わっても参照ページは outdated にならず、注入
    template が古いまま残り得る。このテストは home doc の env.dependencies も
    参照ページへ伝播されることを実ビルドで固定する。
    """
    # Arrange: フーの定義本文を include ファイルへ切り出した状態で 1 回目をビルドする。
    srcdir = Path(app.srcdir)
    include_src = srcdir / "foo-definition-body.inc"
    old_body = "フーのinclude定義本体。初版。"
    include_src.write_text(old_body, encoding="utf-8")

    index_src = srcdir / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    text = text.replace(
        "      フーの定義本体。段落2つめ。",
        "      .. include:: foo-definition-body.inc",
    )
    assert ".. include:: foo-definition-body.inc" in text, (
        "前提崩れ: index.rst の定義本文を include へ置換できなかった"
    )
    index_src.write_text(text, encoding="utf-8")

    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    template_first = _extract_term_template(
        out_other.read_text(encoding="utf-8"), "term-0"
    )
    assert old_body in template_first, (
        "前提崩れ: 1 回目ビルドの注入 template に include 初版本文が無い"
    )

    # Act: home source ではなく include ファイルだけを書き換えて再ビルドする。
    new_body = "フーのinclude定義本体。最新版。"
    include_src.write_text(new_body, encoding="utf-8")
    app.build()

    # Assert: 参照ページの template が include の最新版へ置換され、旧本文が残らない。
    template_second = _extract_term_template(
        out_other.read_text(encoding="utf-8"), "term-0"
    )
    assert new_body in template_second, (
        "include ファイルだけを変更した増分ビルド後、参照ページ subdir/other.html の"
        " term-0 template に最新定義本文が反映されていない（home の依存ファイルが"
        "参照ページへ伝播されていない疑い）"
    )
    assert old_body not in template_second, (
        "include ファイルだけを変更した増分ビルド後、参照ページ subdir/other.html の"
        " term-0 template に古い include 定義本文が残存している"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-remove-ref",
    warningiserror=True,
)
def test_増分ビルドで参照ページからterm参照を削除するとtemplateが消える(app):
    """[r1-1/境界] 増分ビルド(依存解除方向): 参照ページ rootref.rst から
    term 参照(:term:`フー`)を削除して再ビルドしたとき、その term の
    <template id="riddle-tip--term-0"> が参照ページ rootref.html から消える。

    観点: 参照を削除したのにページが再書き出しされない／再注入時に古い term-id が
    残るなどで template が張りっぱなし(残存)にならないこと。参照ページ自身の
    ソースを変更しているのでページは必ず再書き出しされ、再注入時には
    extract_referenced_term_ids が term-0 を返さなくなるため template は
    消えるはず——これを実ビルドで固定する。
    """
    # Arrange: 1 回目のビルド。rootref は :term:`フー` を参照するため
    # rootref.html に term-0 の template が注入される。
    app.build()

    out_rootref = Path(app.outdir) / "rootref.html"
    html_first = out_rootref.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-0">' in html_first, (
        "前提崩れ: 1 回目ビルドで rootref.html に term-0 template が無い"
    )

    # Act: 参照ページ rootref.rst から :term:`フー` 参照を削除して再ビルドする。
    # 定義ページ index.rst には一切手を触れない（依存解除方向の本丸）。
    rootref_src = Path(app.srcdir) / "rootref.rst"
    text = rootref_src.read_text(encoding="utf-8")
    old_line = "本文から :term:`フー` を参照する（ルート直下・depth=1 のクロスページ参照）。"
    assert old_line in text, "前提崩れ: rootref.rst の term 参照行が見つからない"
    text = text.replace(old_line, "本文から用語は参照しない（term 参照を削除済み）。")
    rootref_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 参照を削除したので rootref.html から term-0 template が消えている。
    html_second = out_rootref.read_text(encoding="utf-8")
    assert "riddle-tip--term-0" not in html_second, (
        "term 参照を削除して再ビルドしたのに rootref.html に term-0 template が"
        "残存している（依存解除方向で古い template が張りっぱなし）"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-count",
    warningiserror=True,
)
def test_増分ビルドで定義変更後も参照ページのtemplateはちょうど1回だけ残る(app):
    """[t2/境界] 増分ビルド: index.rst の フー(term-0) 定義本文だけを書き換えて
    再ビルドした後も、参照ページ subdir/other.html に注入された term-0 の
    <template id="riddle-tip--term-0"> がちょうど 1 回だけ存在する。

    増分ビルドで参照ページが再書き出しされる際に、注入が二重に走って template が
    重複したり、逆に再注入が走らず template が消失したりしないことを境界として
    固定する（重複注入・注入消失のいずれもバグ）。
    """
    # Arrange: 1 回目のビルド（このとき term-0 template はちょうど 1 回注入される）
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    assert html_first.count('id="riddle-tip--term-0"') == 1, (
        "前提崩れ: 1 回目ビルドで subdir/other.html の term-0 template が"
        "ちょうど 1 回でない"
    )

    # Act: 定義ページ index.rst の フー(term-0) 定義本文だけを書き換えて再ビルドする。
    # 参照ページ subdir/other.rst には一切手を触れない（増分の本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    new_body = "フーの最新定義本体。差し替え済み。"
    text = text.replace("フーの定義本体。段落2つめ。", new_body)
    assert new_body in text, "前提崩れ: index.rst の定義本文を置換できなかった"
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 増分ビルド後も subdir/other.html に term-0 template が
    # ちょうど 1 回だけ存在する（重複注入も注入消失も起きていない）。
    html_second = out_other.read_text(encoding="utf-8")
    _term0_count = html_second.count('id="riddle-tip--term-0"')
    assert _term0_count == 1, (
        "増分ビルド後、subdir/other.html の term-0 template が"
        f"ちょうど 1 回でない（実際: {_term0_count} 回）"
        "。重複注入または注入消失が起きている。"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-parallel",
    parallel=2,
    warningiserror=True,
)
def test_並列ビルドでも参照ページにフーの定義テンプレートが注入される(app):
    """[t3/正常] 並列ビルド(parallel=2): 参照ページ subdir/other.html への
    <template id="riddle-tip--term-0"> 注入が欠落せず、定義本文も含まれる。

    並列ワーカーで env が分割マージされても、term-id->home の解決は
    StandardDomain.objects 再利用で成立し、定義は get_and_resolve_doctree の
    オンデマンド解決で得られるため、注入がクラッシュ・欠落しないことを固定する。

    注意: parallel ビルドは CPU 数等で実際に並列化されない場合があるが、
    並列指定下でもクラッシュ・欠落しないことが主眼。
    """
    # Arrange/Act: parallel=2 を指定した app で実ビルドする
    app.build()

    # Act: クロスページ参照ページ subdir/other.html の出力 HTML を読む
    html = (Path(app.outdir) / "subdir" / "other.html").read_text(encoding="utf-8")

    # Assert: フーの term-id 'term-0' のテンプレートに定義本文が注入されている
    assert '<template id="riddle-tip--term-0">' in html, (
        "並列ビルド(parallel=2)で subdir/other.html に term-0 template が"
        "注入されていない（env 分割マージ下で解決が欠落した可能性）"
    )
    assert "フーの定義本体。" in html, (
        "並列ビルド(parallel=2)で注入 template に定義本文が含まれていない"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-parallel-clean-complete",
    parallel=2,
    warningiserror=True,
)
def test_並列ビルドが警告例外なく完走する(app):
    """[t8/正常] 並列ビルド(parallel=2): warningiserror=True 下で並列ビルドが
    警告・例外なく完走する。

    本拡張は metadata で parallel_read_safe=True / parallel_write_safe=True を
    宣言している。これが正しく宣言されていれば、Sphinx は parallel_*_safe でない
    拡張を検出したときに出す『doing serial read/write』系の警告を出さずに並列
    ビルドを実行できる。warningiserror=True 下なので、本拡張由来の警告（並列非対応
    宣言の欠落など）が出れば app.build() が例外を送出して落ちる。さらに、たとえ
    warningiserror に拾われない種類の警告でも残っていないことを app.warning
    ストリームが空であることで固定する（並列指定下でクラッシュ・警告なく完走する
    ことが主眼）。
    """
    # Arrange: parallel=2 / warningiserror=True を指定した app（fixture 配線）

    # Act: 並列ビルドを実行する。本拡張由来の警告が出れば warningiserror により
    # ここで例外が送出される。
    app.build()

    # Assert: 警告ストリームに何も出力されていない（警告なしで完走した）。
    warnings = app.warning.getvalue()
    assert warnings == "", (
        "並列ビルド(parallel=2) で警告が出力された（parallel_read_safe / "
        f"parallel_write_safe 宣言の欠落などが疑われる）: {warnings!r}"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-parallel-multipage",
    parallel=2,
    warningiserror=True,
)
def test_並列ビルドで複数参照ページに跨る複数termの注入が全ページで欠落しない(app):
    """[t5/境界] 並列ビルド(parallel=2): rootref / subdir/other / deepref の
    複数参照ページに跨る複数 term の注入が、並列指定下でも全ページで欠落しない。

    並列ビルドでは env がワーカーごとに分割され read 後にマージされる。term-id->home
    の解決は StandardDomain.objects 再利用、定義は get_and_resolve_doctree の
    オンデマンド解決に依存するため、ワーカー境界をまたいでも各参照ページで
    必要な全 term が注入されること（どのページでも欠落しないこと）を境界として
    固定する。

    各参照ページが参照する term は実ビルドで確認済み:
    - rootref.html        -> term-0(フー)
    - subdir/other.html   -> term-0(フー), term-foo(foo)
    - deepref.html        -> term-baz, term-crossref, term-selfanchor
    """
    # Arrange/Act: parallel=2 を指定した app で実ビルドする
    app.build()

    outdir = Path(app.outdir)

    # 各参照ページごとに「注入されているべき term-id と、その定義本文の代表テキスト」を
    # 期待値として定義する（本文まで見て空 template でないことも担保する）。
    expected = {
        "rootref.html": {
            "term-0": "フーの定義本体。",
        },
        "subdir/other.html": {
            "term-0": "フーの定義本体。",
            "term-foo": "フーの定義本体。",
        },
        "deepref.html": {
            "term-baz": "バズの定義本体。",
            "term-crossref": "クロスリファレンス用語の定義本体。",
            "term-selfanchor": "セルフアンカー用語の定義本体。",
        },
    }

    # Assert: 全参照ページ・全 term について template が注入され本文も含まれる
    for page, terms in expected.items():
        html = (outdir / page).read_text(encoding="utf-8")
        for term_id, body in terms.items():
            tag = f'<template id="riddle-tip--{term_id}">'
            assert tag in html, (
                f"並列ビルド(parallel=2)で {page} に {term_id} の template が"
                "注入されていない（ワーカー境界をまたぐ解決で欠落した）"
            )
            start = html.index(tag)
            template = html[start : html.index("</template>", start)]
            assert body in template, (
                f"並列ビルド(parallel=2)で {page} の {term_id} template に"
                f"定義本文 {body!r} が含まれていない（注入が空または欠落）"
            )


@pytest.mark.parametrize(
    ("builder", "page_path", "srcdir"),
    [
        ("dirhtml", ("subdir", "other", "index.html"), "pages-parallel-dirhtml"),
        ("singlehtml", ("index.html",), "pages-parallel-singlehtml"),
    ],
)
def test_並列ビルドがdirhtmlとsinglehtmlでも参照ページにフー定義テンプレートを欠落なく注入する(
    builder, page_path, srcdir, make_app, sphinx_test_tempdir, rootdir
):
    """[r1-3/追加] 並列ビルド(parallel=2)を dirhtml / singlehtml ビルダでも実行し、
    参照ページへの term-0(フー) 定義テンプレート注入が欠落しない。

    html 並列ハードニング(t3/t8/t5)が html 以外の builder でも成立することを固定する。
    dirhtml では参照ページ subdir/other が subdir/other/index.html へ出力され、
    singlehtml では全ドキュメントが単一 index.html へ集約される。いずれの builder でも
    並列指定下で env がワーカーごとに分割マージされても、term-id->home の解決は
    StandardDomain.objects 再利用、定義は get_and_resolve_doctree のオンデマンド解決で
    成立し、注入がクラッシュ・欠落しないこと（並列指定下でも注入が成立すること）を主眼に
    固定する（CPU 数等で実際に並列化されない場合でも注入は成立すべき）。
    """
    # Arrange: testroot 'pages' を builder ごとの一意な srcdir へコピーし、
    # parallel=2 / warningiserror=True を指定した app を組み立てる
    # （make_app は app fixture と違い testroot コピーをしないため自前でコピーする）。
    import shutil

    src = sphinx_test_tempdir / srcdir
    if not src.exists():
        shutil.copytree(rootdir / "test-pages", src)
    app = make_app(
        builder,
        srcdir=src,
        warningiserror=True,
        parallel=2,
    )

    # Act: 並列ビルドを実行する
    app.build()

    # Act: builder ごとの出力先（dirhtml: subdir/other/index.html, singlehtml: index.html）を読む
    html = Path(app.outdir).joinpath(*page_path).read_text(encoding="utf-8")

    # Assert: フーの term-id 'term-0' のテンプレートに定義本文が注入されている
    assert '<template id="riddle-tip--term-0">' in html, (
        f"並列ビルド(parallel=2)・{builder} で {'/'.join(page_path)} に term-0 "
        "template が注入されていない（env 分割マージ下で解決が欠落した可能性）"
    )
    assert "フーの定義本体。" in html, (
        f"並列ビルド(parallel=2)・{builder} で注入 template に定義本文が含まれていない"
    )


def test_並列ビルド後の増分でも定義変更が参照ページtemplateへ反映される(
    make_app, sphinx_test_tempdir, rootdir
):
    """[r1-4/境界] 並列(parallel=2)でビルドした後、index.rst の フー(term-0) 定義
    だけを書き換えて再度 parallel=2 でビルドしたとき、参照ページ subdir/other.html の
    term-0 template 本文が最新へ置換され旧本文が残らない（並列×増分の組合せ）。

    P->home 依存を html-page-context（並列書き出しではワーカープロセスで発火）で
    note_dependency すると、依存が親プロセスの env に残らず次ビルドへ永続化されない。
    その結果、並列ビルド後の増分で定義ページ index だけ変更しても参照ページ
    subdir/other が outdated と判定されず古い template が残存する。本テストは、依存記録を
    env-updated（書き出し fork 前・親プロセスで一度発火）で行うことで並列ビルドでも
    増分の再書き出しが効くことを実ビルドで固定する（逐次のみの t1 では捕捉できない
    並列特有の依存喪失を回帰ガードする）。
    """
    # Arrange: testroot 'pages' を一意な srcdir へコピーし、parallel=2 でビルドする。
    import shutil

    src = sphinx_test_tempdir / "pages-parallel-incremental"
    if not src.exists():
        shutil.copytree(rootdir / "test-pages", src)
    app = make_app("html", srcdir=src, warningiserror=True, parallel=2)
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    template_first = _extract_term_template(
        out_other.read_text(encoding="utf-8"), "term-0"
    )
    assert "フーの定義本体。" in template_first, (
        "前提崩れ: 並列1回目ビルドの注入 template に初期定義本文が無い"
    )

    # Act: 定義ページ index.rst の フー(term-0) 定義本文だけを書き換え、参照ページ
    # subdir/other.rst には触れずに parallel=2 で再ビルドする。
    index_src = src / "index.rst"
    new_body = "フーの並列増分・最新定義。差し替え済み。"
    text = index_src.read_text(encoding="utf-8").replace(
        "フーの定義本体。段落2つめ。", new_body
    )
    assert new_body in text, "前提崩れ: index.rst の定義本文を置換できなかった"
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 並列増分でも参照ページ subdir/other.html の template 本文が最新へ置換され、
    # 旧本文が残存しない（並列書き出しで依存が失われていないこと）。
    template_second = _extract_term_template(
        out_other.read_text(encoding="utf-8"), "term-0"
    )
    assert new_body in template_second, (
        "並列ビルド後の増分で参照ページ subdir/other.html の term-0 template に"
        f"最新定義本文 {new_body!r} が反映されていない（並列書き出しで P->home 依存が"
        "失われ、参照ページが再書き出しされなかった疑い）"
    )
    assert "フーの定義本体。" not in template_second, (
        "並列ビルド後の増分で参照ページ subdir/other.html の term-0 template に"
        "古い定義本文が残存している（並列×増分で古い template 残存）"
    )


def test_setup後にenv系イベント未接続かつenv_version未宣言である():
    """[t4/異常] env_version 要否ゲート: setup 実行後、本拡張のハンドラが
    'env-purge-doc' / 'env-merge-info' イベントへ connect されておらず、
    戻り値 metadata に 'env_version' が宣言されていない。

    本拡張は env に自前データを蓄積しない（term-id->home は
    StandardDomain.objects 再利用、定義は get_and_resolve_doctree の
    オンデマンド解決のみ）。よって env のシリアライズ整合に関わる env_version /
    env-merge-info / env-purge-doc は不要、という前提を回帰ガードする。
    将来 env 蓄積を足したら env_version + env-merge-info が必要になることを明示する。
    """
    # Arrange: connect 呼び出しを記録できる mock app を用意する
    app = MagicMock()

    # Act: 拡張をセットアップする
    metadata = setup(app)

    # Assert: connect されたイベント名の集合に env 系イベントが含まれない
    connected_events = {
        call.args[0] for call in app.connect.call_args_list if call.args
    }
    assert "env-purge-doc" not in connected_events, (
        "env に自前データを蓄積しない前提なのに 'env-purge-doc' が connect されている"
    )
    assert "env-merge-info" not in connected_events, (
        "env に自前データを蓄積しない前提なのに 'env-merge-info' が connect されている"
    )

    # Assert: metadata に env_version が宣言されていない
    assert "env_version" not in metadata, (
        "env に自前データを蓄積しない前提なのに metadata で 'env_version' が"
        "宣言されている"
    )


def test_connectされたイベントがenv状態管理用イベントを含まないホワイトリストである():
    """[t6/異常] env_version 要否ゲート(connect ホワイトリスト): setup 実行後に
    本拡張が connect したイベントの集合が、env シリアライズ整合に関わる
    env-purge-doc / env-merge-info を一切含まない既知のホワイトリストと一致する。

    本拡張は env に自前データを蓄積しない設計（term-id->home は
    StandardDomain.objects 再利用、定義は get_and_resolve_doctree のオンデマンド
    解決のみ）であり、env-purge-doc / env-merge-info へは接続しない。接続イベントは
    template 注入(html-page-context)・アセット登録(builder-inited)・設定検証
    (config-inited)・増分依存記録(env-updated)の 4 つに限られる。env-updated は
    Sphinx 既定の env.dependencies へ P→home 依存を記録するための親プロセス側タイミング
    フックであり、拡張独自の env データ蓄積（env-purge-doc/env-merge-info/env_version を
    要する蓄積）ではない。将来そうした蓄積を足して env-purge-doc / env-merge-info へ
    接続したら、このホワイトリストが破れて検知できる回帰ガードとする
    （負の網羅ではなく、接続イベント集合を正確に固定する）。
    """
    # Arrange: connect 呼び出しを記録できる mock app を用意する
    app = MagicMock()

    # Act: 拡張をセットアップする
    setup(app)

    # Assert: connect されたイベント名の集合が、env 系蓄積イベントを含まない既知集合と厳密一致する
    connected_events = {
        call.args[0] for call in app.connect.call_args_list if call.args
    }
    assert connected_events == {
        "html-page-context",
        "builder-inited",
        "config-inited",
        "env-updated",
    }, (
        "connect されたイベント集合が想定外（env 状態管理用イベントへの接続が"
        f"混入した可能性）。実際: {connected_events}"
    )
    # env シリアライズ整合に関わる env 蓄積イベントには接続していないこと（本丸）。
    assert "env-purge-doc" not in connected_events
    assert "env-merge-info" not in connected_events


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-rebase-404",
    warningiserror=True,
)
def test_増分ビルド後もtemplate内の内部リンクと画像が出力基準で実在し続ける(app):
    """[t7/境界] 増分ビルド: index.rst の フー(term-0) 定義本文だけを書き換えて
    再ビルドした後も、参照ページ subdir/other.html に注入された term-0 template 内の
    内部リンク・画像が、表示ページ P（subdir/other）基準で解決した宛先として実在し
    続け 404 にならない。

    観点: 注入 template 内の内部参照は home（index, ルート）基準ではなく表示ページ P
    基準へ再ベースされる（#21/#22 観点#4）。増分ビルドでは定義ページ(index)だけが
    変更され、参照ページ(subdir/other)が再書き出しされる際に再ベースが再実行される。
    このとき再ベースが壊れて home 基準のままになったり相対段数がずれたりすると、
    subdir/other.html 上で内部リンク・画像が 404 になる。増分でも再ベース後の宛先が
    実在することを実ビルド出力基準で固定する（文字列ハードコードのトートロジーでは
    なく is_file で 404 を検出）。
    """
    import re

    # Arrange: 1 回目のビルド。subdir/other.html に term-0 template が注入される。
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-0">' in html_first, (
        "前提崩れ: 1 回目ビルドで subdir/other.html に term-0 template が無い"
    )

    # Act: 定義ページ index.rst の フー(term-0) 定義本文の段落だけを書き換える。
    # :doc:/:ref:/image:: の内部参照はそのまま残し、増分で再ベースが再実行される
    # 状況を作る。参照ページ subdir/other.rst には一切手を触れない（増分の本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    text = text.replace(
        "フーの定義本体。段落2つめ。", "フーの最新定義本体。再ベース検証用。"
    )
    assert "フーの最新定義本体。再ベース検証用。" in text, (
        "前提崩れ: index.rst の定義本文を置換できなかった"
    )
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 再ビルド後の subdir/other.html の term-0 template を取り出す
    html_second = out_other.read_text(encoding="utf-8")
    start = html_second.index('<template id="riddle-tip--term-0">')
    template = html_second[start : html_second.index("</template>", start)]

    page_dir = Path(app.outdir) / "subdir"

    # 画像 src を出力基準（subdir/）で解決し、実在する（404 でない）こと
    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template)
    assert img_srcs, "増分ビルド後の term-0 template に img が無い（前提崩れ）"
    for src in img_srcs:
        if "://" in src or src.startswith(("//", "/", "data:", "mailto:")):
            continue
        resolved = (page_dir / src.split("#", 1)[0]).resolve()
        assert resolved.is_file(), (
            f"増分ビルド後、注入画像 src={src!r} が subdir/other.html 基準で"
            f" 404（{resolved}）。増分での再ベースが壊れている。"
        )

    # 内部リンク（:doc: クロスドキュメントリンク = topic ページへのリンク）href を
    # 出力基準で解決し実在すること。定義には :doc:`トピック <topic>` が含まれ、表示
    # ページ P（subdir/other）基準へ再ベースされると topic.html を指す相対 href に
    # なる。これを 404 検査する。
    # なお :ref: の同一 home 内アンカー（フラグメントのみ '#...'）や、testroot に
    # 意図的に含まれる出力ルート脱出を狙う敵対的相対リンク（../../../etc/passwd 由来）
    # は、t7 が検証する『正当な内部参照の再ベース』とは別物（前者はファイル実体を
    # 持たず、後者は出力ツリー外を指すのが正しい）なので 404 検査の対象外とする。
    hrefs = re.findall(r'<a[^>]*\bhref="([^"]*)"', template)
    doc_hrefs = [h for h in hrefs if h.split("#", 1)[0].endswith("topic.html")]
    assert doc_hrefs, (
        "増分ビルド後の term-0 template に :doc: 由来の topic.html への内部リンクが"
        "無い（前提崩れ）"
    )
    for href in doc_hrefs:
        path_part = href.split("#", 1)[0]
        resolved = (page_dir / path_part).resolve()
        assert resolved.is_file(), (
            f"増分ビルド後、:doc: 内部リンク href={href!r} が subdir/other.html"
            f" 基準で 404（{resolved}）。増分での再ベースが壊れている。"
        )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-link-structure",
    warningiserror=True,
)
def test_増分ビルドで定義側の画像差替え後に参照ページtemplateの宛先が追従し404にならない(app):
    """[r1-2/境界] 増分ビルド(リンク構造変更追従): index.rst の フー(term-0)
    定義側の画像ターゲットを別ファイルへ差し替えて再ビルドしたとき、参照ページ
    subdir/other.html に注入された term-0 template の画像宛先が新ターゲットへ
    追従し、表示ページ P（subdir/other）基準で再ベースした宛先が実在し続け
    404 にならない。

    観点: 既存 t7 は定義の『本文段落テキスト』だけを変更し既存リンク/画像が
    残ることを見るのに対し、本項目は定義側の『リンク/画像の構造そのもの』を
    変更する。定義ページ(index)だけを変更した増分ビルドで、参照ページ
    (subdir/other)が再書き出しされる際に再ベースが新ターゲットに対して
    再実行されないと、template の画像宛先が旧ターゲットのまま残り（古い構造が
    残存）、あるいは再ベースの相対段数がずれて 404 になる。これを実ビルド出力
    基準で固定する（is_file で 404 検出。文字列ハードコードのトートロジーは
    しない）。
    """
    import re

    # Arrange: 1 回目のビルド。subdir/other.html に term-0 template が注入され、
    # 定義側の画像 pic.png が P 基準へ再ベースされて存在する。
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    start = html_first.index('<template id="riddle-tip--term-0">')
    template_first = html_first[start : html_first.index("</template>", start)]
    src_first = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template_first)
    assert src_first, "前提崩れ: 1 回目ビルドの term-0 template に img が無い"
    # 1 回目は pic.png 由来の画像が再ベースされて入っている
    assert any("pic.png" in s and "pic2.png" not in s for s in src_first), (
        f"前提崩れ: 1 回目の term-0 template 画像が pic.png 由来でない: {src_first}"
    )

    # Act: 定義ページ index.rst の フー(term-0) 定義側『画像ターゲット』を
    # 別ファイル pic2.png へ差し替えて再ビルドする（リンク/画像の構造変更）。
    # 参照ページ subdir/other.rst には一切手を触れない（増分の本丸）。
    srcdir = Path(app.srcdir)
    # 新ターゲット pic2.png を srcdir に用意する（既存 pic.png のバイト列を流用）。
    (srcdir / "pic2.png").write_bytes((srcdir / "pic.png").read_bytes())

    index_src = srcdir / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    assert ".. image:: pic.png" in text, (
        "前提崩れ: index.rst に '.. image:: pic.png' が無い"
    )
    text = text.replace(".. image:: pic.png", ".. image:: pic2.png")
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 再ビルド後の subdir/other.html の term-0 template を取り出す
    html_second = out_other.read_text(encoding="utf-8")
    start2 = html_second.index('<template id="riddle-tip--term-0">')
    template_second = html_second[start2 : html_second.index("</template>", start2)]

    page_dir = Path(app.outdir) / "subdir"
    img_srcs = re.findall(r'<img[^>]*\bsrc="([^"]*)"', template_second)
    assert img_srcs, "増分ビルド後の term-0 template に img が無い（前提崩れ）"

    # 新ターゲット pic2.png 由来の画像へ追従していること（構造変更の追従）
    new_srcs = [s for s in img_srcs if "pic2.png" in s]
    assert new_srcs, (
        "増分ビルド後、term-0 template の画像が新ターゲット pic2.png へ"
        f"追従していない（旧構造が残存）: {img_srcs}"
    )

    # 旧ターゲット pic.png 由来の画像が残っていないこと（古い構造の残存防止）。
    # pic2.png は 'pic.png' を部分文字列に含まないため substring 誤判定はしない。
    old_srcs = [s for s in img_srcs if "pic.png" in s]
    assert old_srcs == [], (
        "増分ビルド後、term-0 template に旧ターゲット pic.png 由来の画像が"
        f"残存している（リンク構造変更が増分で追従していない）: {old_srcs}"
    )

    # 追従後の新ターゲット宛先が表示ページ P 基準で実在し 404 にならないこと
    for src in new_srcs:
        if "://" in src or src.startswith(("//", "/", "data:", "mailto:")):
            continue
        resolved = (page_dir / src.split("#", 1)[0]).resolve()
        assert resolved.is_file(), (
            f"増分ビルド後、追従先画像 src={src!r} が subdir/other.html 基準で"
            f" 404（{resolved}）。リンク構造変更後の再ベースが壊れている。"
        )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-parallel-incremental-replace",
    parallel=2,
    warningiserror=True,
)
def test_並列ビルド後に増分で定義変更すると参照ページtemplate本文が最新へ置換される(app):
    """[r1-4/境界] 並列×増分の組合せ: parallel=2 でビルドした後、parallel=2 の
    まま index.rst の フー(term-0) 定義本文だけを書き換えて再ビルドしたとき、
    参照ページ subdir/other.html に注入された term-0 template の本文が最新定義へ
    置換され、旧本文が残らない。

    観点(境界): 既存 t1 は逐次(serial)ビルドでの増分置換を固定するが、本項目は
    並列指定(parallel=2)下での増分置換という組合せ境界を固定する。並列ビルドでは
    env がワーカーごとに分割され read 後にマージされるため、増分時に変更ページ
    (index)の依存追跡やマージ結果が逐次ビルドと異なり、参照ページ(subdir/other)が
    再書き出しされず注入 template に古い定義本文が残る、という失敗モードが
    並列特有に起こりうる。並列指定下でも増分置換が成立し古い template が残らない
    ことを実ビルドで固定する（CPU 数等で実際に並列化されない場合でも置換は成立
    すべき）。
    """
    # Arrange: 1 回目の並列ビルド（初期定義 'フーの定義本体。' で注入される）
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-0">' in html_first, (
        "前提崩れ: 1 回目の並列ビルドで subdir/other.html に term-0 template が無い"
    )
    assert "フーの定義本体。" in html_first, (
        "前提崩れ: 1 回目の並列ビルドの注入 template に初期定義本文が無い"
    )

    # Act: 定義ページ index.rst の フー(term-0) 定義本文だけを書き換えて、
    # parallel=2 のまま再ビルドする。参照ページ subdir/other.rst には一切
    # 手を触れない（並列×増分の本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    new_body = "フーの最新定義本体。並列増分で差し替え済み。"
    text = text.replace("フーの定義本体。段落2つめ。", new_body)
    assert new_body in text, "前提崩れ: index.rst の定義本文を置換できなかった"
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 参照ページ subdir/other.html の注入 template 本文が最新へ置換され、
    # 旧本文が残っていない（並列指定下の増分でも古い template が残存しないこと）。
    html_second = out_other.read_text(encoding="utf-8")
    start = html_second.index('<template id="riddle-tip--term-0">')
    template = html_second[start : html_second.index("</template>", start)]

    assert new_body in template, (
        "並列(parallel=2)×増分ビルド後、参照ページ subdir/other.html の term-0 "
        f"template に最新定義本文 {new_body!r} が反映されていない（古い template が残存）"
    )
    assert "フーの定義本体。" not in template, (
        "並列(parallel=2)×増分ビルド後、参照ページ subdir/other.html の term-0 "
        "template に古い定義本文 'フーの定義本体。' が残存している（並列×増分で古い template 残存）"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-shared-alias",
    warningiserror=True,
)
def test_増分ビルドで共有定義変更時に別名の両term本文が共に最新へ更新される(app):
    """[r1-6/境界] 増分ビルド(複数 term-id が 1 依存を共有): index.rst の
    glossary でフー(term-0)と foo(term-foo)は同一 definition 本文を共有する。
    その共有 definition 本文だけを書き換えて再ビルドしたとき、参照ページ
    subdir/other.html に注入された term-0 と term-foo の両 template 本文が
    共に最新定義へ置換され、どちらか片方だけ古いまま残らない。

    観点(境界): 既存 t1 は単一 term の増分置換を固定するが、本項目は複数の
    term-id（term-0 / term-foo）が同一の home 定義を共有するケースを固定する。
    定義ページ(index)だけを変更した増分ビルドで、参照ページ(subdir/other)が
    再書き出しされる際に、共有 definition を参照する複数 term のうち一部の
    template だけが更新され他方は旧本文のまま残る、という失敗モード（共有依存の
    再書き出し漏れ・部分更新）が起こりうる。両 term が共に最新へ更新されることを
    実ビルドで固定する。
    """
    # Arrange: 1 回目のビルド。subdir/other.html に term-0 / term-foo の両 template が
    # 注入され、いずれも共有定義本文を含む。
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    for term_id in ("term-0", "term-foo"):
        assert f'<template id="riddle-tip--{term_id}">' in html_first, (
            f"前提崩れ: 1 回目ビルドで subdir/other.html に {term_id} template が無い"
        )
    assert html_first.count("フーの定義本体。") >= 2, (
        "前提崩れ: 1 回目ビルドで共有定義本文が両 template に入っていない"
    )

    # Act: フー/foo が共有する definition 本文だけを書き換えて再ビルドする。
    # 参照ページ subdir/other.rst には一切手を触れない（増分の本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    new_body = "フーとfooの共有最新定義本体。差し替え済み。"
    text = text.replace("フーの定義本体。段落2つめ。", new_body)
    assert new_body in text, "前提崩れ: index.rst の共有定義本文を置換できなかった"
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: term-0 / term-foo の両 template 本文が共に最新へ置換され、
    # どちらにも旧本文が残っていない（共有依存の部分更新が起きていない）。
    html_second = out_other.read_text(encoding="utf-8")
    for term_id in ("term-0", "term-foo"):
        tag = f'<template id="riddle-tip--{term_id}">'
        start = html_second.index(tag)
        template = html_second[start : html_second.index("</template>", start)]
        assert new_body in template, (
            f"増分ビルド後、subdir/other.html の {term_id} template に共有の最新"
            f"定義本文 {new_body!r} が反映されていない（共有依存の片側だけ古い残存）"
        )
        assert "フーの定義本体。" not in template, (
            f"増分ビルド後、subdir/other.html の {term_id} template に古い共有"
            "定義本文 'フーの定義本体。' が残存している（共有依存の部分更新漏れ）"
        )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-self-home-update",
    warningiserror=True,
)
def test_増分ビルドでhome自身が参照ページの場合に自己注入templateが最新へ更新される(app):
    """[r1-7/境界] 増分ビルド(home == pagename スキップ分岐の正当性):
    deep/glossary は自 home 内で定義する用語 selfword(term-selfword) を
    自ページ本文から参照する。よって deep/glossary にとって term-selfword は
    home == pagename の同一ページ参照であり、record_page_home_dependencies の
    line 80 ガード（home != pagename）で P->home の note_dependency が
    スキップされる。

    このスキップは「ページは自分のソース変更で必ず再書き出しされるので自己依存は
    冗長」という前提に基づく。本項目はその前提（スキップの正当性）を実ビルドで
    固定する: deep/glossary.rst の selfword 定義本文だけを書き換えて再ビルド
    したとき、自己依存を記録していなくても deep/glossary.html 上の自己注入
    template <template id="riddle-tip--term-selfword"> が最新定義本文へ更新され、
    旧本文が残らないこと。

    もしスキップが誤り（自己依存が本当は必要）だと、定義変更時に home ページ自身が
    再書き出しされず古い template が残るはずだが、home はソース変更により必ず
    再書き出しされるためスキップしても最新に更新される——これを固定する。
    """
    # Arrange: 1 回目のビルド。deep/glossary.html に自己注入 template
    # term-selfword が初期定義本文 'セルフ用語の定義本体。' で注入される。
    app.build()

    out_glossary = Path(app.outdir) / "deep" / "glossary.html"
    html_first = out_glossary.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-selfword">' in html_first, (
        "前提崩れ: 1 回目ビルドで deep/glossary.html に term-selfword の"
        "自己注入 template が無い"
    )
    assert "セルフ用語の定義本体。" in html_first, (
        "前提崩れ: 1 回目ビルドの自己注入 template に初期定義本文が無い"
    )

    # Act: home(=参照ページ) 自身である deep/glossary.rst の selfword 定義本文
    # だけを書き換えて再ビルドする。home == pagename なので自己依存は記録されない
    # が、ソース変更により home ページ自身は再書き出しされるはず。
    glossary_src = Path(app.srcdir) / "deep" / "glossary.rst"
    text = glossary_src.read_text(encoding="utf-8")
    old_body = "セルフ用語の定義本体。home 自身の refid 形参照だけで注入される用語。"
    new_body = "セルフ用語の最新定義本体。home 自己更新の検証用。差し替え済み。"
    assert old_body in text, "前提崩れ: deep/glossary.rst の selfword 定義本文が見つからない"
    text = text.replace(old_body, new_body)
    glossary_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: deep/glossary.html の自己注入 template 本文が最新へ置換され、
    # 旧本文が残っていない（home == pagename スキップ分岐でも最新へ更新される）。
    html_second = out_glossary.read_text(encoding="utf-8")
    start = html_second.index('<template id="riddle-tip--term-selfword">')
    template = html_second[start : html_second.index("</template>", start)]

    assert new_body in template, (
        "増分ビルド後、deep/glossary.html の自己注入 term-selfword template に"
        f"最新定義本文 {new_body!r} が反映されていない（home 自己更新が壊れている）"
    )
    assert "セルフ用語の定義本体。" not in template, (
        "増分ビルド後、deep/glossary.html の自己注入 term-selfword template に"
        "古い定義本文 'セルフ用語の定義本体。' が残存している（home == pagename "
        "スキップ分岐で古い template 残存）"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-self-ref-dep-guard",
    warningiserror=True,
)
def test_同一ページ参照ではnote_dependencyに自己依存を記録せずクロスページ参照は記録する(app):
    """[r1-5/境界] home != pagename ガード分岐の両側固定:

    - home == pagename（同一ページ参照）の場合、その term について
      ``note_dependency`` に「ページがそのページ自身を home として依存する」
      自己依存を記録しない（line 80 のガードで弾かれる）。自己依存は冗長
      （ページは自分のソース変更で必ず再書き出しされる）であり、記録すると
      意図不明な依存が env に混入する。
    - home != pagename（クロスページ参照）の場合は ``note_dependency`` を
      記録する（増分で home 定義変更時に参照ページを再書き出しさせる依存）。

    testroot 'pages' では deep/glossary が自 home 内で定義する用語
    ``selfword``(term-selfword) を自ページ本文から refid 形で参照するため、
    deep/glossary ページにとって term-selfword は home == pagename の同一
    ページ参照になる。一方 subdir/other は index で定義された term-0(フー) を
    参照するため home != pagename のクロスページ参照になる。
    """
    from sphinx_riddle_whisper.inject import record_page_home_dependencies

    # Arrange: 1 回ビルドして env / StandardDomain.objects を確定させる。
    app.build()

    # note_dependency の呼び出し (docname, dep_path) を捕捉するスパイを仕込む。
    recorded: list[tuple[str | None, str]] = []
    original_note_dependency = app.env.note_dependency

    def spy_note_dependency(filename, docname=None, **kwargs):
        recorded.append((docname, str(filename)))
        return original_note_dependency(filename, docname=docname, **kwargs)

    app.env.note_dependency = spy_note_dependency

    # 記録は env.note_dependency(path, docname=pagename) の形で「依存元ページ docname」を
    # 明示して呼ばれる。よってスパイの (docname, dep_path) で自己依存の有無を判定できる。
    deep_glossary_src = str(app.env.doc2path("deep/glossary"))
    index_src = str(app.env.doc2path("index"))

    # Act: 全ページ分の P->home 依存記録を実行する（env-updated ハンドラを直接呼ぶ）。
    record_page_home_dependencies(app, app.env)

    # Assert (home != pagename 側): index を home とするクロスページ参照依存が
    # 少なくとも 1 つ記録されている（subdir/other / rootref が term-0 を参照）。
    cross_page_deps = [
        (docname, dep) for (docname, dep) in recorded if dep == index_src
    ]
    assert cross_page_deps, (
        "home != pagename のクロスページ参照で index を home とする "
        f"note_dependency が 1 つも記録されていない（記録内容: {recorded}）"
    )

    # Assert (home == pagename 側): deep/glossary を home とする依存が記録された
    # 場合でも、その依存先 docname が deep/glossary 自身であってはならない
    # （自己依存を記録しない＝ line 80 の home != pagename ガードが効いている）。
    self_deps = [
        (docname, dep)
        for (docname, dep) in recorded
        if dep == deep_glossary_src and docname == "deep/glossary"
    ]
    assert self_deps == [], (
        "home == pagename（deep/glossary が自 home の selfword を参照）なのに "
        "deep/glossary が自分自身を home として依存する自己依存が "
        f"note_dependency に記録された（home != pagename ガード未効）: {self_deps}"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-env-no-accumulation",
    warningiserror=True,
)
def test_実ビルド後にenvへriddle専用の独自属性が蓄積されていない(app):
    """[t6/異常] env_version 要否ゲート(実ビルド): 実際に build した後の
    app.env に、本拡張が独自に蓄積した riddle 専用属性が一切生えていない。

    本拡張は env に自前データを蓄積しない設計を実ビルドで回帰固定する。env に
    自前データを蓄積していなければ env_version / env-merge-info / env-purge-doc は
    不要であり、この前提が崩れた（env に riddle 専用属性が生えた）ら検知する。
    """
    # Arrange/Act: testroot 'pages' を実ビルドする
    app.build()

    # Assert: BuildEnvironment のインスタンス属性に 'riddle' を含む名前が無い
    #         （本拡張が env へ独自データを蓄積していないこと）
    riddle_attrs = [name for name in vars(app.env) if "riddle" in name.lower()]
    assert riddle_attrs == [], (
        "実ビルド後の app.env に riddle 専用の独自属性が蓄積されている"
        f"（env への自前データ蓄積は設計違反）: {riddle_attrs}"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-domaindata-no-riddle",
    warningiserror=True,
)
def test_実ビルド後にenvのdomaindataにriddle専用ドメインのキーが追加されていない(app):
    """[r1-14/異常] env_version 要否ゲート(ドメインデータ経路): 実際に build した
    後の app.env.domaindata のキー集合に、本拡張が独自に登録した riddle 専用
    ドメインのキーが一切含まれていない。

    既存の t6 実ビルド版は app.env のインスタンス『直属性名』に 'riddle' が
    無いことを見るが、Sphinx で env に自前データを蓄積する正規経路は
    app.add_domain(...) で登録したカスタムドメインの env.domaindata[ドメイン名]
    である。本拡張は term-id->home を StandardDomain.objects 再利用、定義を
    get_and_resolve_doctree のオンデマンド解決で得る設計で、自前ドメインを
    登録しない。よって domaindata のキー集合に riddle 専用ドメインが現れない
    ことを実ビルドで回帰固定する。将来 add_domain で riddle ドメインを足して env
    にデータを蓄積したら、env_version + env-merge-info が必要になる——その前提
    崩れを domaindata 経路で検知する（直属性名だけでなくドメインデータ経路の
    自前蓄積なしを固定）。
    """
    # Arrange/Act: testroot 'pages' を実ビルドする
    app.build()

    # Assert: env.domaindata のキー集合に 'riddle' を含む名前のドメインが無い
    #         （本拡張が add_domain で riddle 専用ドメインを登録し env へデータを
    #          蓄積していないこと）
    domain_keys = list(app.env.domaindata.keys())
    riddle_domain_keys = [name for name in domain_keys if "riddle" in name.lower()]
    assert riddle_domain_keys == [], (
        "実ビルド後の app.env.domaindata に riddle 専用ドメインのキーが追加されて"
        f"いる（ドメインデータ経路での env 自前蓄積は設計違反）: {riddle_domain_keys}"
        f"（domaindata キー集合全体: {domain_keys}）"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-ref-body-edit",
    warningiserror=True,
)
def test_増分ビルドで参照ページ本文だけを書き換えても注入templateが消失重複せず最新本文と整合する(
    app,
):
    """[r1-8/境界] 増分ビルド(依存方向が逆のケース): 参照ページ subdir/other.rst
    自身の本文だけを書き換え（:term:`フー` 参照は維持し、定義 home の index.rst は
    不変）て再ビルドしたとき、参照ページ subdir/other.html について:

    1. 書き換えた最新の参照ページ本文が出力 HTML に反映される（ページ自身の
       ソース変更により再書き出しされる）。
    2. 注入 template <template id="riddle-tip--term-0"> がちょうど 1 回だけ存在する
       （消失せず・重複せず）。
    3. その template 本文には不変の定義本文 'フーの定義本体。' が依然含まれる
       （定義 home は変わっていないので注入内容も維持される）。

    t1 等の『定義側を変えて参照側を追従させる』前向き依存とは逆に、本項目は
    『参照ページ側の本文だけを変える』依存方向が逆のケースを固定する。参照ページは
    自分のソース変更で必ず再書き出しされるため、html-page-context での再注入が
    1 回だけ正しく走り、最新本文と注入 template が整合することを実ビルドで固定する。
    """
    # Arrange: 1 回目のビルド。subdir/other.html に term-0 template が
    # ちょうど 1 回注入され、定義本文を含む。
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    assert html_first.count('id="riddle-tip--term-0"') == 1, (
        "前提崩れ: 1 回目ビルドで subdir/other.html の term-0 template が"
        "ちょうど 1 回でない"
    )
    assert "フーの定義本体。" in html_first, (
        "前提崩れ: 1 回目ビルドの注入 template に定義本文が無い"
    )

    # Act: 参照ページ subdir/other.rst 自身の本文だけを書き換える。
    # :term:`フー` 参照は維持し、定義ページ index.rst には一切手を触れない
    # （依存方向が逆＝参照ページ側だけの変更が本丸）。
    other_src = Path(app.srcdir) / "subdir" / "other.rst"
    text = other_src.read_text(encoding="utf-8")
    marker = "本文から :term:`フー` を参照する（サブディレクトリ・クロスページ）。"
    assert marker in text, "前提崩れ: subdir/other.rst の term 参照行が見つからない"
    new_paragraph = "参照ページ本文の追記段落。差し替え済みの最新コンテンツ。"
    text = text.replace(marker, marker + "\n\n" + new_paragraph)
    other_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 参照ページ subdir/other.html が再書き出しされ最新本文を反映し、
    # かつ term-0 template が消失も重複もせずちょうど 1 回・定義本文も維持される。
    html_second = out_other.read_text(encoding="utf-8")

    assert new_paragraph in html_second, (
        "増分ビルド後、参照ページ subdir/other.html に書き換えた最新本文"
        f" {new_paragraph!r} が反映されていない（参照ページが再書き出しされていない）"
    )
    _term0_count2 = html_second.count('id="riddle-tip--term-0"')
    assert _term0_count2 == 1, (
        "増分ビルド後、subdir/other.html の term-0 template が"
        f"ちょうど 1 回でない（実際: {_term0_count2} 回）"
        "。参照ページ本文変更で再注入が消失または重複した。"
    )
    start = html_second.index('<template id="riddle-tip--term-0">')
    template = html_second[start : html_second.index("</template>", start)]
    assert "フーの定義本体。" in template, (
        "増分ビルド後、subdir/other.html の term-0 template から不変の定義本文"
        " 'フーの定義本体。' が失われている（参照ページ本文変更で注入内容が壊れた）"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-parallel-real-fork",
    parallel=2,
    warningiserror=True,
)
def test_並列ビルドで実際にワーカープロセスがforkされた上で注入が成立する(
    app, monkeypatch
):
    """[r1-12/追加] 並列ビルド(parallel=2): serial フォールバックではなく実際に
    ワーカープロセスが fork された『真の並列読み込み経路』を通った上で、参照ページ
    subdir/other.html への <template id="riddle-tip--term-0"> 注入が成立する。

    既存の並列テスト(t3/t8/t5/r1-3/r1-4/r1-11)は parallel=2 を指定するものの、
    Sphinx は CPU 数等により実際には並列化せず serial にフォールバックすることが
    あり、その場合でも注入が成立すれば通ってしまう（真の並列経路を踏んだ保証が
    ない）。本項目は『実際に fork された』ことを観測する点で他と異なる。

    観測方法(トートロジー回避): Sphinx の並列読み込み(_read_parallel)は
    sphinx.builders.ParallelTasks.add_task でサブプロセスを fork してチャンクを
    処理する。serial フォールバック(_read_serial)ではこの経路を一切通らない。
    そこで add_task をスパイし、ビルド中に 1 回以上 fork task が積まれたこと
    （= 真の並列読み込み経路を通ったこと）を確認した上で、その並列読み込みを経た
    出力に term-0 template が欠落なく注入されることを固定する。

    前提: testroot 'pages' は 6 ドキュメントあり make_chunks(6, nproc=2) は
    複数チャンクを生成するため、parallel_available かつ parallel_read_safe=True が
    宣言されていれば実 fork が発生する。本拡張が parallel_read_safe を宣言し損ねて
    serial にフォールバックすると add_task が一度も呼ばれず Red になる。
    """
    import sphinx.builders as _builders_mod

    # Arrange: 実際に fork する並列タスク投入(add_task)をスパイで記録する。
    # _read_parallel が呼ばれた場合のみ add_task が走り、サブプロセスが fork される。
    fork_task_calls: list[int] = []
    original_add_task = _builders_mod.ParallelTasks.add_task

    def spy_add_task(self, *args, **kwargs):
        fork_task_calls.append(id(self))
        return original_add_task(self, *args, **kwargs)

    monkeypatch.setattr(
        _builders_mod.ParallelTasks, "add_task", spy_add_task
    )

    # Act: parallel=2 で実ビルドする。
    app.build()

    # Assert(真の並列経路): 並列読み込みのサブプロセス fork が 1 回以上発生した
    # （serial フォールバックなら add_task は一度も呼ばれない）。
    assert fork_task_calls, (
        "parallel=2 指定なのに並列ワーカーの fork(ParallelTasks.add_task)が一度も"
        "発生しなかった（serial フォールバックした＝真の並列読み込み経路を踏んで"
        "いない。parallel_read_safe=True 宣言の欠落などが疑われる）"
    )

    # Assert(注入成立): 真の並列読み込みを経た出力でも term-0 template が
    # 欠落なく注入され、定義本文も含まれる。
    html = (Path(app.outdir) / "subdir" / "other.html").read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-0">' in html, (
        "実 fork を伴う並列ビルドで subdir/other.html に term-0 template が"
        "注入されていない（真の並列読み込み経路で解決が欠落した）"
    )
    assert "フーの定義本体。" in html, (
        "実 fork を伴う並列ビルドで注入 template に定義本文が含まれていない"
    )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-parallel-incremental-traversal-clamp",
    parallel=2,
    warningiserror=True,
)
def test_並列増分ビルドで敵対的相対リンクが出力ルート内へクランプされ続ける(app):
    """[r1-11/セキュリティ] 並列(parallel=2)+増分ビルド双方で、定義(index の フー/
    term-0)に含まれる敵対的相対リンク ``../../../etc/passwd`` が参照ページ
    subdir/other.html へ注入・再ベースされても、出力 href が常に出力ルート内へ
    クランプされ、出力ツリー外（ルートより上位）を指さないこと。

    観点: セキュリティ（ディレクトリトラバーサル防止）。home(index, ルート)文脈で
    解決した定義中の ``../../../etc/passwd`` を別ディレクトリの表示ページ P
    (subdir/other, 出力ルートからの深さ 1)基準へ再ベースすると、過剰な ``../`` が
    出力ルートより上位を指しうる。再ベースは P の出力深さを超える先頭 ``..`` を
    取り除いて出力ルート直下へ丸める必要がある。並列ワーカーでの env 分割マージや、
    定義ページだけを変えた増分での参照ページ再書き出し時にも、この再ベース＝
    クランプが一貫して効くことを実ビルド出力基準で固定する。

    検証方法（トートロジー回避）: 出力 href 文字列のハードコード一致では検証せず、
    href を表示ページ P の出力ディレクトリ基準で解決した実宛先パスが、出力ルート
    ``Path(app.outdir).resolve()`` の内側（配下）に留まり、ルートより上位へ脱出
    しないことを ``relative_to`` で判定する（#21/#22 の出力基準解決方針に準拠）。
    """
    import re

    out_root = Path(app.outdir).resolve()
    page_dir = Path(app.outdir) / "subdir"
    out_other = Path(app.outdir) / "subdir" / "other.html"

    def _adversarial_href(html: str) -> str:
        """subdir/other.html の term-0 template から敵対的相対リンクの href を抽出する。"""
        start = html.index('<template id="riddle-tip--term-0">')
        template = html[start : html.index("</template>", start)]
        hrefs = re.findall(r'<a[^>]*\bhref="([^"]*)"', template)
        # ../../../etc/passwd 由来＝末尾が 'etc/passwd' を含むクランプ後 href を特定する。
        candidates = [h for h in hrefs if "etc/passwd" in h]
        assert candidates, (
            "前提崩れ: term-0 template に敵対的相対リンク(../../../etc/passwd 由来)の"
            f" href が無い（hrefs={hrefs!r}）"
        )
        return candidates[0]

    def _assert_clamped_within_root(href: str, phase: str) -> None:
        """href を P 出力ディレクトリ基準で解決した宛先が出力ルート内に留まることを検証する。"""
        path_part = href.split("#", 1)[0]
        # 外部・絶対 URL は再ベース対象外なので本検証の範囲外（敵対リンクは相対のはず）。
        assert not (
            "://" in path_part
            or path_part.startswith(("//", "/", "data:", "mailto:"))
        ), f"{phase}: 敵対的相対リンクが相対 href でない（href={href!r}）"
        resolved = (page_dir.resolve() / path_part).resolve()
        # 出力ルートの内側（配下）に留まること。ルートより上位を指すと relative_to が
        # ValueError を送出する＝クランプが効かず出力ツリー外へ脱出している。
        try:
            resolved.relative_to(out_root)
        except ValueError:
            raise AssertionError(
                f"{phase}: 敵対的相対リンク href={href!r} が出力ルート外を指す"
                f"（解決先 {resolved} は出力ルート {out_root} の上位）。"
                "再ベースのクランプ（パストラバーサル防止）が効いていない。"
            )

    # Arrange/Act(並列): parallel=2 で実ビルドする。
    app.build()
    html_first = out_other.read_text(encoding="utf-8")

    # Assert(並列): 並列指定下でも敵対 href が出力ルート内へクランプされている。
    _assert_clamped_within_root(_adversarial_href(html_first), phase="並列ビルド")

    # Act(増分): 定義ページ index.rst の フー定義本文だけを書き換えて再ビルドする。
    # 敵対的相対リンク ../../../etc/passwd の行はそのまま残し、参照ページ
    # subdir/other.rst には一切触れない（増分での再ベース＝クランプ再実行が本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    text = text.replace(
        "フーの定義本体。段落2つめ。", "フーの最新定義本体。クランプ回帰検証用。"
    )
    assert "フーの最新定義本体。クランプ回帰検証用。" in text, (
        "前提崩れ: index.rst の定義本文を置換できなかった"
    )
    assert "../../../etc/passwd" in text, (
        "前提崩れ: 敵対的相対リンク ../../../etc/passwd が定義から失われた"
    )
    index_src.write_text(text, encoding="utf-8")

    app.build()
    html_second = out_other.read_text(encoding="utf-8")

    # Assert(増分): 定義変更後の増分再ベースでも敵対 href が出力ルート内へクランプ
    # され続ける（古い／壊れた相対段数で出力ツリー外へ脱出しない）。
    _assert_clamped_within_root(_adversarial_href(html_second), phase="増分ビルド")


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-incremental-termid-vanish",
    warningiserror=True,
)
def test_増分ビルドでtermidが消えた定義変更時に参照ページの古いtemplateが残存しない(app):
    """[r1-13/異常] 増分ビルド(term-id が消える定義変更): glossary の用語順を
    変えてフーの term-id を term-0 から別 id へずらしたとき、参照ページ
    subdir/other.html から旧 term-id(term-0) の <template> が残存せず除去され、
    フーの新しい term-id の template へ整合すること。

    観点(異常): glossary の term-id は用語の出現順で自動採番される（フー=term-0,
    foo=term-foo, バー=term-1）。定義ページ index.rst のフーより前に新しい用語を
    1 つ挿入すると、フーの term-id は term-0 から別の番号へずれ、term-0 は新しい
    用語（参照ページが参照しない用語）に割り当たる。つまり参照ページ subdir/other
    から見ると「自分が以前注入していた term-0 という id がもう自分の参照対象では
    なくなる（消える）」状況になる。

    増分ビルドでは定義ページ(index)だけが変更され、参照ページ(subdir/other)が
    再書き出しされないと、subdir/other.html に注入された旧 <template
    id="riddle-tip--term-0"> が張りっぱなしで残存する（spec の失敗モード『増分で
    古い template 残存』の term-id 消滅版）。参照ページが index への依存で outdated
    と判定され再書き出しされ、再注入時に extract_referenced_term_ids が新しい
    term-id を返すことで、旧 term-0 template が消え新 term-id template へ整合する
    ことを実ビルドで固定する。

    重要: subdir/other.rst の :term:`フー` 参照自体は維持する（用語名は変えず、
    出現順だけ変えて term-id をずらす）。これにより :term: クロス参照は壊れず
    （warningiserror=True を満たす）、純粋に「term-id が消えたときの旧 template
    除去」だけを検証できる。
    """
    import re

    # Arrange: 1 回目のビルド。subdir/other.html にフーの term-0 template が注入される。
    app.build()

    out_other = Path(app.outdir) / "subdir" / "other.html"
    html_first = out_other.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-0">' in html_first, (
        "前提崩れ: 1 回目ビルドで subdir/other.html にフーの term-0 template が無い"
    )
    # 1 回目時点でフーは term-0、foo は term-foo（自動採番の前提を固定）
    first_ids = set(re.findall(r'id="riddle-tip--(term-[\w]+)"', html_first))
    assert "term-0" in first_ids and "term-foo" in first_ids, (
        f"前提崩れ: 1 回目ビルドの subdir/other.html の term-id 集合が想定外: {first_ids}"
    )

    # Act: 定義ページ index.rst のフー(term-0)の直前に新しい glossary 用語を 1 つ
    # 挿入し、フーの term-id を term-0 から別番号へずらす。フーという用語名と
    # subdir/other.rst の :term:`フー` 参照は一切変えない（参照ページには手を触れ
    # ない＝増分の本丸）。
    index_src = Path(app.srcdir) / "index.rst"
    text = index_src.read_text(encoding="utf-8")
    inserted = "   ゼロ番用語\n      ゼロ番用語の定義本体。挿入により term-0 を奪う。\n\n   フー"
    text = text.replace("   フー", inserted, 1)
    assert "ゼロ番用語" in text, "前提崩れ: index.rst へ先頭用語を挿入できなかった"
    index_src.write_text(text, encoding="utf-8")

    app.build()

    # Assert: 参照ページ subdir/other.html が再書き出しされ、旧 term-0 template が
    # 残存せず除去されている。フーは別 term-id へ移ったため、term-0 は subdir/other
    # が参照しない用語(ゼロ番用語)の id になっており、subdir/other.html には注入
    # されないはず。
    html_second = out_other.read_text(encoding="utf-8")
    second_ids = set(re.findall(r'id="riddle-tip--(term-[\w]+)"', html_second))

    assert "riddle-tip--term-0" not in html_second, (
        "増分ビルドでフーの term-id が term-0 から移ったのに、参照ページ "
        "subdir/other.html に旧 term-0 の template が残存している"
        f"（term-id 消滅時の古い template 残存）。注入 id 集合: {second_ids}"
    )
    # フーの :term: 参照は維持しているので、フーの新 term-id の template と
    # 別名 foo(term-foo) の template は引き続き注入され、フーの定義本文も含まれる。
    assert "term-foo" in second_ids, (
        "増分ビルド後、別名 foo(term-foo) の template が subdir/other.html から"
        f"失われている（再注入が壊れた）。注入 id 集合: {second_ids}"
    )
    assert "フーの定義本体。" in html_second, (
        "増分ビルド後、subdir/other.html の注入 template にフーの定義本文が"
        "含まれていない（term-id がずれた結果フーの注入が欠落した）"
    )


def test_並列ビルドの注入templateが直列ビルドと完全一致する(
    make_app, sphinx_test_tempdir, rootdir
):
    """[r1-15/追加] オラクル比較: 同一 testroot 'pages' を直列(serial)ビルドと
    並列(parallel=2)ビルドの両方で実行し、全参照ページに注入された
    <template id="riddle-tip--...">...</template> ブロックの内容が、並列と直列で
    完全一致する（並列/直列で出力が乖離しない）こと。

    観点(追加): 既存の並列テスト(t3/t8/t5/r1-3/r1-4/r1-11/r1-12)は「並列でも
    注入が欠落・クラッシュしない」ことを個別に固定するが、いずれも期待 term-id /
    期待本文を明示してその存在を見るものであり、「並列の出力が直列の出力と
    同一か」というオラクル比較ではない。並列ビルドでは env がワーカーごとに分割
    され read 後にマージされるため、term-id->home の解決順序やマージ結果が直列と
    異なり、注入 template の内容・件数・順序・再ベース結果などが直列とわずかに
    乖離する失敗モードが並列特有に起こりうる。本項目は直列ビルドの注入結果を
    オラクルとして、並列ビルドの注入結果がそれと完全一致することを固定する
    （期待値のハードコードではなく serial 出力そのものをオラクルにする）。

    注意: parallel ビルドは CPU 数等で実際には並列化されず serial フォールバック
    する場合があるが、その場合でも当然一致する。乖離が起きるのは真の並列経路を
    通ったときであり、本テストは「並列指定下でも直列と乖離しない」ことを主眼に
    固定する。
    """
    import re
    import shutil

    def _injected_templates_by_page(outdir: Path) -> dict[str, list[str]]:
        """出力ディレクトリ配下の全 .html から、注入された
        <template id="riddle-tip--...">...</template> ブロックを
        ページ相対パスごとに収集して返す（オラクル比較の対象）。"""
        pattern = re.compile(
            r'<template id="riddle-tip--[^"]+">.*?</template>', re.DOTALL
        )
        result: dict[str, list[str]] = {}
        for html_path in sorted(outdir.rglob("*.html")):
            text = html_path.read_text(encoding="utf-8")
            blocks = pattern.findall(text)
            if blocks:
                rel = html_path.relative_to(outdir).as_posix()
                result[rel] = blocks
        return result

    # Arrange: 同一 testroot 'pages' を直列用・並列用の別 srcdir へそれぞれコピーし、
    # 直列(parallel 指定なし)と parallel=2 の 2 つの app を組み立てる。
    serial_src = sphinx_test_tempdir / "pages-oracle-serial"
    parallel_src = sphinx_test_tempdir / "pages-oracle-parallel"
    for src in (serial_src, parallel_src):
        if not src.exists():
            shutil.copytree(rootdir / "test-pages", src)

    serial_app = make_app("html", srcdir=serial_src, warningiserror=True)
    parallel_app = make_app(
        "html", srcdir=parallel_src, warningiserror=True, parallel=2
    )

    # Act: 直列ビルドと並列ビルドをそれぞれ実行し、注入 template をページごとに収集する。
    serial_app.build()
    parallel_app.build()

    serial_templates = _injected_templates_by_page(Path(serial_app.outdir))
    parallel_templates = _injected_templates_by_page(Path(parallel_app.outdir))

    # 前提崩れ防止: そもそも注入が 1 件も無いとオラクル比較が空回りするので確認する。
    assert serial_templates, (
        "前提崩れ: 直列ビルドの出力に注入 template が 1 件も無い"
    )

    # Assert(オラクル比較): 注入 template を持つページ集合が一致する。
    assert set(parallel_templates) == set(serial_templates), (
        "並列ビルドと直列ビルドで注入 template を持つ参照ページの集合が乖離した"
        f"（直列のみ: {set(serial_templates) - set(parallel_templates)}, "
        f"並列のみ: {set(parallel_templates) - set(serial_templates)}）"
    )

    # Assert(オラクル比較): 各ページについて、注入 template ブロック列が
    # 並列と直列で完全一致する（件数・内容・順序まで）。直列出力をオラクルにする。
    for page, serial_blocks in serial_templates.items():
        parallel_blocks = parallel_templates[page]
        assert parallel_blocks == serial_blocks, (
            f"参照ページ {page} の注入 template が並列ビルドと直列ビルドで一致しない"
            "（並列/直列で出力が乖離した。env 分割マージ下で解決順序・内容・件数の"
            f"いずれかがずれた）。\n直列: {serial_blocks!r}\n並列: {parallel_blocks!r}"
        )


@pytest.mark.sphinx(
    "html",
    testroot="pages",
    srcdir="pages-dep-record-no-resolve",
    warningiserror=True,
)
def test_P_home依存記録はget_and_resolve_doctreeでフル解決しない(app):
    """[perf/退行ガード] env-updated の P->home 依存記録経路
    (record_page_home_dependencies) が、全 doc の
    ``get_and_resolve_doctree``（post-transform 込みフル解決）を一切呼ばないこと。

    観点(性能契約): 依存記録に必要なのは「ページ P が参照する term の home」だけで、
    解決時に確定する term-id は不要。未解決 doctree(env.get_doctree)＋用語名索引
    (StandardDomain.objects)で home は求まるため、フル解決は不要である。

    本拡張の env-updated ハンドラは毎ビルド（フル/増分とも）に発火する。ここで
    ``env.all_docs`` 全件を ``get_and_resolve_doctree`` でフル解決すると、増分ビルドで
    変更の無い doc まで post-transform 込みで再解決し、増分の利点（変更 doc とその依存
    のみ処理）を打ち消す。本テストは「依存記録経路はフル解決を行わない」ことを性能契約
    として固定し、その退行（全 doc フル解決の再混入）を検知する。

    トートロジー回避: 出力 HTML 文字列のハードコード一致ではなく、
    ``env.get_and_resolve_doctree`` の呼び出し有無そのものを観測して契約を固定する。
    """
    from sphinx_riddle_whisper.inject import record_page_home_dependencies

    # Arrange: 1 回ビルドして env / StandardDomain.objects / 未解決 doctree を確定させる。
    app.build()

    # get_and_resolve_doctree（フル解決）の呼び出しを記録するスパイを仕込む。
    resolved_calls: list[str] = []
    original_resolve = app.env.get_and_resolve_doctree

    def spy_get_and_resolve_doctree(docname, *args, **kwargs):
        resolved_calls.append(docname)
        return original_resolve(docname, *args, **kwargs)

    app.env.get_and_resolve_doctree = spy_get_and_resolve_doctree

    # Act: 全ページ分の P->home 依存記録を実行する（env-updated ハンドラを直接呼ぶ）。
    record_page_home_dependencies(app, app.env)

    # Assert: 依存記録経路でフル解決(get_and_resolve_doctree)が一度も呼ばれていない
    # （未解決 doctree＋用語名索引のみで依存を求めている＝増分の利点を消さない）。
    assert resolved_calls == [], (
        "P->home 依存記録経路が get_and_resolve_doctree でフル解決している"
        f"（増分の利点を打ち消す全 doc フル解決の退行）: {resolved_calls}"
    )
