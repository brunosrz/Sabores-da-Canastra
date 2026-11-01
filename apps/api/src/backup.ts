import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { sha256 } from "@noble/hashes/sha2.js";

type BackupEnv = {
  PRIVATE_FILES: R2Bucket;
  BACKUP_ACCOUNT_ID: string;
  BACKUP_DATABASE_ID: string;
  BACKUP_RETENTION_DAYS: string;
  D1_BACKUP_TOKEN?: string;
};

type ExportResult = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    at_bookmark?: string;
    status?: "complete" | "error";
    error?: string;
    result?: { signed_url?: string; filename?: string };
  };
};

type InitialExportState = {
  bookmark: string | null;
  signedUrl: string | undefined;
};

export function initialExportState(body: ExportResult): InitialExportState {
  if (body.success === false) {
    throw new Error(
      body.errors?.[0]?.message ?? "API D1 não iniciou a exportação.",
    );
  }
  if (body.result?.status === "error") {
    throw new Error(body.result.error ?? "A exportação D1 falhou.");
  }
  if (body.result?.status === "complete") {
    const signedUrl = body.result.result?.signed_url;
    if (!signedUrl) {
      throw new Error("Exportação D1 concluída sem URL para baixar o SQL.");
    }
    return { bookmark: body.result.at_bookmark ?? null, signedUrl };
  }
  if (!body.result?.at_bookmark) {
    throw new Error(
      body.errors?.[0]?.message ?? "API D1 não iniciou a exportação.",
    );
  }
  return { bookmark: body.result.at_bookmark, signedUrl: undefined };
}

export interface BackupManifest {
  contract: "sabores-da-canastra/d1-backup";
  contract_version: 1;
  database_id: string;
  bookmark: string | null;
  created_at: string;
  sql_key: string;
  size_bytes: number;
  sha256: string;
  restore: string;
}

export function backupPrefix(bookmark: string | null, runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "_");
  if (bookmark === null) return `backups/d1/${safeRunId}`;
  const safeBookmark = bookmark.replace(/[^A-Za-z0-9_-]/g, "_");
  return `backups/d1/${safeBookmark}-${safeRunId}`;
}

export function backupExpired(
  createdAt: string,
  now: Date,
  retentionDays: number,
): boolean {
  const created = Date.parse(createdAt);
  return (
    Number.isFinite(created) &&
    now.getTime() - created > retentionDays * 86_400_000
  );
}

type StreamDigest = { size: number; sha256: string };

function digestHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashStream(
  stream: ReadableStream<Uint8Array>,
): Promise<StreamDigest> {
  const hasher = sha256.create();
  const reader = stream.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { size, sha256: digestHex(hasher.digest()) };
}

function hashWhileStreaming(stream: ReadableStream<Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  digest: Promise<StreamDigest>;
} {
  const hasher = sha256.create();
  let size = 0;
  let resolveDigest!: (digest: StreamDigest) => void;
  let rejectDigest!: (error: unknown) => void;
  const digest = new Promise<StreamDigest>((resolve, reject) => {
    resolveDigest = resolve;
    rejectDigest = reject;
  });
  const transformed = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        hasher.update(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        resolveDigest({ size, sha256: digestHex(hasher.digest()) });
      },
      cancel(reason) {
        rejectDigest(reason);
      },
    }),
  );
  return { stream: transformed, digest };
}

export async function verifyBackupStream(
  content: ReadableStream<Uint8Array>,
  manifestText: string,
  expectedKey: string,
): Promise<boolean> {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestText) as BackupManifest;
  } catch {
    return false;
  }
  if (!manifest || typeof manifest !== "object") return false;
  if (
    manifest.contract !== "sabores-da-canastra/d1-backup" ||
    manifest.contract_version !== 1 ||
    manifest.sql_key !== expectedKey ||
    !Number.isSafeInteger(manifest.size_bytes) ||
    manifest.size_bytes < 0 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  ) {
    return false;
  }
  const actual = await hashStream(content);
  return (
    actual.size === manifest.size_bytes && actual.sha256 === manifest.sha256
  );
}

export async function putImmutableBackupStream(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
  expectedDigest: StreamDigest,
  extraMetadata: Record<string, string> = {},
): Promise<void> {
  const existing = await bucket.get(key);
  if (existing) {
    if (
      existing.size === expectedDigest.size &&
      existing.customMetadata?.sha256 === expectedDigest.sha256
    ) {
      await body.cancel();
      return;
    }
    throw new Error(`Backup key already contains different content: ${key}`);
  }
  const hashed = hashWhileStreaming(body);
  const fixedLength = new FixedLengthStream(expectedDigest.size);
  const upload = bucket.put(key, fixedLength.readable, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType },
    customMetadata: { ...extraMetadata, sha256: expectedDigest.sha256 },
  });
  await Promise.all([hashed.stream.pipeTo(fixedLength.writable), upload]);
  const created = await upload;
  const actual = await hashed.digest;
  if (
    actual.size !== expectedDigest.size ||
    actual.sha256 !== expectedDigest.sha256
  ) {
    if (created) await bucket.delete(key);
    throw new Error(
      "O SQL exportado mudou entre as leituras de validação e gravação.",
    );
  }
  if (created) return;
  const raced = await bucket.get(key);
  if (
    !raced ||
    raced.size !== expectedDigest.size ||
    raced.customMetadata?.sha256 !== expectedDigest.sha256
  ) {
    throw new Error(
      `Backup key was concurrently written with different content: ${key}`,
    );
  }
}

export async function putImmutableBackupObject(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer | string,
  contentType: string,
  extraMetadata: Record<string, string> = {},
): Promise<void> {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const existing = await bucket.get(key);
  if (existing) {
    if (
      existing.size === bytes.byteLength &&
      existing.customMetadata?.sha256 === sha256
    ) {
      return;
    }
    throw new Error(`Backup key already contains different content: ${key}`);
  }

  const created = await bucket.put(key, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType },
    customMetadata: { ...extraMetadata, sha256 },
  });
  if (created) return;
  const raced = await bucket.get(key);
  if (
    !raced ||
    raced.size !== bytes.byteLength ||
    raced.customMetadata?.sha256 !== sha256
  ) {
    throw new Error(
      `Backup key was concurrently written with different content: ${key}`,
    );
  }
}

export class D1BackupWorkflow extends WorkflowEntrypoint<BackupEnv> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<void> {
    const token = this.env.D1_BACKUP_TOKEN;
    if (!token || !this.env.BACKUP_ACCOUNT_ID || !this.env.BACKUP_DATABASE_ID) {
      throw new Error(
        "Backup Cloudflare não configurado: faltam token, conta ou banco D1.",
      );
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.env.BACKUP_ACCOUNT_ID}/d1/database/${this.env.BACKUP_DATABASE_ID}/export`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const initialExport = await step.do(
      "Iniciar exportação do D1",
      async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ output_format: "polling" }),
        });
        const body = (await response.json()) as ExportResult;
        if (!response.ok) {
          throw new Error(
            body.errors?.[0]?.message ?? "API D1 não iniciou a exportação.",
          );
        }
        return initialExportState(body);
      },
    );

    const bookmark = initialExport.bookmark;
    let signedUrl: string | undefined = initialExport.signedUrl;
    if (!signedUrl && !bookmark) {
      throw new Error("Exportação D1 pendente sem bookmark para polling.");
    }
    for (let attempt = 0; attempt < 30 && !signedUrl; attempt += 1) {
      signedUrl = await step.do(
        `Consultar exportação D1 ${attempt + 1}`,
        async () => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
              output_format: "polling",
              current_bookmark: bookmark!,
            }),
          });
          const body = (await response.json()) as ExportResult;
          if (!response.ok || body.success === false)
            throw new Error(
              body.errors?.[0]?.message ?? "Falha consultando exportação D1.",
            );
          if (body.result?.status === "error") {
            throw new Error(body.result.error ?? "A exportação D1 falhou.");
          }
          if (body.result?.status === "complete") {
            const url = body.result.result?.signed_url;
            if (!url) {
              throw new Error(
                "Exportação D1 concluída sem URL para baixar o SQL.",
              );
            }
            return url;
          }
          return undefined;
        },
      );
      if (!signedUrl)
        await step.sleep(`Aguardar exportação ${attempt + 1}`, "20 seconds");
    }
    if (!signedUrl)
      throw new Error("Exportação D1 excedeu o limite de tentativas.");

    await step.do("Validar e salvar backup privado", async () => {
      const dumpResponse = await fetch(signedUrl);
      if (!dumpResponse.ok)
        throw new Error("Falha ao baixar SQL exportado do D1.");
      if (!dumpResponse.body) throw new Error("Exportação D1 sem corpo SQL.");
      const firstDigest = await hashStream(dumpResponse.body);
      const uploadResponse = await fetch(signedUrl);
      if (!uploadResponse.ok || !uploadResponse.body)
        throw new Error("Falha ao reabrir SQL exportado para gravação no R2.");
      const prefix = backupPrefix(bookmark, event.instanceId);
      const sqlKey = `${prefix}.sql`;
      const manifestKey = `${prefix}.json`;
      const manifest = {
        contract: "sabores-da-canastra/d1-backup",
        contract_version: 1,
        database_id: this.env.BACKUP_DATABASE_ID,
        bookmark,
        created_at: event.timestamp.toISOString(),
        sql_key: sqlKey,
        size_bytes: firstDigest.size,
        sha256: firstDigest.sha256,
        restore:
          "Verifique SHA-256 e importe o arquivo SQL em um D1 isolado antes de substituir qualquer banco.",
      };
      await putImmutableBackupStream(
        this.env.PRIVATE_FILES,
        sqlKey,
        uploadResponse.body,
        "application/sql",
        firstDigest,
        bookmark ? { bookmark } : {},
      );
      await putImmutableBackupObject(
        this.env.PRIVATE_FILES,
        manifestKey,
        JSON.stringify(manifest, null, 2),
        "application/json",
        { ...(bookmark ? { bookmark } : {}), sql_sha256: firstDigest.sha256 },
      );

      const retentionDays = Number(this.env.BACKUP_RETENTION_DAYS || "90");
      if (
        !Number.isInteger(retentionDays) ||
        retentionDays < 7 ||
        retentionDays > 3650
      ) {
        throw new Error("BACKUP_RETENTION_DAYS precisa estar entre 7 e 3650.");
      }
      let cursor: string | undefined;
      do {
        const page = await this.env.PRIVATE_FILES.list({
          prefix: "backups/d1/",
          cursor,
        });
        for (const object of page.objects) {
          if (
            object.key.startsWith("backups/d1/") &&
            backupExpired(
              object.uploaded.toISOString(),
              new Date(),
              retentionDays,
            )
          ) {
            await this.env.PRIVATE_FILES.delete(object.key);
          }
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    });
  }
}
