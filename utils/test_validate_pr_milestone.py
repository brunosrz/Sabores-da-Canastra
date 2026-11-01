"""Regressões da validação de milestones e branches de pull requests."""

from __future__ import annotations

from validate_pr_milestone import validate_pull_request


def _event(
    *,
    base: str = "master",
    milestone: str | None = "0.1.x",
    head: str = "feat/new-feature",
    head_repo: str = "brunosrz/Sabores-da-Canastra",
) -> dict[str, object]:
    return {
        "repository": {"full_name": "brunosrz/Sabores-da-Canastra"},
        "pull_request": {
            "base": {"ref": base},
            "head": {"ref": head, "repo": {"full_name": head_repo}},
            "milestone": {"title": milestone} if milestone else None,
            "title": "feat: adiciona recurso",
        },
    }


def test_stable_branch_requires_maintenance_milestone() -> None:
    assert validate_pull_request(_event()) == []
    assert "0.1.x" in " ".join(
        validate_pull_request(_event(milestone="0.2"))
    )


def test_development_branch_requires_development_milestone() -> None:
    assert validate_pull_request(_event(base="release/0.2", milestone="0.2")) == []
    assert validate_pull_request(_event(base="release/0.2", milestone="0.1.x"))


def test_internal_stacked_pull_request_does_not_require_release_milestone() -> None:
    assert validate_pull_request(_event(base="feat/foundation", milestone=None)) == []


def test_external_stacked_pull_request_cannot_bypass_release_milestone() -> None:
    errors = validate_pull_request(
        _event(base="feat/foundation", milestone=None, head_repo="someone/fork")
    )
    assert errors
    assert "base declarada" in errors[0]


def test_forbidden_codex_branch_is_rejected() -> None:
    errors = validate_pull_request(_event(head="codex/temporary"))
    assert errors
    assert "codex/" in errors[0]
