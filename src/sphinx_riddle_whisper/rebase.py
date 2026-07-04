"""相対 URI の再ベース（reference の refuri / 同一ページ #anchor）。

home ドキュメント文脈で解決した reference の refuri を、別ディレクトリの
表示ページ P 基準へ再ベースする。相対段数は自前計算せず
``builder.get_relative_uri(page_docname, home_docname)`` に一本化し、ビルダ非依存とする。

外部 URL（スキーム付き・``//host`` ネットワークロケーション付き・サイト絶対 ``/...``）は
再ベースせずそのまま残す。

画像 ``uri`` は自前で再ベースしない: ``render_partial``（HTML writer）が
``builder.images``/``builder.imgpath`` 経由で表示ページ P 基準の
``_images/<basename>`` へ自動で書き換えるため、ここで再ベースすると実在しない
404 パス（二重再ベース）を生む。reference の ``refuri`` は writer が verbatim 出力する
ため自前再ベースが必要、という非対称性に注意。
"""

from __future__ import annotations

import posixpath
from itertools import takewhile
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from docutils import nodes


def _is_external(refuri: str) -> bool:
    """refuri が外部・絶対（再ベース対象外）かどうかを返す。"""
    split = urlsplit(refuri)
    return bool(split.scheme) or bool(split.netloc) or refuri.startswith("/")


def _rebase_relative_path(base: str, path: str) -> str:
    """home ディレクトリ基準の相対 ``path`` を ``base`` のディレクトリ部と結合し正規化する。

    :param base: ``builder.get_relative_uri(page, home)`` で得た home ページへの相対パス。
    :param path: home ディレクトリ基準の相対パス（フラグメントを含まない）。
    :returns: P 基準へ再ベースした正規化済み相対パス。
    """
    base_dir = posixpath.dirname(base)
    rebased = posixpath.normpath(posixpath.join(base_dir, path))
    # 過剰な '../' で出力ルート外へ脱出する敵対的相対パスを出力ルート内へ閉じる。
    # 表示ページ P 自身の出力ルートからの深さは base のディレクトリ部に含まれる
    # '..' の数で決まる（base は P から home への相対パスのため）。再ベース結果に
    # P の深さを超える先頭 '..' が残ると出力ルートより上位へ脱出するので、超過分を
    # 取り除いて出力ルート直下へ丸める（パストラバーサル防止）。
    page_depth = sum(1 for seg in base_dir.split("/") if seg == "..")
    rebased = _clamp_to_output_root(rebased, page_depth)
    # dirhtml の docname ディレクトリ URI（末尾スラッシュ）は normpath で落ちるため、
    # 元 path が末尾スラッシュを持つ場合は保つ（ディレクトリ宛先を 404 にしない）。
    if path.endswith("/") and not rebased.endswith("/"):
        rebased += "/"
    return rebased


def _clamp_to_output_root(rebased: str, page_depth: int) -> str:
    """正規化済み相対パスの先頭 '..' を ``page_depth`` 個までに制限する。

    表示ページ P の出力ディレクトリ深さ ``page_depth`` を超える先頭 '..' は
    出力ルートより上位への脱出を意味するため、超過分を取り除いて出力ルート直下へ
    丸める（ディレクトリトラバーサル防止）。
    """
    segments = rebased.split("/")
    leading = sum(1 for _ in takewhile(lambda seg: seg == "..", segments))
    if leading <= page_depth:
        return rebased
    kept = segments[leading - page_depth :]
    return "/".join(kept) if kept else "."


def rebase_refuri(
    refuri: str | None,
    *,
    home_docname: str,
    page_docname: str,
    builder: Any,
) -> str | None:
    """1 つの refuri を表示ページ P 基準へ再ベースして返す純関数。

    外部・絶対 URL はそのまま返す（``builder.get_relative_uri`` を呼ばない）。
    内部参照は ``base = builder.get_relative_uri(page_docname, home_docname)`` を用いる。
    アンカー（``#...``）は html/dirhtml では ``base + refuri``、singlehtml（``base`` 自体が
    ``#document-*`` の同一ページフラグメント）では単一ページに id が保たれるため ``refuri``
    をそのまま返す（二重フラグメント化を避ける）。home ディレクトリ基準の相対パスは
    ``base`` のディレクトリ部と結合して正規化する。

    :param refuri: 再ベース対象の refuri（``None``/空はそのまま返す）。
    :param home_docname: 元の解決文脈となる home ドキュメント名。
    :param page_docname: 注入先となる表示ページ P のドキュメント名。
    :param builder: ``get_relative_uri(page_docname, home_docname)`` を持つビルダ。
    :returns: P 基準へ再ベースした refuri（スキップ時は入力のまま）。
    """
    if not refuri:
        return refuri
    if _is_external(refuri):
        return refuri

    base = builder.get_relative_uri(page_docname, home_docname)

    if refuri.startswith("#"):
        # singlehtml では base 自体が同一ページフラグメント（例 '#document-index'）。
        # 全ドキュメントが単一ページへ集約され、各アンカーの id はそのまま保たれるため、
        # refuri をそのまま返す（再ベース不要分岐）。'#document-topic' のようなドキュメント
        # 参照も '#intro-anchor' / '#term-baz' のような素のアンカーも、単一ページ DOM に
        # その id が実在するので有効。base を前置すると '#document-index#intro-anchor' の
        # ような二重フラグメントになり、ブラウザは最初の '#' 以降を 1 つのフラグメントと
        # して扱うため 404 になる。
        if base.startswith("#"):
            return refuri
        # html/dirhtml: 同一ページ（home 内）アンカーは home ページへの相対パス + アンカー。
        return base + refuri

    # home ディレクトリ基準の相対パス（例 'other.html#x'）。
    split = urlsplit(refuri)
    if not split.path and refuri.startswith("?"):
        if base.startswith("#"):
            return urlunsplit(("", "", "", split.query, split.fragment))
        return urlunsplit(("", "", base, split.query, split.fragment))
    rebased_path = _rebase_relative_path(base, split.path)
    return urlunsplit(("", "", rebased_path, split.query, split.fragment))


def _collect_subtree_ids(subtree: nodes.Node) -> set[str]:
    """subtree 内の全ノードが持つ ``ids`` を集合で返す（フラグメント内アンカー判定用）。"""
    ids: set[str] = set()
    for node in subtree.findall(nodes.Element):
        ids.update(node.get("ids", ()))
    return ids


def rebase_internal_references(
    subtree: nodes.Node,
    *,
    home_docname: str,
    page_docname: str,
    builder: Any,
) -> None:
    """subtree 内の ``nodes.reference`` を必要に応じて P 基準へ in-place 書き換える。

    - ``refuri`` を持つ参照（``:doc:`` 等）はそのまま :func:`rebase_refuri` で再ベース。
    - ``refid`` を持つ参照（``:ref:`` の同一 home 内アンカー等）のうち、対象 id が
      **subtree の外**（home ドキュメント側）にあるものは ``home ページ#refid`` へ再ベース
      して ``refuri`` に変換する（注入先 P から home の該当アンカーへ正しく飛ぶ）。
      対象 id が **subtree 内**（自己完結脚注など定義と一緒に旅するアンカー）にあるものは、
      フラグメント内参照なので ``refid`` のまま残す。

    :param subtree: 走査対象の定義サブツリー（docutils ノード）。
    :param home_docname: 元の解決文脈となる home ドキュメント名。
    :param page_docname: 注入先となる表示ページ P のドキュメント名。
    :param builder: ``get_relative_uri`` を持つビルダ。
    """
    subtree_ids = _collect_subtree_ids(subtree)
    for reference in subtree.findall(nodes.reference):
        if reference.get("refuri"):
            reference["refuri"] = rebase_refuri(
                reference["refuri"],
                home_docname=home_docname,
                page_docname=page_docname,
                builder=builder,
            )
            continue
        refid = reference.get("refid")
        if refid and refid not in subtree_ids:
            # home ドキュメント側のアンカーを指す同一ページ参照。注入先 P からは
            # home ページ経由で飛ぶ必要があるため home ページ#refid へ再ベースする。
            reference["refuri"] = rebase_refuri(
                f"#{refid}",
                home_docname=home_docname,
                page_docname=page_docname,
                builder=builder,
            )
            del reference["refid"]
