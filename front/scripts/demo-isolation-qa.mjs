import { pathToFileURL } from "node:url";

import {
  DEMO_SESSION_CLEANUP_GRACE_SECONDS,
  deleteEphemeralDemoSession,
} from "../../backend/src/demo-session.ts";
import { getAdminFirestore } from "../../backend/src/firebase-admin.ts";

const playwrightEntry = process.env.IPILLGOOD_PLAYWRIGHT;
if (!playwrightEntry) throw new Error("IPILLGOOD_PLAYWRIGHT is required");
const baseUrl = process.env.IPILLGOOD_BASE_URL ?? "http://127.0.0.1:3000";
const playwright = await import(pathToFileURL(playwrightEntry).href);
const chromium = playwright.chromium ?? playwright.default?.chromium;
if (!chromium) throw new Error("Chromium was not available from IPILLGOOD_PLAYWRIGHT");
const firestore = await getAdminFirestore();
const sessionIds = [];

const nestedCollections = [
  "medicationPlans",
  "doseEvents",
  "symptomEvents",
  "clinicalDocuments",
  "clinicianQuestions",
  "dailyCheckIns",
  "questionResponses",
  "questionSets",
  "careAnalyses",
  "agentRuns",
];
const recipientScopedCollections = [
  "pushSubscriptions",
  "medicationReminderSchedules",
  "pushDeliveries",
];

function sessionIdFromCookie(cookie) {
  const encodedPayload = cookie.value.split(".")[1];
  if (!encodedPayload) throw new Error("Demo session cookie was not a JWT");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (
    payload.provider !== "demo" ||
    typeof payload.sub !== "string" ||
    !/^demo-[0-9a-f-]{36}$/.test(payload.sub)
  ) {
    throw new Error("Demo session cookie did not contain an isolated session id");
  }
  return payload.sub;
}

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /데모로 둘러보기/ }).click();
  await page.waitForURL("**/today");
  const cookie = (await context.cookies()).find(
    (candidate) => candidate.name === "care_atlas_session",
  );
  if (!cookie) throw new Error("Demo login did not set a session cookie");
  const id = sessionIdFromCookie(cookie);
  sessionIds.push(id);
  return { page, cookie, id };
}

async function storedDemoData(id) {
  const recipientRef = firestore.collection("careRecipients").doc(id);
  const [session, recipient, readModel, nested, scoped] = await Promise.all([
    firestore.collection("demoSessions").doc(id).get(),
    recipientRef.get(),
    firestore.collection("careReadModels").doc(id).get(),
    Promise.all(nestedCollections.map((name) => recipientRef.collection(name).get())),
    Promise.all(
      recipientScopedCollections.map((name) =>
        firestore.collection(name).where("recipientId", "==", id).get(),
      ),
    ),
  ]);
  return {
    session: session.exists ? session.data() : null,
    recipient: recipient.exists,
    readModel: readModel.exists,
    nestedDocuments: nested.reduce((sum, snapshot) => sum + snapshot.docs.length, 0),
    scopedDocuments: scoped.reduce((sum, snapshot) => sum + snapshot.docs.length, 0),
  };
}

async function logoutAndVerifyRevocation(session) {
  await session.page.getByRole("button", { name: "로그아웃" }).click();
  await session.page.waitForURL(`${baseUrl}/`);
  const afterLogout = await storedDemoData(session.id);
  if (
    afterLogout.recipient ||
    afterLogout.readModel ||
    afterLogout.nestedDocuments !== 0 ||
    afterLogout.scopedDocuments !== 0 ||
    afterLogout.session?.status !== "deleting"
  ) {
    throw new Error(`Logout cleanup was incomplete for ${session.id}`);
  }

  await session.page.context().addCookies([session.cookie]);
  await session.page.goto(`${baseUrl}/today`, { waitUntil: "networkidle" });
  if (!session.page.url().includes("/login")) {
    throw new Error("A logged-out demo JWT remained usable");
  }

  await deleteEphemeralDemoSession({
    id: session.id,
    now: new Date(Date.now() + DEMO_SESSION_CLEANUP_GRACE_SECONDS * 1_000),
  });
  const finalized = await storedDemoData(session.id);
  if (
    finalized.session ||
    finalized.recipient ||
    finalized.readModel ||
    finalized.nestedDocuments !== 0 ||
    finalized.scopedDocuments !== 0
  ) {
    throw new Error(`Final demo cleanup was incomplete for ${session.id}`);
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.IPILLGOOD_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

try {
  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const first = await login(firstContext);
  const second = await login(secondContext);
  if (first.id === second.id) throw new Error("Two demo logins received the same session id");

  await first.page.goto(`${baseUrl}/documents`, { waitUntil: "networkidle" });
  await first.page.getByRole("button", { name: "비식별 샘플 처방전으로 체험" }).click();
  await first.page.getByText("비식별 데모 분석을 마쳤어요.").waitFor();
  await first.page
    .getByText("비식별_샘플_처방전.jpg", { exact: true })
    .first()
    .waitFor();

  await second.page.goto(`${baseUrl}/documents`, { waitUntil: "networkidle" });
  if (
    await second.page
      .getByText("비식별_샘플_처방전.jpg", { exact: true })
      .count()
  ) {
    throw new Error("The second demo session could see the first session's document");
  }
  await first.page.reload({ waitUntil: "networkidle" });
  if (
    !(await first.page
      .getByText("비식별_샘플_처방전.jpg", { exact: true })
      .count())
  ) {
    throw new Error("The first demo session lost its own stored document");
  }

  await logoutAndVerifyRevocation(first);
  await logoutAndVerifyRevocation(second);
  await firstContext.close();
  await secondContext.close();
  console.log(
    JSON.stringify({
      passed: true,
      differentSessionIds: true,
      crossSessionDocumentVisible: false,
      logoutRevokedSession: true,
      storedDemoDataAfterFinalCleanup: 0,
    }),
  );
} finally {
  await browser.close();
  for (const id of sessionIds) {
    try {
      await deleteEphemeralDemoSession({ id, force: true });
    } catch (error) {
      console.error(`Emergency QA cleanup failed for ${id}`, error);
    }
  }
}
