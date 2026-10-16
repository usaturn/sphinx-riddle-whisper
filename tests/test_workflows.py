"""GitHub Actions workflow の構成検証テスト。

CI 充実化 Spec（2026-07-04）の要点 — 全アクションの SHA ピン留め・
最小 permissions・uv audit の必須化（continue-on-error 禁止）・
統合 ci.yml の 4 ジョブ構成 — を回帰テストとして固定する。

secret-scan.yml の検査の step は、pull_request_target で base の定義から動くため、
追加・変更した PR 自身の CI では動かない。そこで step の run を取り出し、
一時ディレクトリの git リポジトリと偽の gitleaks で実行して分岐を確かめる。
"""

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
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


# --- secret-scan.yml の検査の step を実行して確かめる ---------------------------

_needs_bash_and_git = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("git") is None,
    reason="bash と git が無い環境では検査の step を実行できない",
)

_BASE_CONFIG = "# base config\n[extend]\nuseDefault = true\n"
_PR_CONFIG = "# pr config\n"
_ZERO_SHA = "0" * 40

# 偽の gitleaks。呼ばれるたびに、引数・cwd・設定を差し替える環境変数・
# --config のファイルの中身を JSON の 1 行で記録し、FAKE_GITLEAKS_EXIT で終わる
_FAKE_GITLEAKS = """\
import json
import os
import sys

argv = sys.argv[1:]
config_text = None
if "--config" in argv:
    with open(argv[argv.index("--config") + 1], encoding="utf-8") as f:
        config_text = f.read()
record = {
    "argv": argv,
    "cwd": os.getcwd(),
    "env": {k: os.environ.get(k) for k in ("GITLEAKS_CONFIG", "GITLEAKS_CONFIG_TOML")},
    "config_text": config_text,
}
with open(os.environ["FAKE_GITLEAKS_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps(record) + "\\n")
sys.exit(int(os.environ.get("FAKE_GITLEAKS_EXIT", "0")))
"""


@dataclass
class _ScanRepo:
    """検査の step を実行する一時の環境。

    履歴は ``B0 ── B1(main)`` と ``B0 ── H1(refs/pull/7/head)``。
    H1 は既定で .gitleaks.toml を書き換える。workspace は B1 を detached で checkout した clone。
    """

    workspace: Path
    base_sha: str
    head_sha: str
    merge_base: str
    bin_dir: Path
    log: Path


def _git_env() -> dict[str, str]:
    """利用者の git の設定と GIT_* の環境変数を読まない環境。"""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "test",
            "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "test",
            "GIT_COMMITTER_EMAIL": "test@example.invalid",
        }
    )
    return env


def _git(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        env=_git_env(),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _commit(repo: Path, files: dict[str, str | None], message: str) -> str:
    """files を書いて commit する。値が None のファイルは削除する。"""
    for name, text in files.items():
        if text is None:
            (repo / name).unlink()
        else:
            (repo / name).write_text(text, encoding="utf-8")
    _git(repo, "add", "--all")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


_DEFAULT_PR_FILES: dict[str, str | None] = {
    ".gitleaks.toml": _PR_CONFIG,
    "pr.txt": "pr\n",
}


def _make_scan_repo(
    tmp_path: Path,
    *,
    base_files: dict[str, str | None],
    pr_files: dict[str, str | None] = _DEFAULT_PR_FILES,
) -> _ScanRepo:
    origin = tmp_path / "origin.git"
    src = tmp_path / "src"
    workspace = tmp_path / "workspace"
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    _git(tmp_path, "init", "-q", "-b", "main", str(src))
    merge_base = _commit(src, base_files, "base")
    _git(src, "checkout", "-q", "-b", "pr")
    head_sha = _commit(src, pr_files, "pr")
    _git(src, "checkout", "-q", "main")
    base_sha = _commit(src, {"main.txt": "main\n"}, "main")
    _git(src, "push", "-q", str(origin), "main:refs/heads/main", "pr:refs/pull/7/head")
    # actions/checkout（fetch-depth: 0）と同じく、refs/pull/* は取得しない
    _git(tmp_path, "clone", "-q", str(origin), str(workspace))
    _git(workspace, "checkout", "-q", "--detach", base_sha)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "gitleaks"
    fake.write_text(f"#!{sys.executable}\n{_FAKE_GITLEAKS}", encoding="utf-8")
    fake.chmod(0o755)
    return _ScanRepo(
        workspace=workspace,
        base_sha=base_sha,
        head_sha=head_sha,
        merge_base=merge_base,
        bin_dir=bin_dir,
        log=tmp_path / "gitleaks.jsonl",
    )


def _pr_event(repo: _ScanRepo) -> dict[str, str]:
    return {
        "EVENT_NAME": "pull_request_target",
        "PR_NUMBER": "7",
        "BASE_SHA": repo.base_sha,
        "HEAD_SHA": repo.head_sha,
        "PUSH_BEFORE": "",
        "PUSH_AFTER": repo.base_sha,
    }


def _push_event(
    repo: _ScanRepo, *, before: str, event_name: str = "push"
) -> dict[str, str]:
    return {
        "EVENT_NAME": event_name,
        "PR_NUMBER": "",
        "BASE_SHA": "",
        "HEAD_SHA": "",
        "PUSH_BEFORE": before,
        "PUSH_AFTER": repo.base_sha,
    }


def _scan_step_script() -> str:
    """secret-scan ジョブの id: scan の step の run を返す。"""
    steps = _load(SECRET_SCAN_WORKFLOW)["jobs"]["secret-scan"]["steps"]
    scan_steps = [step for step in steps if step.get("id") == "scan"]
    assert len(scan_steps) == 1, "secret-scan ジョブに id: scan の step が 1 つだけ無い"
    return scan_steps[0]["run"]


def _run_scan(
    repo: _ScanRepo, event: dict[str, str], *, gitleaks_exit: int = 0
) -> subprocess.CompletedProcess[str]:
    """GitHub の runner と同じ bash のオプションで、workspace を cwd にして実行する。"""
    script = repo.workspace.parent / "scan-step.sh"
    script.write_text(_scan_step_script(), encoding="utf-8")
    env = _git_env()
    env.update(
        {
            "PATH": f"{repo.bin_dir}{os.pathsep}{os.environ['PATH']}",
            "GITHUB_WORKSPACE": str(repo.workspace),
            # 検査の step がこれらを消すことを確かめる
            "GITLEAKS_CONFIG": str(repo.workspace.parent / "env-config.toml"),
            "GITLEAKS_CONFIG_TOML": "[extend]\nuseDefault = false\n",
            "FAKE_GITLEAKS_LOG": str(repo.log),
            "FAKE_GITLEAKS_EXIT": str(gitleaks_exit),
            **event,
        }
    )
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        cwd=repo.workspace,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _calls(repo: _ScanRepo) -> list[dict[str, Any]]:
    """偽の gitleaks の呼び出しの記録。呼ばれていなければ空。"""
    if not repo.log.exists():
        return []
    return [
        json.loads(line) for line in repo.log.read_text(encoding="utf-8").splitlines()
    ]


def _config_arg(call: dict[str, Any]) -> str:
    argv: list[str] = call["argv"]
    return argv[argv.index("--config") + 1]


@_needs_bash_and_git
def test_PRの検査はbaseの設定とmerge_baseからの範囲を使う(tmp_path: Path) -> None:
    """PR の head が .gitleaks.toml を書き換えても、base の設定で PR の commit だけを検査する。"""
    # Arrange: base の設定は _BASE_CONFIG、PR の head は _PR_CONFIG に書き換える
    repo = _make_scan_repo(tmp_path, base_files={".gitleaks.toml": _BASE_CONFIG})

    # Act
    result = _run_scan(repo, _pr_event(repo))

    # Assert: gitleaks を 1 回、base の設定と merge-base..head の範囲で呼ぶ
    assert result.returncode == 0, result.stderr
    [call] = _calls(repo)
    assert call["argv"][0] == "git"
    assert call["argv"][-1] == "."
    assert "--redact" in call["argv"]
    assert "--ignore-gitleaks-allow" in call["argv"]
    assert f"--log-opts={repo.merge_base}..{repo.head_sha}" in call["argv"]
    assert _config_arg(call) == f"{repo.workspace}/.gitleaks.toml"
    assert call["config_text"] == _BASE_CONFIG
    assert call["env"] == {"GITLEAKS_CONFIG": None, "GITLEAKS_CONFIG_TOML": None}
    assert Path(call["cwd"]).resolve() == repo.workspace.resolve()
    # PR の head を checkout していない
    assert _git(repo.workspace, "rev-parse", "HEAD") == repo.base_sha
    assert not (repo.workspace / "pr.txt").exists()


@_needs_bash_and_git
@pytest.mark.parametrize(
    "case",
    [
        "head_moved",
        "checkout_not_base",
        "bad_pr_number",
        "bad_base_sha",
        "bad_head_sha",
    ],
)
def test_PRの検査は前提が崩れると検査せずに失敗する(tmp_path: Path, case: str) -> None:
    """イベントの値の形、checkout した base、取得した PR の head のどれかが食い違えば止まる。"""
    # Arrange
    repo = _make_scan_repo(tmp_path, base_files={".gitleaks.toml": _BASE_CONFIG})
    event = _pr_event(repo)
    if case == "head_moved":
        # 待ちの間に PR の head が進み、イベントの head.sha と refs/pull/7/head が違う
        event["HEAD_SHA"] = repo.merge_base
    elif case == "checkout_not_base":
        _git(repo.workspace, "checkout", "-q", "--detach", repo.merge_base)
    elif case == "bad_pr_number":
        event["PR_NUMBER"] = "7; true"
    elif case == "bad_base_sha":
        event["BASE_SHA"] = repo.base_sha + "0"
    elif case == "bad_head_sha":
        event["HEAD_SHA"] = repo.head_sha[:39]

    # Act
    result = _run_scan(repo, event)

    # Assert
    assert result.returncode != 0
    assert _calls(repo) == []


@_needs_bash_and_git
@pytest.mark.parametrize(
    "base_files",
    [
        pytest.param({"README": "base\n"}, id="no_config"),
        pytest.param(
            {".gitleaks.toml": _BASE_CONFIG, ".gitleaksignore": "x\n"},
            id="gitleaksignore",
        ),
    ],
)
def test_baseに設定が無いか除外ファイルがあると検査せずに失敗する(
    tmp_path: Path, base_files: dict[str, str]
) -> None:
    """base の .gitleaks.toml だけを規則にする。.gitleaksignore は Gitleaks が暗黙に読むので止める。"""
    # Arrange
    repo = _make_scan_repo(tmp_path, base_files=base_files)

    # Act
    result = _run_scan(repo, _push_event(repo, before=repo.merge_base))

    # Assert
    assert result.returncode != 0
    assert _calls(repo) == []


@_needs_bash_and_git
@pytest.mark.parametrize(
    ("event_name", "before", "expect_range"),
    [
        pytest.param("push", "merge_base", True, id="push"),
        pytest.param("push", _ZERO_SHA, False, id="push_new_branch"),
        pytest.param("workflow_dispatch", "", False, id="workflow_dispatch"),
    ],
)
def test_pushはbeforeからの範囲か全履歴を検査する(
    tmp_path: Path, event_name: str, before: str, expect_range: bool
) -> None:
    """push は before..after。before が使えない push と手動の実行は全履歴を検査する。"""
    # Arrange
    repo = _make_scan_repo(tmp_path, base_files={".gitleaks.toml": _BASE_CONFIG})
    before_sha = repo.merge_base if before == "merge_base" else before

    # Act
    result = _run_scan(
        repo, _push_event(repo, before=before_sha, event_name=event_name)
    )

    # Assert
    assert result.returncode == 0, result.stderr
    [call] = _calls(repo)
    log_opts = [arg for arg in call["argv"] if arg.startswith("--log-opts")]
    if expect_range:
        assert log_opts == [f"--log-opts={repo.merge_base}..{repo.base_sha}"]
    else:
        assert log_opts == []
    assert _config_arg(call) == f"{repo.workspace}/.gitleaks.toml"
    assert call["config_text"] == _BASE_CONFIG


@_needs_bash_and_git
def test_pushでcheckoutがafterと違うと検査せずに失敗する(tmp_path: Path) -> None:
    # Arrange: イベントの sha と checkout した commit が違う
    repo = _make_scan_repo(tmp_path, base_files={".gitleaks.toml": _BASE_CONFIG})
    event = _push_event(repo, before=repo.merge_base)
    event["PUSH_AFTER"] = repo.head_sha

    # Act
    result = _run_scan(repo, event)

    # Assert
    assert result.returncode != 0
    assert _calls(repo) == []


@_needs_bash_and_git
def test_gitleaksの検出は検査の失敗になる(tmp_path: Path) -> None:
    """gitleaks は検出があると 0 以外で終わる。その終了コードを握りつぶさない。"""
    # Arrange
    repo = _make_scan_repo(tmp_path, base_files={".gitleaks.toml": _BASE_CONFIG})

    # Act
    result = _run_scan(repo, _pr_event(repo), gitleaks_exit=1)

    # Assert: 前提の検査ではなく、gitleaks の結果で失敗している
    assert result.returncode != 0
    assert len(_calls(repo)) == 1


@_needs_bash_and_git
@pytest.mark.parametrize(
    "pr_files",
    [
        pytest.param({".gitleaksignore": "x\n"}, id="pr_adds_gitleaksignore"),
        pytest.param({".gitleaks.toml": None}, id="pr_deletes_config"),
    ],
)
def test_PRがマージ後の検査を止める変更を含むと失敗する(
    tmp_path: Path, pr_files: dict[str, str | None]
) -> None:
    """PR の検査は base の作業ツリーで動くので、PR 側の変更はマージ後に初めて効く。

    .gitleaksignore を足す・.gitleaks.toml を消す PR を通すと、マージ後は main の push と
    以降のすべての PR の検査が止まり、それを戻す PR も通らない。開発環境の push 前の検査も
    PR 側の .gitleaksignore で止まるので、PR の時点で失敗させる。
    """
    # Arrange
    repo = _make_scan_repo(
        tmp_path, base_files={".gitleaks.toml": _BASE_CONFIG}, pr_files=pr_files
    )

    # Act
    result = _run_scan(repo, _pr_event(repo))

    # Assert
    assert result.returncode != 0
    assert _calls(repo) == []
