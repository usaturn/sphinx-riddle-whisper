"""inject の term-id 属性インジェクション（多層防御）検証テスト（r1-9）。

``inject_definition_templates`` は注入 template の id 属性へ term-id を
``<template id="riddle-tip--{term-id}">`` の形で埋め込む。term-id は通常
Sphinx が生成する 'term-N' / 'term-<slug>' であり HTML メタ文字を含まないが、
多層防御として、'"><script>' 等の HTML メタ文字を含む細工された term-id
（home_index に存在する前提）を受けても、id 属性が壊れて属性外へ脱出せず、
属性値がエスケープされていることを実ビルド + 注入経路で固定する。
"""

from pathlib import Path

import pytest
from bs4 import BeautifulSoup
from docutils import nodes

import sphinx_riddle_whisper.inject as inject_mod
from sphinx_riddle_whisper.inject import inject_definition_templates


@pytest.mark.sphinx("html", testroot="pages", warningiserror=True)
def test_細工されたterm_idでもtemplate_id属性が壊れて脱出しない(app, monkeypatch):
    """[r1-9/セキュリティ] '"><script>' 等の HTML メタ文字を含む term-id を
    受けても、注入 template の id 属性値がエスケープされ属性外へ脱出しない。

    多層防御: term-id が home_index に存在し、かつ home の定義として解決される
    という前提を満たせば、line 210 の文字列補間が id 属性へ生の term-id を
    埋め込む。細工された term-id が攻撃者の制御下に入った最悪ケースでも、
    出力 template の id 属性に '"' が生で出て属性を閉じ ``<script>`` 要素として
    DOM に出現することがない（属性値としてエスケープされる）ことを固定する。
    """
    # Arrange: 実ビルドで env / StandardDomain.objects を確定させ、注入経路で
    # 使う Builder・config を本物にする（render/sanitize も本物が走る）。
    app.build()

    malicious_id = 'term-0"><script>alert(1)</script>'

    # home の解決済み doctree から実在の definition を 1 つ借り、細工 term-id へ
    # 対応付ける。これにより注入経路の definition 解決を通過させ line 210 へ到達
    # させる。home_index も細工 term-id を home(index) へ解決するよう差し替える。
    real_defs = inject_mod.extract_definitions(
        app.env.get_and_resolve_doctree(
            "index", app.builder, tags=app.builder.tags
        )
    )
    borrowed_definition = real_defs["term-0"]

    monkeypatch.setattr(
        inject_mod, "build_term_home_index", lambda std: {malicious_id: "index"}
    )
    monkeypatch.setattr(
        inject_mod, "build_term_text_index", lambda std: {malicious_id: "フー"}
    )
    monkeypatch.setattr(
        inject_mod,
        "extract_definitions",
        lambda doctree: {malicious_id: borrowed_definition},
    )

    # 細工 term-id を refid に持つ reference を含む doctree を渡す
    # （extract_referenced_term_ids が細工 term-id を拾うようにする）。
    para = nodes.paragraph()
    ref = nodes.reference()
    ref["refid"] = malicious_id
    para += ref

    context: dict = {"body": "<main>本文</main>"}

    # Act: 注入ハンドラを実行する（line 210 の id 属性補間が走る）。
    inject_definition_templates(
        app, "subdir/other", "page.html", context, para
    )

    # Assert: body をパースし、細工 term-id 由来で <script> 要素が DOM に
    # 出現していない（id 属性を閉じて属性外へ脱出していない）。
    body = context["body"]
    soup = BeautifulSoup(body, "html.parser")
    scripts = soup.find_all("script")
    assert scripts == [], (
        "細工された term-id の '\"' が id 属性を閉じて <script> 要素として "
        f"DOM へ脱出した（id 属性のエスケープ欠如）: body={body!r}"
    )

    # 注入された template の id 属性値が、細工文字列そのものを保持しつつ
    # 属性内に留まっている（壊れていない）こと。
    template = soup.find("template")
    assert template is not None, (
        f"細工 term-id の注入 template が見つからない: body={body!r}"
    )
    assert template.get("id") == f"riddle-tip--{malicious_id}", (
        "template の id 属性値が細工 term-id を属性内に保持していない"
        f"（属性が壊れている）: id={template.get('id')!r}"
    )
