"""深さ2（ネスト）template 注入の検証テスト。

testroot='nested' の参照構造:

- index 本文 → alpha（レベル1）
- alpha の定義 → beta / delta（レベル2。delta は別 home の glossary2）
- beta の定義 → gamma（index から見て深さ3 → 注入されない）
"""

from pathlib import Path

import pytest


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_定義内から参照されるtermの定義もページへ注入される(app):
    """index は alpha だけを参照するが、alpha の定義内参照（beta）の template も
    index.html へ注入される（深さ2の推移的収集）。"""
    # Arrange & Act: testroot='nested' を実ビルドする
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: レベル1（alpha）とレベル2（beta）の両 template がある
    assert '<template id="riddle-tip--term-alpha">' in html
    assert '<template id="riddle-tip--term-beta">' in html


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_別homeの定義内参照termも注入される(app):
    """alpha の定義が参照する delta は別 home（glossary2）だが、
    その template も index.html へ注入される。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert '<template id="riddle-tip--term-delta">' in html


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_深さ3のterm定義は注入されない(app):
    """beta の定義だけが参照する gamma（深さ3）の template は
    index.html へ注入されない（固定2段）。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert "riddle-tip--term-gamma" not in html


@pytest.mark.sphinx("html", testroot="nested", warningiserror=True)
def test_本文と定義内の両方から参照されるtermのtemplateは1回だけ注入される(app):
    """both は alpha（定義内に beta 参照）と beta の両方を本文参照するが、
    beta の template は both.html にちょうど1回だけ出る（dedup）。"""
    app.build()
    html = (Path(app.outdir) / "both.html").read_text(encoding="utf-8")

    assert html.count('id="riddle-tip--term-beta"') == 1


@pytest.mark.sphinx(
    "html",
    testroot="nested",
    warningiserror=True,
    confoverrides={"riddle_nested": False},
)
def test_riddle_nested無効時はレベル2のtemplateが注入されない(app):
    """riddle_nested=False では現行（レベル1のみ）と同じ注入になる。"""
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    assert '<template id="riddle-tip--term-alpha">' in html
    assert "riddle-tip--term-beta" not in html
    assert "riddle-tip--term-delta" not in html


# 依存テスト2件は srcdir を分離する（他テストと _build/doctrees の env pickle を
# 共有すると、riddle_nested の rebuild 条件が 'html'（再読み込みなし）のため
# env.dependencies が前テストのビルドから残存し、glossary の残存依存
# （glossary2.rst）が伝播行で both へ混入して検証にならない）。
@pytest.mark.sphinx(
    "html", testroot="nested", srcdir="nested-deps", warningiserror=True
)
def test_定義内参照の別home依存が記録される(app):
    """both が参照する alpha の定義は delta（home=glossary2）を参照するため、
    glossary2 のソースも both の依存として記録される（増分ビルドで glossary2
    だけ変更しても both が再書き出しされる）。

    対象ページには index でなく both を使う。record_page_home_dependencies は
    env.all_docs を docname 昇順（both → glossary → glossary2 → index）で処理し、
    home 自身の既存依存を参照ページへ伝播する既存仕様（v1.0.0 由来）がある。
    glossary.rst 自身の本文が :term:`delta` を含むため glossary → glossary2 の
    レベル1依存が riddle_nested と無関係に記録され、glossary より後に処理される
    index にはその伝播だけで glossary2 が混入してしまい新ロジックの検証にならない。
    glossary より先に処理される both なら伝播は空で、レベル2の新ロジックだけが
    glossary2 を依存へ加える。"""
    app.build()

    deps = {str(d) for d in app.env.dependencies.get("both", set())}

    assert str(app.env.doc2path("glossary2")) in deps


@pytest.mark.sphinx(
    "html",
    testroot="nested",
    srcdir="nested-deps-disabled",
    warningiserror=True,
    confoverrides={"riddle_nested": False},
)
def test_riddle_nested無効時は定義内参照の依存が記録されない(app):
    """riddle_nested=False では推移依存を記録しない（現行と同じ依存集合）。
    対象ページに both を使う理由は test_定義内参照の別home依存が記録される と同じ。"""
    app.build()

    deps = {str(d) for d in app.env.dependencies.get("both", set())}

    assert str(app.env.doc2path("glossary")) in deps  # レベル1依存は従来どおり
    assert str(app.env.doc2path("glossary2")) not in deps


def test_riddle_nested切替後の増分ビルドでレベル2定義変更が参照ページへ反映される(
    make_app, sphinx_test_tempdir, rootdir
):
    """[切替増分回帰/境界] riddle_nested=False で一度ビルドした環境を True へ切り替えた後、
    レベル2 term の home（glossary2.rst）だけを変更した増分ビルドで、参照ページ
    both.html の term-delta template 本文が最新へ置換され旧本文が残らない。

    依存記録ハンドラ record_page_home_dependencies は env-updated（毎ビルド発火）で
    env.all_docs 全件を対象に、riddle_nested を実行時の config から読んで P→home
    依存を再記録する。「毎ビルド・全ページ・実行時 config」の3点が揃うことで、設定
    切替をまたいだ増分ビルドでもレベル2 home 依存が同一ビルド内の outdated 判定に
    間に合い、参照ページが再書き出しされる。将来ハンドラを更新 doc のみへ絞る・
    riddle_nested を setup 時にキャッシュする等の変更をすると、この切替→増分
    シナリオで古い template が残存するため E2E で固定する(外部レビュー指摘 M-1 の
    検証過程で作成。M-1 自体は再現せず誤診断と判明し、rebuild 区分は 'html' のまま)。
    """
    import shutil

    # Arrange: testroot 'nested' を一意な srcdir へコピーし、riddle_nested=False で
    # 初回ビルドする（make_app は app fixture と違い testroot コピーをしないため
    # 自前でコピーする）。
    src = sphinx_test_tempdir / "nested-toggle-incremental"
    if not src.exists():
        shutil.copytree(rootdir / "test-nested", src)
    app_disabled = make_app(
        "html",
        srcdir=src,
        warningiserror=True,
        confoverrides={"riddle_nested": False},
    )
    app_disabled.build()

    out_both = Path(app_disabled.outdir) / "both.html"
    assert "riddle-tip--term-delta" not in out_both.read_text(encoding="utf-8"), (
        "前提崩れ: riddle_nested=False の初回ビルドで both.html にレベル2 "
        "template（term-delta）が注入されている"
    )

    # Act(切替): 同じ srcdir（= 同じ outdir/doctreedir・env pickle 引き継ぎ）で
    # riddle_nested=True へ切り替えて再ビルドする。
    app_enabled = make_app(
        "html",
        srcdir=src,
        warningiserror=True,
        confoverrides={"riddle_nested": True},
    )
    app_enabled.build()

    html_after_toggle = out_both.read_text(encoding="utf-8")
    assert '<template id="riddle-tip--term-delta">' in html_after_toggle, (
        "前提崩れ: True へ切替後の both.html に term-delta template が無い"
    )
    assert "delta の定義本体。" in html_after_toggle, (
        "前提崩れ: 切替後の term-delta template に初期定義本文が無い"
    )

    # Act(増分): レベル2 term の home である glossary2.rst の delta 定義本文だけを
    # 書き換えて増分ビルドする。参照ページ both.rst には一切手を触れない
    # （切替後増分の本丸）。
    glossary2_src = src / "glossary2.rst"
    text = glossary2_src.read_text(encoding="utf-8")
    new_body = "delta の更新後定義。切替増分の検証用。"
    text = text.replace("delta の定義本体。", new_body)
    assert new_body in text, (
        "前提崩れ: glossary2.rst の delta 定義本文を置換できなかった"
    )
    glossary2_src.write_text(text, encoding="utf-8")

    app_enabled.build()

    # Assert: both.html の term-delta template 本文が最新へ置換され、旧本文が
    # 残っていない（切替後の増分でレベル2依存が効いていること）。
    html_second = out_both.read_text(encoding="utf-8")
    start = html_second.index('<template id="riddle-tip--term-delta">')
    template = html_second[start : html_second.index("</template>", start)]
    assert new_body in template, (
        "riddle_nested=False→True 切替後の増分ビルドで、both.html の term-delta "
        f"template に最新定義本文 {new_body!r} が反映されていない（増分ビルドの "
        "env-updated でレベル2 home 依存が再記録されず both が再書き出しされなかった疑い）"
    )
    assert "delta の定義本体。" not in template, (
        "riddle_nested=False→True 切替後の増分ビルドで、both.html の term-delta "
        "template に古い定義本文が残存している（切替後の増分でレベル2依存が効いていない）"
    )


@pytest.mark.sphinx(
    "singlehtml",
    testroot="nested",
    srcdir="nested-singlehtml",
    warningiserror=True,
)
def test_singlehtmlでも定義内参照termのtemplateが単一ページへ注入される(app):
    """[L-1回帰/境界] singlehtml では :term: 参照の refuri が
    '#document-<docname>#term-*' の二重フラグメント形になり、全ドキュメントが
    単一 index.html へ集約される。この経路でも別 home の定義内参照 term（delta）の
    template が注入されること、および本文参照（レベル1）と定義内参照（レベル2）の
    両経路で収集される term（beta）の template が重複しないことを固定する
    （外部レビュー指摘 L-1: ネスト注入の singlehtml 結合テスト欠落）。
    """
    # Arrange & Act: testroot='nested' を singlehtml で実ビルドする
    app.build()
    html = (Path(app.outdir) / "index.html").read_text(encoding="utf-8")

    # Assert: 別 home（glossary2）の定義内参照 term（delta）の template が
    # 単一 index.html へ注入されている
    assert '<template id="riddle-tip--term-delta">' in html, (
        "singlehtml で別 home の定義内参照 term（delta）の template が単一 "
        "index.html へ注入されていない（二重フラグメント形の term-id 抽出が"
        "ネスト収集経路で壊れた疑い）"
    )
    # Assert: 本文参照と定義内参照の両経路から収集される beta の template が
    # ちょうど1回だけ存在する（dedup の結合検証）
    beta_count = html.count('id="riddle-tip--term-beta"')
    assert beta_count == 1, (
        "singlehtml で本文参照（レベル1）と定義内参照（レベル2）の両経路から"
        f"収集される term-beta の template がちょうど1回でない（実際: {beta_count} 回）"
        "。二重注入または注入消失が起きている。"
    )
