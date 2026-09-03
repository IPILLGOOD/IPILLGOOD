type JsonRecord = Record<string, unknown>;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export interface SetOptionsLike {
  merge?: boolean;
}

export type QueryOperator = "==" | "in" | "<" | "<=" | ">" | ">=";
export type QueryDirection = "asc" | "desc";

export interface DocumentSnapshotLike {
  exists: boolean;
  id: string;
  ref: DocumentReferenceLike;
  data(): unknown;
}

export interface QuerySnapshotLike {
  docs: DocumentSnapshotLike[];
}

export interface DocumentReferenceLike {
  id: string;
  path: string;
  collection(name: string): CollectionReferenceLike;
  listCollections(): Promise<CollectionReferenceLike[]>;
  get(): Promise<DocumentSnapshotLike>;
  set(data: unknown, options?: SetOptionsLike): Promise<void>;
}

export interface CollectionReferenceLike {
  path: string;
  doc(id: string): DocumentReferenceLike;
  listDocuments(): Promise<DocumentReferenceLike[]>;
  where(fieldPath: string, operator: QueryOperator, value: unknown): QueryLike;
  orderBy(fieldPath: string, direction?: QueryDirection): QueryLike;
  limit(count: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface QueryLike {
  where(fieldPath: string, operator: QueryOperator, value: unknown): QueryLike;
  orderBy(fieldPath: string, direction?: QueryDirection): QueryLike;
  limit(count: number): QueryLike;
  startAfter(...values: unknown[]): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface WriteOperationsLike {
  set(ref: DocumentReferenceLike, data: unknown, options?: SetOptionsLike): this;
  create(ref: DocumentReferenceLike, data: unknown): this;
  delete(ref: DocumentReferenceLike): this;
}

export interface WriteBatchLike extends WriteOperationsLike {
  commit(): Promise<void>;
}

export interface TransactionLike extends WriteOperationsLike {
  get(ref: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  get(query: QueryLike | CollectionReferenceLike): Promise<QuerySnapshotLike>;
}

export interface FirestoreLike {
  collection(path: string): CollectionReferenceLike;
  batch(): WriteBatchLike;
  runTransaction<T>(fn: (transaction: TransactionLike) => Promise<T>): Promise<T>;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function textToBase64Url(value: string) {
  return base64Url(new TextEncoder().encode(value));
}

function pemToBytes(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeFirestoreValue(value: unknown): JsonRecord {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (value && typeof value === "object") {
    return { mapValue: { fields: encodeFirestoreFields(value as JsonRecord) } };
  }
  return { nullValue: null };
}

function decodeFirestoreValue(encoded: unknown): unknown {
  if (!encoded || typeof encoded !== "object") return undefined;
  const value = encoded as JsonRecord;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const arrayValue = value.arrayValue as { values?: unknown[] } | undefined;
    return (arrayValue?.values ?? []).map(decodeFirestoreValue);
  }
  if ("mapValue" in value) {
    const mapValue = value.mapValue as { fields?: JsonRecord } | undefined;
    return decodeFirestoreFields(mapValue?.fields ?? {});
  }
  return undefined;
}

export function encodeFirestoreFields(data: JsonRecord) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)]),
  );
}

export function decodeFirestoreFields(fields: JsonRecord) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

function encodedResourcePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export class FirestoreRestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`Firestore REST request failed: HTTP ${status}`);
    this.name = "FirestoreRestError";
    this.status = status;
    this.code = code;
  }
}

type QueryConstraint = {
  fieldPath: string;
  operator: QueryOperator;
  value: unknown;
};

type QueryOrder = {
  fieldPath: string;
  direction: QueryDirection;
};

function firestoreOperator(operator: QueryOperator) {
  return {
    "==": "EQUAL",
    "in": "IN",
    "<": "LESS_THAN",
    "<=": "LESS_THAN_OR_EQUAL",
    ">": "GREATER_THAN",
    ">=": "GREATER_THAN_OR_EQUAL",
  }[operator];
}

export class FirestoreRestClient implements FirestoreLike {
  private readonly baseUrl: string;
  private readonly credentials: ServiceAccountCredentials;
  private readonly fetcher: typeof fetch;
  private readonly emulatorHost?: string;
  private readonly oauthScope: string;
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    credentials: ServiceAccountCredentials,
    projectId: string,
    fetcher: typeof fetch = fetch,
    emulatorHost?: string,
    oauthScope = "https://www.googleapis.com/auth/datastore",
  ) {
    this.credentials = credentials;
    this.fetcher = fetcher;
    this.emulatorHost = emulatorHost;
    this.oauthScope = oauthScope;
    if (emulatorHost && (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost) || !projectId.startsWith("demo-"))) {
      throw new Error("Firestore emulator requires a loopback host and demo- project.");
    }
    this.baseUrl = `${emulatorHost ? `http://${emulatorHost}` : "https://firestore.googleapis.com"}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  }

  collection(path: string) {
    return new RestCollectionReference(this, path);
  }

  batch() {
    return new RestWriteBatch(this);
  }

  async runTransaction<T>(fn: (transaction: TransactionLike) => Promise<T>): Promise<T> {
    let retryTransaction: string | undefined;
    for (let attempt = 0; ; attempt++) {
      const response = await this.requestUrl(`${this.baseUrl}:beginTransaction`, {
        method: "POST", body: JSON.stringify({ options: { readWrite: retryTransaction ? { retryTransaction } : {} } }),
      });
      const { transaction } = await response.json() as { transaction: string };
      const writer = new RestTransaction(this, transaction);
      try {
        const result = await fn(writer);
        await writer.commit();
        return result;
      } catch (error) {
        await this.requestUrl(`${this.baseUrl}:rollback`, {
          method: "POST", body: JSON.stringify({ transaction }),
        }).catch(() => undefined);
        if (!(error instanceof FirestoreRestError) || error.code !== "ABORTED" || attempt >= 6) throw error;
        retryTransaction = transaction;
        await new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** attempt, 2000) * (0.5 + Math.random())));
      }
    }
  }

  documentName(path: string) {
    return this.baseUrl.slice(this.baseUrl.indexOf("/projects/") + 1) + "/" + path;
  }

  async commit(writes: JsonRecord[], transaction?: string) {
    if (!writes.length && !transaction) return;
    if (writes.length > 500) throw new Error("Firestore commits are limited to 500 writes.");
    await this.requestUrl(`${this.baseUrl}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }),
    });
  }

  private async createAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = this.credentials.token_uri ?? "https://oauth2.googleapis.com/token";
    const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = textToBase64Url(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: this.oauthScope,
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsignedToken = `${header}.${claims}`;
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(this.credentials.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(unsignedToken),
    );
    const assertion = `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
    const response = await this.fetcher(tokenUri, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new Error(`Google OAuth token request failed: HTTP ${response.status}`);
    const result = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!result.access_token) throw new Error("Google OAuth token response did not include an access token.");
    this.accessToken = {
      value: result.access_token,
      expiresAt: Date.now() + Math.max((result.expires_in ?? 3600) - 60, 60) * 1000,
    };
    return this.accessToken.value;
  }

  async getAccessToken() {
    if (this.emulatorHost) return "owner";
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.value;
    return this.createAccessToken();
  }

  private async requestUrl(url: string, init: RequestInit = {}, allowNotFound = false) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getAccessToken();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body) headers.set("Content-Type", "application/json");
      const response = await this.fetcher(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
      if (response.status === 401 && attempt === 0) {
        this.accessToken = undefined;
        continue;
      }
      if (allowNotFound && response.status === 404) return response;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: { status?: string } };
        throw new FirestoreRestError(response.status, payload.error?.status);
      }
      return response;
    }
    throw new Error("Firestore REST authentication failed.");
  }

  private request(relativeUrl: string, init: RequestInit = {}, allowNotFound = false) {
    return this.requestUrl(`${this.baseUrl}/${relativeUrl}`, init, allowNotFound);
  }

  async getDocument(path: string, ref: DocumentReferenceLike, transaction?: string) {
    if (transaction) {
      // batchGet carries the bytes-valued transaction in JSON, including on the emulator.
      const response = await this.requestUrl(`${this.baseUrl}:batchGet`, {
        method: "POST", body: JSON.stringify({ documents: [this.documentName(path)], transaction }),
      });
      const results = await response.json() as Array<{ found?: { fields?: JsonRecord }; missing?: string }>;
      const result = results.find((entry) => entry.found || entry.missing);
      if (!result) throw new Error("Firestore transaction read returned no document result.");
      return new RestDocumentSnapshot(ref, result.found ? decodeFirestoreFields(result.found.fields ?? {}) : undefined);
    }
    const response = await this.request(encodedResourcePath(path), {}, true);
    if (response.status === 404) return new RestDocumentSnapshot(ref, undefined);
    const document = (await response.json()) as { fields?: JsonRecord };
    return new RestDocumentSnapshot(ref, decodeFirestoreFields(document.fields ?? {}));
  }

  async setDocument(path: string, data: unknown, options?: SetOptionsLike) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Firestore documents must be objects.");
    }
    await this.commit([this.setWrite(path, data as JsonRecord, options)]);
  }

  setWrite(path: string, data: JsonRecord, options?: SetOptionsLike) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Firestore documents must be objects.");
    return {
      update: { name: this.documentName(path), fields: encodeFirestoreFields(data) },
      ...(options?.merge ? { updateMask: { fieldPaths: mergeFieldPaths(data) } } : {}),
    };
  }

  async createDocument(path: string, data: unknown) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Firestore documents must be objects.");
    }
    await this.commit([{ ...this.setWrite(path, data as JsonRecord), currentDocument: { exists: false } }]);
  }

  async deleteDocument(path: string) {
    await this.commit([{ delete: this.documentName(path) }]);
  }

  async getCollection(path: string) {
    const documents: DocumentSnapshotLike[] = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ pageSize: "300" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.request(`${encodedResourcePath(path)}?${query}`);
      const result = (await response.json()) as {
        documents?: Array<{ name: string; fields?: JsonRecord }>;
        nextPageToken?: string;
      };
      for (const document of result.documents ?? []) {
        const id = decodeURIComponent(document.name.split("/").at(-1) ?? "");
        const ref = new RestDocumentReference(this, `${path}/${id}`);
        documents.push(new RestDocumentSnapshot(ref, decodeFirestoreFields(document.fields ?? {})));
      }
      pageToken = result.nextPageToken ?? "";
    } while (pageToken);
    return { docs: documents } satisfies QuerySnapshotLike;
  }

  async listCollections(path: string) {
    const collections: CollectionReferenceLike[] = [];
    let pageToken = "";
    do {
      const response = await this.request(`${encodedResourcePath(path)}:listCollectionIds`, {
        method: "POST", body: JSON.stringify({ pageSize: 300, ...(pageToken ? { pageToken } : {}) }),
      });
      const result = await response.json() as { collectionIds?: string[]; nextPageToken?: string };
      collections.push(...(result.collectionIds ?? []).map((id) => this.collection(`${path}/${id}`)));
      pageToken = result.nextPageToken ?? "";
    } while (pageToken);
    return collections;
  }

  async listDocuments(path: string) {
    const references: DocumentReferenceLike[] = [];
    let pageToken = "";
    do {
      // Missing parents can still own subcollections; normal queries omit them.
      const query = new URLSearchParams({ pageSize: "300", showMissing: "true" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.request(`${encodedResourcePath(path)}?${query}`);
      const result = await response.json() as { documents?: Array<{ name: string }>; nextPageToken?: string };
      for (const doc of result.documents ?? []) {
        references.push(new RestDocumentReference(this, `${path}/${doc.name.split("/").at(-1)}`));
      }
      pageToken = result.nextPageToken ?? "";
    } while (pageToken);
    return references;
  }

  async runQuery(
    path: string,
    constraints: QueryConstraint[],
    orders: QueryOrder[],
    resultLimit?: number,
    transaction?: string,
    startAfter?: unknown[],
  ): Promise<QuerySnapshotLike> {
    const segments = path.split("/").filter(Boolean);
    const collectionId = segments.at(-1) ?? "";
    const parentPath = segments.slice(0, -1).join("/");
    const queryUrl = parentPath
      ? `${this.baseUrl}/${encodedResourcePath(parentPath)}:runQuery`
      : `${this.baseUrl}:runQuery`;
    const filters = constraints.map((constraint) => ({
      fieldFilter: {
        field: { fieldPath: constraint.fieldPath },
        op: firestoreOperator(constraint.operator),
        value: encodeFirestoreValue(constraint.value),
      },
    }));
    const where =
      filters.length === 0
        ? undefined
        : filters.length === 1
          ? filters[0]
          : { compositeFilter: { op: "AND", filters } };
    const response = await this.requestUrl(queryUrl, {
      method: "POST",
      body: JSON.stringify({
        ...(transaction ? { transaction } : {}),
        structuredQuery: {
          from: [{ collectionId }],
          ...(where ? { where } : {}),
          ...(orders.length
            ? {
                orderBy: orders.map((order) => ({
                  field: { fieldPath: order.fieldPath },
                  direction: order.direction === "desc" ? "DESCENDING" : "ASCENDING",
                })),
              }
            : {}),
          ...(resultLimit ? { limit: resultLimit } : {}),
          ...(startAfter ? { startAt: { values: startAfter.map(encodeFirestoreValue), before: false } } : {}),
        },
      }),
    });
    const results = (await response.json()) as Array<{
      document?: { name: string; fields?: JsonRecord };
    }>;
    const docs: DocumentSnapshotLike[] = results.flatMap((result): DocumentSnapshotLike[] => {
      if (!result.document) return [];
      const id = decodeURIComponent(result.document.name.split("/").at(-1) ?? "");
      const ref = new RestDocumentReference(this, `${path}/${id}`);
      return [
        new RestDocumentSnapshot(
          ref,
          decodeFirestoreFields(result.document.fields ?? {}),
        ),
      ];
    });
    return { docs } satisfies QuerySnapshotLike;
  }
}

class RestDocumentSnapshot implements DocumentSnapshotLike {
  readonly ref: DocumentReferenceLike;
  private readonly value: JsonRecord | undefined;

  constructor(
    ref: DocumentReferenceLike,
    value: JsonRecord | undefined,
  ) {
    this.ref = ref;
    this.value = value;
  }

  get exists() {
    return this.value !== undefined;
  }

  get id() {
    return this.ref.id;
  }

  data() {
    return this.value;
  }
}

class RestDocumentReference implements DocumentReferenceLike {
  readonly id: string;
  readonly path: string;
  private readonly client: FirestoreRestClient;

  constructor(
    client: FirestoreRestClient,
    path: string,
  ) {
    this.client = client;
    this.path = path;
    this.id = path.split("/").at(-1) ?? "";
  }

  collection(name: string) {
    return new RestCollectionReference(this.client, `${this.path}/${name}`);
  }

  listCollections() { return this.client.listCollections(this.path); }

  get(): Promise<DocumentSnapshotLike> {
    return this.client.getDocument(this.path, this);
  }

  set(data: unknown, options?: SetOptionsLike) {
    return this.client.setDocument(this.path, data, options);
  }

  create(data: unknown) {
    return this.client.createDocument(this.path, data);
  }

  delete() {
    return this.client.deleteDocument(this.path);
  }
}

class RestQuery implements QueryLike {
  readonly path: string;
  protected readonly client: FirestoreRestClient;
  private readonly constraints: QueryConstraint[];
  private readonly orders: QueryOrder[];
  private readonly resultLimit?: number;
  private readonly cursor?: unknown[];

  constructor(
    client: FirestoreRestClient,
    path: string,
    constraints: QueryConstraint[] = [],
    orders: QueryOrder[] = [],
    resultLimit?: number,
    cursor?: unknown[],
  ) {
    this.client = client;
    this.path = path;
    this.constraints = constraints;
    this.orders = orders;
    this.resultLimit = resultLimit;
    this.cursor = cursor;
  }

  where(fieldPath: string, operator: QueryOperator, value: unknown) {
    return new RestQuery(
      this.client,
      this.path,
      [...this.constraints, { fieldPath, operator, value }],
      this.orders,
      this.resultLimit,
      this.cursor,
    );
  }

  orderBy(fieldPath: string, direction: QueryDirection = "asc") {
    return new RestQuery(
      this.client,
      this.path,
      this.constraints,
      [...this.orders, { fieldPath, direction }],
      this.resultLimit,
      this.cursor,
    );
  }

  limit(count: number) {
    return new RestQuery(
      this.client,
      this.path,
      this.constraints,
      this.orders,
      Math.max(1, Math.min(Math.floor(count), 300)),
      this.cursor,
    );
  }

  startAfter(...values: unknown[]) {
    return new RestQuery(this.client, this.path, this.constraints, this.orders, this.resultLimit, values);
  }

  get(transaction?: string): Promise<QuerySnapshotLike> {
    if (!transaction && !this.constraints.length && !this.orders.length && !this.resultLimit) {
      return this.client.getCollection(this.path);
    }
    return this.client.runQuery(
      this.path,
      this.constraints,
      this.orders,
      this.resultLimit,
      transaction,
      this.cursor,
    );
  }
}

class RestCollectionReference extends RestQuery implements CollectionReferenceLike {
  constructor(client: FirestoreRestClient, path: string) {
    super(client, path);
  }

  doc(id: string) {
    return new RestDocumentReference(this.client, `${this.path}/${id}`);
  }

  listDocuments() { return this.client.listDocuments(this.path); }

}

class RestWriteBatch implements WriteBatchLike {
  protected readonly writes: JsonRecord[] = [];
  private committed = false;

  protected readonly client: FirestoreRestClient;
  protected readonly transaction?: string;
  constructor(client: FirestoreRestClient, transaction?: string) {
    this.client = client;
    this.transaction = transaction;
  }

  private append(ref: DocumentReferenceLike, write: JsonRecord) {
    if (this.committed) throw new Error("Firestore batch has already been committed.");
    if (!(ref instanceof RestDocumentReference)) throw new Error("Incompatible Firestore document reference.");
    this.writes.push(write);
  }

  set(ref: DocumentReferenceLike, data: unknown, options?: SetOptionsLike) {
    this.append(ref, this.client.setWrite(ref.path, data as JsonRecord, options));
    return this;
  }

  create(ref: DocumentReferenceLike, data: unknown) {
    this.append(ref, { ...this.client.setWrite(ref.path, data as JsonRecord), currentDocument: { exists: false } });
    return this;
  }

  delete(ref: DocumentReferenceLike) {
    this.append(ref, { delete: this.client.documentName(ref.path) });
    return this;
  }

  async commit() {
    if (this.committed) throw new Error("Firestore batch has already been committed.");
    this.committed = true;
    await this.client.commit(this.writes, this.transaction);
  }
}

class RestTransaction extends RestWriteBatch implements TransactionLike {
  get(ref: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  get(query: QueryLike | CollectionReferenceLike): Promise<QuerySnapshotLike>;
  get(value: DocumentReferenceLike | QueryLike | CollectionReferenceLike): Promise<DocumentSnapshotLike | QuerySnapshotLike> {
    if (this.writes.length) throw new Error("Firestore transactions require all reads before writes.");
    if (value instanceof RestDocumentReference) return this.client.getDocument(value.path, value, this.transaction);
    if (value instanceof RestQuery) return value.get(this.transaction);
    throw new Error("Incompatible Firestore transaction read.");
  }
}

function mergeFieldPaths(data: JsonRecord, prefix: string[] = []): string[] {
  return Object.entries(data).flatMap(([key, value]) => {
    if (value === undefined) return [];
    const parts = [...prefix, key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
      return mergeFieldPaths(value as JsonRecord, parts);
    }
    return [parts.map((part) => `\`${part.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``).join(".")];
  });
}

export function createEmulatorFirestoreRestClient(projectId: string, host: string, fetcher: typeof fetch = fetch) {
  return new FirestoreRestClient({ client_email: "", private_key: "" }, projectId, fetcher, host);
}

export function createFirestoreRestClient(rawCredentials: string, fallbackProjectId: string) {
  let credentials: ServiceAccountCredentials;
  try {
    credentials = JSON.parse(rawCredentials) as ServiceAccountCredentials;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required service account fields.");
  }
  return new FirestoreRestClient(
    credentials,
    credentials.project_id ?? fallbackProjectId,
  );
}
