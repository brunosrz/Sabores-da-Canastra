import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/index";

const origin = "https://erp.example.test";
const salt = new Uint8Array(16).fill(7);
const userId = "test-user-auth";
const username = "auth-test-user";
let credentialHash: string;

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return encode(new Uint8Array(digest));
}

async function configuredCredentialFingerprint(): Promise<string> {
  return sha256(
    JSON.stringify([
      userId,
      username.toLowerCase(),
      "owner",
      encode(salt),
      credentialHash,
      100_000,
    ]),
  );
}

async function passwordHash(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    key,
    256,
  );
  return encode(new Uint8Array(bits));
}

function bindings() {
  return {
    DB: env.DB,
    AUTH_ALLOWED_ORIGINS: origin,
  };
}

async function login(
  password = "correct-password",
  clientIp = crypto.randomUUID(),
) {
  return app.request(
    "https://api.example.test/api/auth/login",
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-client-ip": clientIp,
        "x-forwarded-host": "erp.example.test",
      },
      body: JSON.stringify({ username, password }),
    },
    bindings(),
  );
}

describe("autenticação e sessão", () => {
  beforeAll(async () => {
    credentialHash = await passwordHash("correct-password");
    await env.DB.prepare(
      `INSERT OR REPLACE INTO users
        (user_id, username, role, salt, password_hash, iterations, active, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, ?, 100000, 1, ?, ?)`,
    )
      .bind(
        userId,
        username,
        encode(salt),
        credentialHash,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
  });

  it("cria sessão, identifica o usuário e revoga no logout", async () => {
    const loggedIn = await login();
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.headers.get("set-cookie")).toContain("HttpOnly");
    expect(loggedIn.headers.get("set-cookie")).toContain("SameSite=Strict");
    const loginBody = (await loggedIn.clone().json()) as { expiresAt: string };
    expect(Date.parse(loginBody.expiresAt)).toBeGreaterThan(Date.now());
    const cookie = loggedIn.headers.get("set-cookie")!.split(";")[0]!;

    const session = await app.request(
      "https://api.example.test/api/auth/session",
      { headers: { cookie } },
      bindings(),
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as {
      user: { id: string; username: string };
      expiresAt: string;
    };
    expect(sessionBody).toMatchObject({
      user: { id: userId, username },
    });
    expect(Date.parse(sessionBody.expiresAt)).toBeGreaterThan(Date.now());

    const loggedOut = await app.request(
      "https://api.example.test/api/auth/logout",
      {
        method: "POST",
        headers: { origin, cookie },
      },
      bindings(),
    );
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    const revoked = await app.request(
      "https://api.example.test/api/auth/session",
      { headers: { cookie } },
      bindings(),
    );
    expect(revoked.status).toBe(401);
  });

  it("invalida sessões quando as credenciais configuradas mudam", async () => {
    const loggedIn = await login();
    const cookie = loggedIn.headers.get("set-cookie")!.split(";")[0]!;
    const replacementHash = await passwordHash("replacement-password");
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?",
    )
      .bind(replacementHash, new Date().toISOString(), userId)
      .run();

    try {
      const session = await app.request(
        "https://api.example.test/api/auth/session",
        { headers: { cookie } },
        bindings(),
      );
      expect(session.status).toBe(401);
    } finally {
      await env.DB.prepare(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?",
      )
        .bind(credentialHash, new Date().toISOString(), userId)
        .run();
    }
  });

  it("responde igual para usuário desconhecido e senha incorreta", async () => {
    const wrongPassword = await login("wrong-password");
    const unknownUser = await app.request(
      "https://api.example.test/api/auth/login",
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-client-ip": crypto.randomUUID(),
        },
        body: JSON.stringify({
          username: "unknown-user",
          password: "wrong-password",
        }),
      },
      bindings(),
    );
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownUser.json());
  });

  it("limita tentativas seguidas por endereço", async () => {
    const clientIp = crypto.randomUUID();
    const accountBucketKey = `account:${await sha256(username)}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login("incorrect", clientIp)).status).toBe(401);
    }
    const accountBucketBeforeBlock = await env.DB.prepare(
      "SELECT attempts FROM auth_login_attempts WHERE bucket_hash = ?",
    )
      .bind(accountBucketKey)
      .first<{ attempts: number }>();
    const blocked = await login("correct-password", clientIp);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: "Usuário ou senha inválidos.",
    });
    const accountBucketAfterBlock = await env.DB.prepare(
      "SELECT attempts FROM auth_login_attempts WHERE bucket_hash = ?",
    )
      .bind(accountBucketKey)
      .first<{ attempts: number }>();
    expect(accountBucketAfterBlock?.attempts).toBe(
      accountBucketBeforeBlock?.attempts,
    );
  });

  it("rejeita acesso a rotas financeiras sem sessão, mesmo com token legado", async () => {
    const response = await app.request(
      "https://api.example.test/api/sales",
      {
        method: "POST",
        headers: {
          authorization: "Bearer old-token",
          "idempotency-key": "sale-unauth-0001",
          origin,
        },
        body: "{}",
      },
      {
        ...bindings(),
        SALE_COORDINATOR: {
          getByName: () => {
            throw new Error("não deve consultar");
          },
        } as unknown as DurableObjectNamespace,
      },
    );
    expect(response.status).toBe(401);
  });

  it("rejeita cookie alterado e expirado", async () => {
    const altered = await app.request(
      "https://api.example.test/api/auth/session",
      {
        headers: { cookie: "sabores_session=altered-session-token" },
      },
      bindings(),
    );
    expect(altered.status).toBe(401);

    await env.DB.prepare(
      "INSERT OR IGNORE INTO auth_users (user_id, username, role, active, created_at) VALUES (?, ?, 'owner', 1, ?)",
    )
      .bind(userId, username, new Date().toISOString())
      .run();
    const token = "expired-session-token";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );
    await env.DB.prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, credential_fingerprint) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        encode(new Uint8Array(digest)),
        userId,
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() - 1).toISOString(),
        await configuredCredentialFingerprint(),
      )
      .run();
    const expired = await app.request(
      "https://api.example.test/api/auth/session",
      {
        headers: { cookie: `sabores_session=${token}` },
      },
      bindings(),
    );
    expect(expired.status).toBe(401);

    const validToken = "valid-session-token";
    const validDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(validToken),
    );
    await env.DB.prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, credential_fingerprint) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        encode(new Uint8Array(validDigest)),
        userId,
        new Date().toISOString(),
        new Date(Date.now() + 60_000).toISOString(),
        await configuredCredentialFingerprint(),
      )
      .run();
    const valid = await app.request(
      "https://api.example.test/api/auth/session",
      {
        headers: { cookie: `sabores_session=${validToken}` },
      },
      bindings(),
    );
    expect(valid.status).toBe(200);
  });

  it("bloqueia login sem origem aprovada", async () => {
    const response = await app.request(
      "https://api.example.test/api/auth/login",
      {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ username, password: "correct-password" }),
      },
      bindings(),
    );
    expect(response.status).toBe(403);
  });

  it("rejeita venda autenticada com origem não aprovada", async () => {
    const loggedIn = await login();
    const cookie = loggedIn.headers.get("set-cookie")!.split(";")[0]!;
    const getByName = () => {
      throw new Error("a venda não deve chegar ao coordenador");
    };
    const response = await app.request(
      "https://api.example.test/api/sales",
      {
        method: "POST",
        headers: {
          cookie,
          origin: "https://attacker.example",
          "idempotency-key": "csrf-denied-sale-1",
        },
        body: "{}",
      },
      {
        ...bindings(),
        SALE_COORDINATOR: { getByName } as unknown as DurableObjectNamespace,
      },
    );
    expect(response.status).toBe(403);
  });

  it("não expõe rota de cadastro público", async () => {
    const response = await app.request(
      "https://api.example.test/api/auth/register",
      { method: "POST", headers: { origin }, body: "{}" },
      bindings(),
    );
    expect(response.status).toBe(401);
  });

  it("protege também rotas de API ainda não implementadas", async () => {
    const response = await app.request(
      "https://api.example.test/api/finance/entries",
      {},
      bindings(),
    );
    expect(response.status).toBe(401);
  });

  it("limita o corpo de autenticação antes de acessar D1", async () => {
    const prepare = vi.fn();
    const response = await app.request(
      "https://api.example.test/api/auth/login",
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: `{"username":"${"x".repeat(16_400)}"}`,
      },
      { ...bindings(), DB: { prepare } as unknown as D1Database },
    );
    expect(response.status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });
});
