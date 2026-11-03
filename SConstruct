"""Orquestra a publicação explícita do ERP, PDV e API na Cloudflare."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(Dir(".").abspath)  # noqa: F821 - SCons built-in.
API = ROOT / "apps" / "api"
ERP = ROOT / "apps" / "erp"
PDV = ROOT / "apps" / "pdv"
PNPM = shutil.which("pnpm.cmd") or shutil.which("pnpm") or "pnpm"


def _dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8-sig").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            raise ValueError(f"Linha {line_number} inválida em {path.name}.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _write_console(text: str, stream) -> None:
    encoding = getattr(stream, "encoding", None) or "utf-8"
    safe_text = text.encode(encoding, errors="replace").decode(
        encoding, errors="replace"
    )
    stream.write(safe_text)


ROOT_ENV = {**_dotenv(ROOT / ".env"), **os.environ}


def _cloudflare_json(request: urllib.request.Request, attempts: int = 3) -> dict:
    retryable_statuses = {408, 429, 500, 502, 503, 504}
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code not in retryable_statuses or attempt == attempts - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
        time.sleep(min(2**attempt, 4))
    raise RuntimeError("A API Cloudflare não respondeu após as tentativas.")


def _run(
    command: list[str],
    *,
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
    capture: bool = False,
    network_attempts: int = 1,
) -> str:
    print(f"\n>> [{cwd.relative_to(ROOT)}] {' '.join(command)}")
    for attempt in range(network_attempts):
        result = subprocess.run(
            command,
            cwd=cwd,
            env={**ROOT_ENV, **(env or {})},
            input=input_text,
            capture_output=capture or input_text is not None or network_attempts > 1,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdin=subprocess.DEVNULL if input_text is None else None,
            check=False,
        )
        output = (result.stdout or "") + (result.stderr or "")
        transient = re.search(r"fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT", output, re.IGNORECASE)
        denied = re.search(r"authentication error|authorization error|invalid.*token|\b(401|403)\b", output, re.IGNORECASE)
        if not result.returncode or not transient or denied or attempt == network_attempts - 1:
            break
        print(f"Falha temporária de rede; nova tentativa {attempt + 2}/{network_attempts} em {2 ** (attempt + 1)} s.")
        time.sleep(2 ** (attempt + 1))
    if network_attempts > 1 and not capture and input_text is None:
        _write_console(result.stdout or "", sys.stdout)
        _write_console(result.stderr or "", sys.stderr)
    if input_text is not None or (capture and result.returncode != 0):
        if result.stdout:
            _write_console(result.stdout, sys.stdout)
        if result.stderr:
            _write_console(result.stderr, sys.stderr)
    if result.returncode:
        raise SystemExit(result.returncode)
    return result.stdout or ""


def _cloudflare_preflight() -> tuple[str, str]:
    account_id = ROOT_ENV.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    zone_id = ROOT_ENV.get("CLOUDFLARE_ZONE_ID", "").strip()
    token = ROOT_ENV.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not account_id or account_id.startswith("preencha-"):
        raise SystemExit("Configure CLOUDFLARE_ACCOUNT_ID no .env local.")
    if not zone_id or zone_id.startswith("preencha-"):
        raise SystemExit("Configure CLOUDFLARE_ZONE_ID no .env local.")
    if not token:
        raise SystemExit(
            "Configure CLOUDFLARE_API_TOKEN no .env local com leitura de Access e da zona."
        )

    identity = _run(
        [PNPM, "--filter", "@sabores/api", "exec", "wrangler", "whoami"],
        capture=True,
        network_attempts=3,
    )
    if account_id not in identity:
        raise SystemExit(
            "CLOUDFLARE_ACCOUNT_ID não corresponde à conta autenticada pelo Wrangler."
        )
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "sabores-da-canastra-scons/1.0",
        },
    )
    try:
        zone = _cloudflare_json(request)
    except (urllib.error.URLError, TimeoutError) as error:
        raise SystemExit(
            f"Não foi possível validar a zona Cloudflare: {error}"
        ) from error
    if not zone.get("success") or zone.get("result", {}).get("name") != "brunosrz.com":
        raise SystemExit(
            "CLOUDFLARE_ZONE_ID não aponta para a zona ativa brunosrz.com."
        )
    if zone["result"].get("status") != "active":
        raise SystemExit("A zona brunosrz.com ainda não está ativa na Cloudflare.")
    return account_id, token


def _require_access(hostnames: list[str], account_id: str, token: str) -> None:
    expected_emails = {
        email.strip().lower()
        for email in ROOT_ENV.get("CLOUDFLARE_ACCESS_ALLOWED_EMAILS", "").split(",")
        if email.strip()
    }
    if not expected_emails:
        raise SystemExit(
            "Defina CLOUDFLARE_ACCESS_ALLOWED_EMAILS no .env com os e-mails individuais autorizados."
        )

    def get_json(url: str) -> dict:
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "sabores-da-canastra-scons/1.0",
            },
        )
        try:
            return _cloudflare_json(request)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
                message = body.get("errors", [{}])[0].get("message", str(error))
            except (json.JSONDecodeError, IndexError):
                message = str(error)
            if "Access is not enabled" in message:
                raise SystemExit(
                    "Cloudflare Zero Trust/Access ainda não está habilitado. "
                    "Ative Access no painel e cadastre aplicações protegidas para "
                    + ", ".join(hostnames)
                    + ". O SCons não publicará domínios web sem essa proteção."
                ) from error
            raise SystemExit(
                f"Falha ao validar políticas Cloudflare Access: {message}"
            ) from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise SystemExit(
                f"Não foi possível validar Cloudflare Access: {error}"
            ) from error

    apps_response = get_json(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/access/apps"
    )
    if not apps_response.get("success"):
        raise SystemExit("A API não conseguiu listar as aplicações Cloudflare Access.")
    apps = apps_response.get("result", [])
    for hostname in hostnames:
        app = next((item for item in apps if item.get("domain") == hostname), None)
        if not app:
            raise SystemExit(
                f"Cadastre primeiro uma aplicação Access protegida para {hostname}."
            )
        policy_response = get_json(
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{account_id}/access/apps/{app['id']}/policies"
        )
        policies = policy_response.get("result", [])
        allowed_emails: set[str] = set()
        invalid_allow_rule = False
        has_allow_policy = False
        for policy in policies:
            if policy.get("decision") != "allow":
                continue
            has_allow_policy = True
            rules = policy.get("include", [])
            if not rules:
                invalid_allow_rule = True
                continue
            for rule in rules:
                email = rule.get("email", {}).get("email")
                if not email or set(rule) != {"email"}:
                    invalid_allow_rule = True
                else:
                    allowed_emails.add(email.strip().lower())
        has_bypass = any(policy.get("decision") == "bypass" for policy in policies)
        if (
            not has_allow_policy
            or invalid_allow_rule
            or allowed_emails != expected_emails
            or has_bypass
        ):
            raise SystemExit(
                f"A política Access de {hostname} deve permitir exatamente "
                "CLOUDFLARE_ACCESS_ALLOWED_EMAILS, sem regra ampla ou bypass."
            )


def _secrets_for(environment: str) -> dict[str, str]:
    path = API / f".env.{environment}"
    if not path.exists():
        raise SystemExit(
            f"Crie {path.relative_to(ROOT)} a partir de "
            f"apps/api/.env.{environment}.example e preencha os secrets."
        )
    secrets = _dotenv(path)
    required: set[str] = set()
    if environment == "production":
        required.add("CLOUDFLARE_API_TOKEN")
    missing = required - secrets.keys()
    if missing:
        raise SystemExit(
            f"Secrets ausentes em {path.name}: {', '.join(sorted(missing))}."
        )
    for key in required:
        value = secrets[key]
        if len(value) < 32 or value.lower().startswith(
            ("gere-", "replace-", "changeme", "token-cloudflare-")
        ):
            raise SystemExit(
                f"{key} precisa ser um segredo aleatório com ao menos 32 caracteres."
            )
    allowed = required | {"CLOUDFLARE_API_TOKEN"}
    unknown = secrets.keys() - allowed
    if unknown:
        raise SystemExit(
            f"Secrets não reconhecidos em {path.name}: {', '.join(sorted(unknown))}."
        )
    secrets = {key: value for key, value in secrets.items() if value}
    if not secrets.get("CLOUDFLARE_API_TOKEN"):
        print(
            ">> CLOUDFLARE_API_TOKEN ausente nos secrets da API: backup remoto ficará indisponível neste ambiente."
        )
        secrets.pop("CLOUDFLARE_API_TOKEN", None)
    return secrets


def _deploy_api(environment: str) -> None:
    secrets = _secrets_for(environment)
    _run(
        [
            shutil.which("node.exe") or shutil.which("node") or "node",
            "scripts/deploy-guard.mjs",
            environment,
        ],
        cwd=API,
    )
    _run(
        [
            PNPM,
            "--filter",
            "@sabores/api",
            "exec",
            "wrangler",
            "d1",
            "migrations",
            "apply",
            f"sabores-canastra-{environment}",
            "--remote",
            "--env",
            environment,
            "--config",
            "wrangler.jsonc",
        ],
        cwd=API,
        network_attempts=3,
    )
    _run(
        [
            PNPM,
            "--filter",
            "@sabores/api",
            "exec",
            "wrangler",
            "secret",
            "bulk",
            "--env",
            environment,
            "--config",
            "wrangler.jsonc",
        ],
        cwd=API,
        input_text=json.dumps(secrets),
        network_attempts=3,
    )
    secret_names = _run(
        [
            PNPM,
            "--filter",
            "@sabores/api",
            "exec",
            "wrangler",
            "secret",
            "list",
            "--env",
            environment,
            "--config",
            "wrangler.jsonc",
            "--format",
            "json",
        ],
        cwd=API,
        capture=True,
        network_attempts=3,
    )
    try:
        configured_secret_names = {
            item["name"] for item in json.loads(secret_names) if isinstance(item, dict)
        }
    except (json.JSONDecodeError, TypeError) as error:
        raise SystemExit(
            "Não foi possível confirmar os secrets publicados na Cloudflare."
        ) from error
    missing_secrets = secrets.keys() - configured_secret_names
    if missing_secrets:
        raise SystemExit(
            "A Cloudflare não confirmou os secrets obrigatórios: "
            + ", ".join(sorted(missing_secrets))
            + ". O Worker não será publicado."
        )
    _run(
        [PNPM, "--filter", "@sabores/api", "deploy:" + environment],
        network_attempts=3,
    )


def _deploy_web(app: Path, environment: str) -> None:
    _run(
        [PNPM, "--filter", f"@sabores/{app.name}", "build"],
        cwd=ROOT,
        env={"CLOUDFLARE_ENV": environment},
    )
    _run(
        [PNPM, "--filter", f"@sabores/{app.name}", "exec", "wrangler", "deploy"],
        cwd=ROOT,
        env={"CLOUDFLARE_ENV": environment},
        network_attempts=3,
    )


def _api_preview(target, source, env):
    _cloudflare_preflight()
    _deploy_api("preview")


def _preview(target, source, env):
    account_id, token = _cloudflare_preflight()
    _require_access(
        ["erp-preview.brunosrz.com", "pdv-preview.brunosrz.com"], account_id, token
    )
    _deploy_api("preview")
    _deploy_web(ERP, "preview")
    _deploy_web(PDV, "preview")
    print(
        "\nPreview publicado com Access: https://erp-preview.brunosrz.com e https://pdv-preview.brunosrz.com"
    )


def _prod(target, source, env):
    account_id, token = _cloudflare_preflight()
    _require_access(["erp.brunosrz.com", "pdv.brunosrz.com"], account_id, token)
    _deploy_api("production")
    _deploy_web(ERP, "production")
    _deploy_web(PDV, "production")
    print(
        "\nProdução publicada com Access: https://erp.brunosrz.com e https://pdv.brunosrz.com"
    )


def _help(target, source, env):
    print(
        """
Sabores da Canastra — alvos Cloudflare (a partir da raiz)

  scons api-preview   aplica migrations remotas e publica somente a API privada
  scons preview       valida Access, aplica migrations e publica API + ERP + PDV
  scons prod          valida Access/configuração, aplica migrations e publica produção

Pré-requisitos: uv, pnpm, Node.js, SCons, Wrangler autenticado e .env local.
Secrets da API ficam em apps/api/.env.preview ou apps/api/.env.production.
"""
    )


env = Environment(ENV=os.environ)  # noqa: F821 - SCons built-in.
env.Decider("timestamp-match")


def _target(name, action):
    node = env.Command(f"_{name}", [], action)
    env.AlwaysBuild(node)
    env.Alias(name, node)


_target("api-preview", _api_preview)
_target("preview", _preview)
_target("prod", _prod)
_target("help", _help)

Default(env.Command("_default", [], _help))  # noqa: F821 - SCons built-in.
