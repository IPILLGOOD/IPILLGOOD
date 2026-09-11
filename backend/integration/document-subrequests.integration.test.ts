import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { emulatorFixture } from "../test-support/emulator.ts";
import { seedCareAccount } from "../test-support/care-fixtures.ts";
import { createEmulatorFirestoreRestClient } from "../src/firestore-rest.ts";
import { analyzeMedicationDocument } from "../src/ai/medication-analyzer.ts";
import { medicationPlansFromPrescription } from "../src/care-repository.ts";
import { requestDocumentAnalysisJobCancellation } from "../src/document-analysis-jobs.ts";

// Run the actual Next POST handler and real REST adapter against the emulator.
// Only browser identity/rate limiting and the external AI result are substituted.
// Session deletion, consent, leases, jobs, duplicate review and storage stay real.
test("document POST stays inside the free Worker subrequest budget", { timeout: 120_000 }, async t => {
  const fixture = emulatorFixture("admin");
  t.after(() => fixture.cleanup());
  const root = resolve(import.meta.dirname, "../..");
  const temp = resolve(root, "verification-artifacts", `document-route-${randomUUID()}.mjs`);
  await mkdir(resolve(root, "verification-artifacts"), { recursive: true });
  t.after(() => rm(temp, { force: true }));
  const stateKey = `__documentRouteTest_${randomUUID().replaceAll("-", "")}`;
  const state = `globalThis[${JSON.stringify(stateKey)}]`;
  await build({
    entryPoints: [resolve(root, "front/src/app/api/documents/analyze/route.ts")],
    outfile: temp, bundle: true, format: "esm", platform: "node", target: "node24",
    external: ["sharp", "@google-cloud/firestore", "pdf-lib", "fast-xml-parser", "zod", "openai", "@mmmike/web-push"],
    plugins: [{ name: "isolated-document-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: args.path, namespace: "test-boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "test-boundary" }, args => {
        if (args.path.endsWith("auth/session")) return { contents: `
          import { getAccountSessionState } from ${JSON.stringify(resolve(root, "backend/src/account-lifecycle.ts"))};
          export async function getSession() {
            const current = ${state};
            if (!(await getAccountSessionState(current.user.id, current.firestore)).active) return null;
            return current.user;
          }`, loader: "ts", resolveDir: root };
        if (args.path.endsWith("auth/care-scope")) return { contents: `export function careScopeFor() { return ${state}.scope; }`, loader: "ts" };
        if (args.path.endsWith("rate-limit")) return { contents: "export async function enforceRateLimit() { return { allowed: true }; }", loader: "ts" };
        if (args.path.endsWith("rate-limit-core")) return { contents: "export function rateLimitResponse() { throw Error('Unexpected rate limit'); }", loader: "ts" };
        throw new Error(`Unconfigured test boundary: ${args.path}`);
      });
      builder.onLoad({ filter: /backend\/src\/firebase-admin\.ts$/ }, () => ({ contents: `export async function getAdminFirestore() { return ${state}.firestore; }`, loader: "ts" }));
      builder.onLoad({ filter: /backend\/src\/ai\/medication-analyzer\.ts$/ }, async args => ({
        contents: (await readFile(args.path, "utf8")).replace("export async function analyzeMedicationDocument(", "async function originalAnalyzeMedicationDocument(") +
          `\nexport async function analyzeMedicationDocument() { ${state}.aiCalls++; await ${state}.duringAnalysis?.(); return ${state}.analysis; }`,
        loader: "ts", resolveDir: resolve(root, "backend/src/ai"),
      }));
    } }],
  });
  const { POST } = await import(pathToFileURL(temp).href);
  let calls = 0;
  const requests: string[] = [];
  const firestore = createEmulatorFirestoreRestClient(process.env.FIREBASE_PROJECT_ID!, process.env.FIRESTORE_EMULATOR_HOST!, async (url, options) => {
    calls++;
    const path = new URL(String(url)).pathname;
    requests.push(path.includes(":") ? path.split(":").at(-1)! : "get");
    return fetch(url, options);
  });
  const analysis = await analyzeMedicationDocument({ documentType: "처방전", fileName: "synthetic.pdf", contentType: "application/pdf" }, {
    analyzeClinicalDocumentWithOpenAI: async () => { throw new Error("Unexpected AI request"); },
    verifyOfficialMedicationCode: async () => ({ status: "unavailable", sourceUrl: "https://example.test/official-medications" }),
  });
  for (const medication of analysis.analysis.medications ?? []) {
    medication.reviewStatus = "verified";
    medication.startDate = "2026-09-12";
    medication.endDate = "2026-09-19";
  }
  const scope = { ...fixture.scope, firestore };
  const current = { firestore, scope, user: { id: scope.recipientId.slice(7), name: "합성 검증", provider: "google" }, analysis, aiCalls: 0, duringAnalysis: undefined as (() => Promise<void>) | undefined };
  Object.assign(globalThis, { [stateKey]: current });
  t.after(() => { delete (globalThis as unknown as Record<string, unknown>)[stateKey]; });
  await seedCareAccount(fixture.firestore, scope.recipientId, { consent: true });
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Synthetic verification document. No patient data.");
  let bytes = await pdf.save();
  async function request(id: string, duplicateAction?: string, expectedStatus = 200) {
    calls = 0; requests.length = 0;
    const form = new FormData();
    form.set("documentType", "처방전");
    form.set("document", new File([bytes], "synthetic.pdf", { type: "application/pdf" }));
    form.set("idempotencyKey", id);
    form.set("jobId", `${id}-${duplicateAction ?? "initial"}`);
    if (duplicateAction) form.set("duplicateAction", duplicateAction);
    const response = await POST(new Request("http://localhost/api/documents/analyze", { method: "POST", body: form }));
    const body = await response.json();
    t.diagnostic(JSON.stringify({ stage: id, status: response.status, firestoreCalls: calls, byMethod: Object.fromEntries([...new Set(requests)].map(method => [method, requests.filter(value => value === method).length])) }));
    assert.equal(response.status, expectedStatus, body.message);
    // Reserve ten more requests for OAuth, rate binding and AI/official lookups.
    assert(calls <= 40, `Document handling needed ${calls} Firestore calls (budget 40)`);
    return body;
  }
  const created = await request("budget-create-001");
  assert.equal(created.job.state, "completed");
  assert.equal(created.draft.candidates.length, 3);
  const replay = await request("budget-create-001");
  assert.equal(replay.job.state, "completed");
  assert.equal(current.aiCalls, 1);
  pdf.addPage().drawText("Second synthetic import with overlapping medication schedules.");
  bytes = await pdf.save();
  const medications = medicationPlansFromPrescription({ id: "existing-synthetic", documentType: "처방전", uploadedAt: new Date().toISOString(), analysis: analysis.analysis });
  assert.equal(medications.length, 3);
  await seedCareAccount(fixture.firestore, scope.recipientId, { consent: true, medications });
  const duplicates = await request("budget-duplicate-001", undefined, 409);
  assert.equal(duplicates.duplicateResolutionRequired, true);
  const resolved = await request("budget-duplicate-001", "separate");
  assert.equal(resolved.job.state, "completed");
  assert.equal(resolved.draft.candidates.length, 3);
  assert.equal(current.aiCalls, 2, "resolving a duplicate reuses its analysis");
  pdf.addPage().drawText("Cancellation while the provider is working.");
  bytes = await pdf.save();
  const documents = fixture.admin.collection(`careRecipients/${scope.recipientId}/clinicalDocuments`);
  const beforeCancel = (await documents.get()).size;
  current.duringAnalysis = async () => {
    await requestDocumentAnalysisJobCancellation(fixture.scope, "budget-cancel-001-initial");
  };
  const cancelled = await request("budget-cancel-001", undefined, 409);
  assert.equal(cancelled.cancelled, true);
  assert.equal((await documents.get()).size, beforeCancel, "late analysis must not register after cancellation");
});
