import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

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
  result?: { at_bookmark?: string; signed_url?: string; filename?: string };
};

export interface BackupManifest {
  contract: "sabores-da-canastra/d1-backup";
  contract_version: 1;
  database_id: string;
  bookmark: string;
  created_at: string;
  sql_key: string;
  size_bytes: number;
  sha256: string;
  restore: string;
}

export function backupPrefix(bookmark: string): string {
  const safeBookmark = bookmark.replace(/[^A-Za-z0-9_-]/g, "_");
  return `backups/d1/${safeBookmark}`;
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

export async function verifyBackupContent(
  content: ArrayBuffer,
  manifestText: string,
  expectedKey: string,
): Promise<boolean> {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestText) as BackupManifest;
  } catch {
    return false;
  }
  if (
    manifest.contract !== "sabores-da-canastra/d1-backup" ||
    manifest.contract_version !== 1 ||
    manifest.sql_key !== expectedKey ||
    manifest.size_bytes !== content.byteLength
  ) {
    return false;
  }
  const digest = await crypto.subtle.digest("SHA-256", content);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return actual === manifest.sha256;
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
    const bookmark = await step.do("Iniciar exportação do D1", async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ output_format: "polling" }),
      });
      const body = (await response.json()) as ExportResult;
      if (!response.ok || !body.result?.at_bookmark) {
        throw new Error(
          body.errors?.[0]?.message ?? "API D1 não iniciou a exportação.",
        );
      }
      return body.result.at_bookmark;
    });

    let signedUrl: string | undefined;
    for (let attempt = 0; attempt < 30 && !signedUrl; attempt += 1) {
      signedUrl = await step.do(
        `Consultar exportação D1 ${attempt + 1}`,
        async () => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ current_bookmark: bookmark }),
          });
          const body = (await response.json()) as ExportResult;
          if (!response.ok)
            throw new Error(
              body.errors?.[0]?.message ?? "Falha consultando exportação D1.",
            );
          return body.result?.signed_url;
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
      const dump = await dumpResponse.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", dump);
      const sha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const prefix = backupPrefix(bookmark);
      const sqlKey = `${prefix}.sql`;
      const manifestKey = `${prefix}.json`;
      const manifest = {
        contract: "sabores-da-canastra/d1-backup",
        contract_version: 1,
        database_id: this.env.BACKUP_DATABASE_ID,
        bookmark,
        created_at: event.timestamp.toISOString(),
        sql_key: sqlKey,
        size_bytes: dump.byteLength,
        sha256,
        restore:
          "Verifique SHA-256 e importe o arquivo SQL em um D1 isolado antes de substituir qualquer banco.",
      };
      await putImmutableBackupObject(
        this.env.PRIVATE_FILES,
        sqlKey,
        dump,
        "application/sql",
        { bookmark },
      );
      await putImmutableBackupObject(
        this.env.PRIVATE_FILES,
        manifestKey,
        JSON.stringify(manifest, null, 2),
        "application/json",
        { bookmark, sql_sha256: sha256 },
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
