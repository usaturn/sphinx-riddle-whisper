"""GitHub Actions workflow の構成検証テスト。

CI 充実化 Spec（2026-07-04）の要点 — 全アクションの SHA ピン留め・
最小 permissions・uv audit の必須化（continue-on-error 禁止）・
統合 ci.yml の 4 ジョブ構成 — を回帰テストとして固定する。
"""

import re
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR: Path = REPO_ROOT / ".github" / "workflows"
SECRET_SCAN_WORKFLOW: Path = WORKFLOWS_DIR / "secret-scan.yml"

# owner/repo@<40桁SHA> 形式（ローカル参照 ./ は対象外）
_SHA_PINNED = re.compile(r"^[^/@]+/[^@]+@[0-9a-f]{40}$")


def _load(path: Path) -> dict[str, Any]:
    """workflow YAML を dict として読む。"""
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _triggers(workflow: dict[Any, Any]) -> dict[str, Any]:
    """workflow のトリガーを dict で返す。値の無いトリガーは None にする。

    PyYAML（YAML 1.1）は ``on`` を真偽値として読むので、キーは ``True`` になる。
    ``on: pull_request``（文字列）と ``on: [push, pull_request]``（リスト）も dict に揃える。
    """
    on = workflow.get("on", workflow.get(True))
    if isinstance(on, str):
        return {on: None}
    if isinstance(on, list):
        return dict.fromkeys(on)
    return dict(on or {})


def _iter_steps(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    """全ジョブの steps を平坦化して返す。"""
    steps: list[dict[str, Any]] = []
    for job in workflow.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def test_旧workflowが削除されciymlが存在する() -> None:
    """test-matrix.yml / check-documents.yml は ci.yml へ統合済みで存在しない。"""
    assert (WORKFLOWS_DIR / "ci.yml").exists()
    assert not (WORKFLOWS_DIR / "test-matrix.yml").exists()
    assert not (WORKFLOWS_DIR / "check-documents.yml").exists()


def test_全workflowのusesがSHAピン留めされている() -> None:
    """サプライチェーン対策: 全アクション参照が 40 桁コミット SHA 固定である。"""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for step in _iter_steps(_load(path)):
            uses = step.get("uses")
            if uses is None:
                continue
            assert _SHA_PINNED.match(uses), (
                f"{path.name}: '{uses}' が SHA ピン留めされていない"
            )


def test_ciymlは4ジョブとconcurrencyと最小permissionsを持つ() -> None:
    """統合 CI は lint/test/docs/audit-and-package の並列 4 ジョブ構成である。"""
    ci = _load(WORKFLOWS_DIR / "ci.yml")
    assert set(ci["jobs"]) == {"lint", "test", "docs", "audit-and-package"}
    assert "concurrency" in ci
    assert ci["permissions"] == {"contents": "read"}


def test_uv_auditにcontinue_on_errorが無い() -> None:
    """uv audit は必須ゲート。advisory（continue-on-error）へ戻る回帰を防ぐ。"""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for step in _iter_steps(_load(path)):
            if "uv audit" in step.get("run", ""):
                assert "continue-on-error" not in step, (
                    f"{path.name}: uv audit が advisory に戻っている"
                )


def test_全checkoutでpersist_credentialsがfalse() -> None:
    """artipacked 対策: checkout はクレデンシャルを残さない。"""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for step in _iter_steps(_load(path)):
            uses = step.get("uses", "")
            if uses.startswith("actions/checkout@"):
                assert step.get("with", {}).get("persist-credentials") is False, (
                    f"{path.name}: checkout に persist-credentials: false が無い"
                )


def test_secret_scanはbaseの定義で動きpull_requestでは動かない() -> None:
    """PR の検査は base の workflow の定義（pull_request_target）でだけ動く。

    pull_request で動くと、PR 側が書き換えた定義で同名のジョブが動き、検査を外せる。
    ジョブ名 secret-scan は ruleset main-required-checks と開発環境側
    （usaturn/agent-workspace#667）が参照する名前なので固定する。
    名前を変えるときは、ruleset とこのテストを合わせて変える。
    """
    wf = _load(SECRET_SCAN_WORKFLOW)

    triggers = _triggers(wf)
    assert triggers["push"] == {"branches": ["main"]}
    assert triggers["pull_request_target"] == {"branches": ["main"]}
    assert "pull_request" not in triggers

    assert wf["permissions"] == {}
    job = wf["jobs"]["secret-scan"]
    assert job["name"] == "secret-scan"
    assert job["permissions"] == {"contents": "read"}


def test_pull_request_targetのcheckoutはPRのheadを指さない() -> None:
    """pull_request_target は base の権限で動くので、PR のコードを checkout しない。

    checkout の ref を省くと既定の base になるが、意図を明示させるため ref を必須にし、
    PR の head（github.head_ref や github.event.pull_request.head.*）を指していないことを確かめる。
    """
    targets = [
        path
        for path in sorted(WORKFLOWS_DIR.glob("*.yml"))
        if "pull_request_target" in _triggers(_load(path))
    ]
    assert targets, "pull_request_target を使う workflow が無い"

    for path in targets:
        for step in _iter_steps(_load(path)):
            if not step.get("uses", "").startswith("actions/checkout@"):
                continue
            ref = step.get("with", {}).get("ref")
            assert isinstance(ref, str), f"{path.name}: checkout に ref が無い"
            assert "head" not in ref, (
                f"{path.name}: checkout が PR の head を指す: {ref}"
            )
