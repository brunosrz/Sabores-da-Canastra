const SESSION_SECONDS = 60 * 60 * 12;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 10;
const ACCOUNT_LOGIN_ATTEMPT_LIMIT = 100;
const MIN_PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 1_000_000;

export type AuthUser = { id: string; username: string; role: string };
type ConfiguredUser = AuthUser & {
  salt: string;
  hash: string;
  iterations: number;
};

type AuthBindings = {
  DB: D1Database;
  AUTH_USERS?: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_NAME?: string;
  AUTH_ALLOWED_ORIGINS?: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
    throw new Error("AUTH_NOT_CONFIGURED");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function configuredUsers(serialized: string | undefined): ConfiguredUser[] {
  if (!serialized) throw new Error("AUTH_NOT_CONFIGURED");
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("AUTH_NOT_CONFIGURED");
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new Error("AUTH_NOT_CONFIGURED");
  for (const user of value) {
    if (
      !user ||
      typeof user.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(user.id) ||
      typeof user.username !== "string" ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(user.username) ||
      typeof user.role !== "string" ||
      typeof user.salt !== "string" ||
      typeof user.hash !== "string" ||
      !Number.isSafeInteger(user.iterations) ||
      user.iterations < MIN_PBKDF2_ITERATIONS ||
      user.iterations > MAX_PBKDF2_ITERATIONS
    )
      throw new Error("AUTH_NOT_CONFIGURED");
    try {
      if (
        fromBase64Url(user.salt).byteLength !== 16 ||
        fromBase64Url(user.hash).byteLength !== 32
      )
        throw new Error("AUTH_NOT_CONFIGURED");
    } catch {
      throw new Error("AUTH_NOT_CONFIGURED");
    }
  }
  return value as ConfiguredUser[];
}

async function verifyPassword(
  password: string,
  user: ConfiguredUser,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBytes = fromBase64Url(user.salt);
  const saltBuffer = new ArrayBuffer(saltBytes.byteLength);
  new Uint8Array(saltBuffer).set(saltBytes);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations: user.iterations,
    },
    key,
    256,
  );
  const actual = new Uint8Array(bits);
  const expected = fromBase64Url(user.hash);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1)
    difference |= actual[index]! ^ expected[index]!;
  return difference === 0;
}

function sessionCookieName(bindings: AuthBindings): string {
  const configured = bindings.AUTH_COOKIE_NAME?.trim();
  return configured && /^[A-Za-z0-9_-]{1,64}$/.test(configured)
    ? configured
    : "sabores_session";
}

function cookieValue(request: Request, bindings: AuthBindings): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === sessionCookieName(bindings)) return value.join("=") || null;
  }
  return null;
}

function sessionCookie(
  request: Request,
  bindings: AuthBindings,
  value: string,
  maxAge: number,
): string {
  const host =
    request.headers.get("x-forwarded-host") ?? new URL(request.url).hostname;
  const isLocal =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:");
  const secure = !isLocal;
  const domain = bindings.AUTH_COOKIE_DOMAIN?.trim();
  return `${sessionCookieName(bindings)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}${domain && !isLocal ? `; Domain=${domain}` : ""}`;
}

export function hasTrustedOrigin(
  request: Request,
  bindings: AuthBindings,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  const configured = (bindings.AUTH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured.includes(normalized);
}

async function consumeLoginAttempt(
  db: D1Database,
  clientIp: string,
  normalizedUsername: string,
): Promise<boolean> {
  const ipHash = await sha256(clientIp || "unknown-client");
  const identityHash = await sha256(`${ipHash}:${normalizedUsername}`);
  const accountHash = await sha256(normalizedUsername);
  const now = Math.floor(Date.now() / 1000);
  if (now % 300 < 60) {
    await db
      .prepare("DELETE FROM auth_login_attempts WHERE window_started_at < ?")
      .bind(now - 86_400)
      .run();
  }
  const bucketSql = `
    INSERT INTO auth_login_attempts (bucket_hash, window_started_at, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket_hash) DO UPDATE SET
      attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
    RETURNING attempts
  `;
  const buckets = [
    { key: `ip:${ipHash}`, limit: LOGIN_ATTEMPT_LIMIT },
    { key: `identity:${identityHash}`, limit: LOGIN_ATTEMPT_LIMIT },
    { key: `account:${accountHash}`, limit: ACCOUNT_LOGIN_ATTEMPT_LIMIT },
  ];
  const results = await Promise.all(
    buckets.map(({ key }) =>
      db
        .prepare(bucketSql)
        .bind(key, now, now - LOGIN_WINDOW_SECONDS, now - LOGIN_WINDOW_SECONDS)
        .first<{ attempts: number }>(),
    ),
  );
  return results.every(
    (result, index) =>
      (result?.attempts ?? buckets[index]!.limit + 1) <= buckets[index]!.limit,
  );
}

async function credentialFingerprint(user: ConfiguredUser): Promise<string> {
  return sha256(
    JSON.stringify([
      user.id,
      user.username.toLowerCase(),
      user.role,
      user.salt,
      user.hash,
      user.iterations,
    ]),
  );
}

async function auditLoginFailure(
  reason: string,
  username: string,
  clientIp: string,
): Promise<void> {
  console.warn("auth.login.failed", {
    reason,
    usernameHash: await sha256(username.toLowerCase()),
    clientIpHash: await sha256(clientIp || "unknown-client"),
  });
}

export async function login(
  request: Request,
  bindings: AuthBindings,
): Promise<Response> {
  if (!hasTrustedOrigin(request, bindings))
    return Response.json({ error: "Solicitação inválida." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const submitted =
    body && typeof body === "object"
      ? (body as { username?: unknown; password?: unknown })
      : {};
  const username =
    typeof submitted.username === "string" ? submitted.username.trim() : "";
  const password =
    typeof submitted.password === "string" ? submitted.password : "";
  if (username.length > 80 || password.length > 128)
    return Response.json(
      { error: "Usuário ou senha inválidos." },
      { status: 401 },
    );

  let users: ConfiguredUser[];
  try {
    users = configuredUsers(bindings.AUTH_USERS);
  } catch {
    return Response.json(
      { error: "Autenticação indisponível." },
      { status: 503 },
    );
  }
  const clientIp = request.headers.get("x-client-ip") ?? "";
  let withinLimit: boolean;
  try {
    withinLimit = await consumeLoginAttempt(
      bindings.DB,
      clientIp,
      username.toLowerCase(),
    );
  } catch {
    return Response.json(
      { error: "Autenticação indisponível." },
      { status: 503 },
    );
  }
  if (!withinLimit)
    return Response.json(
      { error: "Usuário ou senha inválidos." },
      { status: 429 },
    );

  const user = users.find(
    (candidate) => candidate.username.toLowerCase() === username.toLowerCase(),
  );
  const fakeUser: ConfiguredUser = {
    id: "invalid",
    username: "invalid",
    role: "owner",
    salt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    iterations: Math.max(...users.map((candidate) => candidate.iterations)),
  };
  let valid = false;
  try {
    valid = await verifyPassword(password, user ?? fakeUser);
  } catch (error) {
    console.error("Falha ao derivar hash da senha durante login.", error);
    /* resposta genérica abaixo */
  }
  if (!user || !valid) {
    await auditLoginFailure(
      user ? "invalid-password" : "unknown-user",
      username,
      clientIp,
    );
    return Response.json(
      { error: "Usuário ou senha inválidos." },
      { status: 401 },
    );
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(tokenBytes);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_SECONDS * 1000,
  ).toISOString();
  try {
    await bindings.DB.batch([
      bindings.DB.prepare(
        `INSERT INTO auth_users (user_id, username, role, active, created_at)
        VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, role = excluded.role, active = 1`,
      ).bind(user.id, user.username, user.role, now.toISOString()),
      bindings.DB.prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, credential_fingerprint)
        VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        tokenHash,
        user.id,
        now.toISOString(),
        expiresAt,
        await credentialFingerprint(user),
      ),
    ]);
  } catch {
    return Response.json(
      { error: "Não foi possível iniciar a sessão." },
      { status: 503 },
    );
  }
  return Response.json(
    { user: { id: user.id, username: user.username, role: user.role } },
    {
      headers: {
        "set-cookie": sessionCookie(request, bindings, token, SESSION_SECONDS),
        "cache-control": "no-store",
      },
    },
  );
}

export async function currentUser(
  request: Request,
  bindings: AuthBindings,
): Promise<AuthUser | null> {
  const token = cookieValue(request, bindings);
  if (!token || token.length > 100) return null;
  const users = configuredUsers(bindings.AUTH_USERS);
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await bindings.DB.prepare(
    `SELECT u.user_id AS id, u.username, u.role, s.credential_fingerprint
    FROM auth_sessions s JOIN auth_users u ON u.user_id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(tokenHash, now)
    .first<AuthUser & { credential_fingerprint: string }>();
  if (!row) return null;
  const configured = users.find(
    (user) =>
      user.id === row.id &&
      user.username.toLowerCase() === row.username.toLowerCase(),
  );
  if (!configured) return null;
  if (row.credential_fingerprint !== (await credentialFingerprint(configured)))
    return null;
  return { id: row.id, username: row.username, role: configured.role };
}

export async function sessionResponse(
  request: Request,
  bindings: AuthBindings,
): Promise<Response> {
  try {
    const user = await currentUser(request, bindings);
    if (!user)
      return Response.json(
        { error: "Não autenticado." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    return Response.json(
      { user },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Autenticação indisponível." },
      { status: 503 },
    );
  }
}

export async function logout(
  request: Request,
  bindings: AuthBindings,
): Promise<Response> {
  if (!hasTrustedOrigin(request, bindings))
    return Response.json({ error: "Solicitação inválida." }, { status: 403 });
  const token = cookieValue(request, bindings);
  if (token) {
    try {
      await bindings.DB.prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      )
        .bind(new Date().toISOString(), await sha256(token))
        .run();
    } catch {
      return Response.json(
        { error: "Não foi possível encerrar a sessão." },
        { status: 503 },
      );
    }
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": sessionCookie(request, bindings, "", 0),
        "cache-control": "no-store",
      },
    },
  );
}

export type { AuthBindings };
