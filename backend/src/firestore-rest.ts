type JsonRecord = Record<string, unknown>;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

interface SetOptionsLike {
  merge?: boolean;
}

export type QueryOperator = "==" | "<" | "<=" | ">" | ">=";
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
  get(): Promise<DocumentSnapshotLike>;
  set(data: unknown, options?: SetOptionsLike): Promise<void>;
}

export interface CollectionReferenceLike {
  path: string;
  doc(id: string): DocumentReferenceLike;
  where(fieldPath: string, operator: QueryOperator, value: unknown): QueryLike;
  orderBy(fieldPath: string, direction?: QueryDirection): QueryLike;
  limit(count: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface QueryLike {
  where(fieldPath: string, operator: QueryOperator, value: unknown): QueryLike;
  orderBy(fieldPath: string, direction?: QueryDirection): QueryLike;
  limit(count: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface WriteBatchLike {
  set(ref: DocumentReferenceLike, data: unknown, options?: SetOptionsLike): WriteBatchLike;
  create(ref: DocumentReferenceLike, data: unknown): WriteBatchLike;
  delete(ref: DocumentReferenceLike): WriteBatchLike;
  commit(): Promise<void>;
}

export interface FirestoreLike {
  collection(path: string): CollectionReferenceLike;
  batch(): WriteBatchLike;
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

class FirestoreRestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Firestore REST request failed: HTTP ${status}`);
    this.name = "FirestoreRestError";
    this.status = status;
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
    "<": "LESS_THAN",
    "<=": "LESS_THAN_OR_EQUAL",
    ">": "GREATER_THAN",
    ">=": "GREATER_THAN_OR_EQUAL",
  }[operator];
}

class FirestoreRestClient implements FirestoreLike {
  private readonly baseUrl: string;
  private readonly credentials: ServiceAccountCredentials;
  private readonly fetcher: typeof fetch;
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    credentials: ServiceAccountCredentials,
    projectId: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.credentials = credentials;
    this.fetcher = fetcher;
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  }

  collection(path: string) {
    return new RestCollectionReference(this, path);
  }

  batch() {
    return new RestWriteBatch();
  }

  private async createAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = this.credentials.token_uri ?? "https://oauth2.googleapis.com/token";
    const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = textToBase64Url(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
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

  private async getAccessToken() {
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
      });
      if (response.status === 401 && attempt === 0) {
        this.accessToken = undefined;
        continue;
      }
      if (allowNotFound && response.status === 404) return response;
      if (!response.ok) {
        throw new FirestoreRestError(response.status);
      }
      return response;
    }
    throw new Error("Firestore REST authentication failed.");
  }

  private request(relativeUrl: string, init: RequestInit = {}, allowNotFound = false) {
    return this.requestUrl(`${this.baseUrl}/${relativeUrl}`, init, allowNotFound);
  }

  async getDocument(path: string, ref: DocumentReferenceLike) {
    const response = await this.request(encodedResourcePath(path), {}, true);
    if (response.status === 404) return new RestDocumentSnapshot(ref, undefined);
    const document = (await response.json()) as { fields?: JsonRecord };
    return new RestDocumentSnapshot(ref, decodeFirestoreFields(document.fields ?? {}));
  }

  async setDocument(path: string, data: unknown, options?: SetOptionsLike) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Firestore documents must be objects.");
    }
    let nextData = data as JsonRecord;
    if (options?.merge) {
      const ref = new RestDocumentReference(this, path);
      const current = await this.getDocument(path, ref);
      const currentData = current.data();
      nextData = {
        ...(currentData && typeof currentData === "object" ? currentData as JsonRecord : {}),
        ...nextData,
      };
    }
    await this.request(encodedResourcePath(path), {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFirestoreFields(nextData) }),
    });
  }

  async createDocument(path: string, data: unknown) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Firestore documents must be objects.");
    }
    await this.request(`${encodedResourcePath(path)}?currentDocument.exists=false`, {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFirestoreFields(data as JsonRecord) }),
    });
  }

  async deleteDocument(path: string) {
    await this.request(encodedResourcePath(path), { method: "DELETE" }, true);
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

  async runQuery(
    path: string,
    constraints: QueryConstraint[],
    orders: QueryOrder[],
    resultLimit?: number,
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

  constructor(
    client: FirestoreRestClient,
    path: string,
    constraints: QueryConstraint[] = [],
    orders: QueryOrder[] = [],
    resultLimit?: number,
  ) {
    this.client = client;
    this.path = path;
    this.constraints = constraints;
    this.orders = orders;
    this.resultLimit = resultLimit;
  }

  where(fieldPath: string, operator: QueryOperator, value: unknown) {
    return new RestQuery(
      this.client,
      this.path,
      [...this.constraints, { fieldPath, operator, value }],
      this.orders,
      this.resultLimit,
    );
  }

  orderBy(fieldPath: string, direction: QueryDirection = "asc") {
    return new RestQuery(
      this.client,
      this.path,
      this.constraints,
      [...this.orders, { fieldPath, direction }],
      this.resultLimit,
    );
  }

  limit(count: number) {
    return new RestQuery(
      this.client,
      this.path,
      this.constraints,
      this.orders,
      Math.max(1, Math.min(Math.floor(count), 300)),
    );
  }

  get(): Promise<QuerySnapshotLike> {
    if (!this.constraints.length && !this.orders.length && !this.resultLimit) {
      return this.client.getCollection(this.path);
    }
    return this.client.runQuery(
      this.path,
      this.constraints,
      this.orders,
      this.resultLimit,
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

}

class RestWriteBatch implements WriteBatchLike {
  private readonly operations: Array<() => Promise<void>> = [];

  set(ref: DocumentReferenceLike, data: unknown, options?: SetOptionsLike) {
    this.operations.push(() => ref.set(data, options));
    return this;
  }

  create(ref: DocumentReferenceLike, data: unknown) {
    this.operations.push(() => {
      if (!(ref instanceof RestDocumentReference)) {
        throw new Error("Firestore REST batch received an incompatible document reference.");
      }
      return ref.create(data);
    });
    return this;
  }

  delete(ref: DocumentReferenceLike) {
    this.operations.push(() => {
      if (!(ref instanceof RestDocumentReference)) {
        throw new Error("Firestore REST batch received an incompatible document reference.");
      }
      return ref.delete();
    });
    return this;
  }

  async commit() {
    for (const operation of this.operations) await operation();
  }
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
