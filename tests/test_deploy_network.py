import ast
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest


def deployment_namespace(tmp_path):
    source = Path(__file__).resolve().parents[1] / "SConstruct"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"_run", "_write_console", "_cloudflare_preflight", "_deploy_api", "_deploy_web"}]
    namespace = {"ROOT": tmp_path, "ROOT_ENV": {}, "Path": Path, "subprocess": subprocess, "sys": sys, "re": re, "time": time, "json": json, "shutil": shutil, "urllib": urllib, "PNPM": "pnpm", "API": tmp_path / "apps/api", "ERP": tmp_path / "apps/erp", "PDV": tmp_path / "apps/pdv"}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), namespace)
    return namespace


def runner(tmp_path):
    return deployment_namespace(tmp_path)["_run"]


def test_retries_network_failures(monkeypatch, tmp_path):
    responses = iter([subprocess.CompletedProcess([], 1, "", "fetch failed"), subprocess.CompletedProcess([], 0, "conta validada", "")])
    calls = []
    def run(*args, **kwargs):
        calls.append(kwargs)
        return next(responses)
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(time, "sleep", lambda _: None)
    assert runner(tmp_path)(["wrangler", "whoami"], cwd=tmp_path, capture=True, network_attempts=3) == "conta validada"
    assert len(calls) == 2


@pytest.mark.parametrize("message", ["Authentication error 403 fetch failed", "JSON inválido", "fetch failed"])
def test_failure_is_not_hidden(monkeypatch, tmp_path, capsys, message):
    calls = []
    def run(*args, **kwargs):
        calls.append(kwargs)
        return subprocess.CompletedProcess([], 1, "", message)
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(time, "sleep", lambda _: None)
    with pytest.raises(SystemExit):
        runner(tmp_path)(["wrangler", "whoami"], cwd=tmp_path, capture=True, network_attempts=3)
    assert message in capsys.readouterr().err
    assert len(calls) == (3 if message == "fetch failed" else 1)


@pytest.mark.parametrize("environment", ["preview", "production"])
def test_deployment_enables_retries_on_remote_steps(tmp_path, environment):
    namespace = deployment_namespace(tmp_path)
    calls = []
    namespace["ROOT_ENV"] = {"CLOUDFLARE_ACCOUNT_ID": "test-account", "CLOUDFLARE_ZONE_ID": "test-zone", "CLOUDFLARE_API_TOKEN": "test-token"}
    namespace["_cloudflare_json"] = lambda request: {"success": True, "result": {"name": "brunosrz.com", "status": "active"}}
    namespace["_secrets_for"] = lambda selected: {"CLOUDFLARE_API_TOKEN": "test-token"}

    def record(command, **kwargs):
        calls.append((command, kwargs))
        if command[-1] == "whoami":
            return "test-account"
        if "secret" in command and "list" in command:
            return '[{"name": "CLOUDFLARE_API_TOKEN"}]'
        return ""

    namespace["_run"] = record
    assert namespace["_cloudflare_preflight"]() == ("test-account", "test-token")
    namespace["_deploy_api"](environment)
    for app in [namespace["ERP"], namespace["PDV"]]:
        namespace["_deploy_web"](app, environment)
    remote = [(command, options) for command, options in calls if command[-1] != "build" and "scripts/deploy-guard.mjs" not in command]
    assert len(remote) == 7  # identity, migrations, two secret steps, API, ERP, PDV
    assert all(options.get("network_attempts") == 3 for _, options in remote)
    local = [(command, options) for command, options in calls if command[-1] == "build" or "scripts/deploy-guard.mjs" in command]
    assert len(local) == 3
    assert all(options.get("network_attempts", 1) == 1 for _, options in local)
