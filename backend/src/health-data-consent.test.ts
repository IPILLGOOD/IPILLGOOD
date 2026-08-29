import assert from "node:assert/strict";
import test from "node:test";

import { MemoryFirestore } from "../test-support/memory-firestore.ts";
import {
  HealthDataConsentRequiredError,
  assertHealthDataConsentConfirmed,
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
