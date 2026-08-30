import assert from "node:assert/strict";
import test from "node:test";

import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import {
  CareProfileRequiredError,
  HealthDataConsentRequiredError,
  assertCareProfileComplete,
  assertHealthDataConsentConfirmed,
  isCareProfileComplete,
  isCareProfileRecordComplete,
  isHealthDataConsentConfirmed,
} from "./health-data-consent.ts";

test("동의가 없거나 철회된 계정은 건강정보 처리를 허용하지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const recipientId = "google-consent-guard";
  const recipient = firestore.collection("careRecipients").doc(recipientId);

  assert.equal(await isHealthDataConsentConfirmed(firestore, recipientId), false);
  await recipient.set({ consentConfirmed: false });
  assert.equal(await isHealthDataConsentConfirmed(firestore, recipientId), false);
  await assert.rejects(
    assertHealthDataConsentConfirmed(firestore, recipientId),
    HealthDataConsentRequiredError,
  );

  await recipient.set({ consentConfirmed: true });
  assert.equal(await isHealthDataConsentConfirmed(firestore, recipientId), true);
  await assertHealthDataConsentConfirmed(firestore, recipientId);
});

test("신규 기본값이나 동의만으로 온보딩 완료를 추정하지 않는다", async () => {
  const firestore = new MemoryFirestore();
  const recipientId = "google-profile-guard";
  const recipient = firestore.collection("careRecipients").doc(recipientId);

  assert.equal(isCareProfileRecordComplete(null), false);
  assert.equal(isCareProfileRecordComplete({ displayName: "돌봄 대상자", ageBand: "67", consentConfirmed: true }), false);
  assert.equal(isCareProfileRecordComplete({ displayName: "실제 입력", ageBand: "0", consentConfirmed: true }), false);
  assert.equal(isCareProfileRecordComplete({ displayName: "실제 입력", ageBand: "121", consentConfirmed: true }), false);

  await recipient.set({ displayName: "", ageBand: "", consentConfirmed: false });
  assert.equal(await isCareProfileComplete(firestore, recipientId), false);
  await assert.rejects(assertCareProfileComplete(firestore, recipientId), CareProfileRequiredError);

  await recipient.set({ displayName: "사용자 입력", ageBand: "75", consentConfirmed: true }, { merge: true });
  assert.equal(await isCareProfileComplete(firestore, recipientId), true);
  await assertCareProfileComplete(firestore, recipientId);
});
