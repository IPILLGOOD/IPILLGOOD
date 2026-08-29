import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_CONNECTION_ACTIVITY_INTERVAL_MS,
  CARE_SYNC_POLL_INTERVAL_MS,
  careSyncFailureDelay,
  retryAfterMilliseconds,
  shouldPollCareRevision,
} from "../src/lib/care-sync.ts";

test("공동 화면은 5초마다 확인하고 연결 활동은 15분마다 갱신한다", () => {
  assert.equal(CARE_SYNC_POLL_INTERVAL_MS, 5_000);
  assert.equal(CARE_CONNECTION_ACTIVITY_INTERVAL_MS, 15 * 60_000);
});

test("숨긴 탭·오프라인·진행 중 요청·backoff 동안 revision 조회를 멈춘다", () => {
  const ready = { visible: true, online: true, inFlight: false, retryAt: 0, now: 1_000 };
  assert.equal(shouldPollCareRevision(ready), true);
  assert.equal(shouldPollCareRevision({ ...ready, visible: false }), false);
  assert.equal(shouldPollCareRevision({ ...ready, online: false }), false);
  assert.equal(shouldPollCareRevision({ ...ready, inFlight: true }), false);
  assert.equal(shouldPollCareRevision({ ...ready, retryAt: 1_001 }), false);
});

test("429와 일시 오류는 제한된 backoff를 사용한다", () => {
  assert.equal(retryAfterMilliseconds("12"), 12_000);
  assert.equal(retryAfterMilliseconds(null), 5_000);
  assert.equal(careSyncFailureDelay(1), 2_000);
  assert.equal(careSyncFailureDelay(20), 60_000);
});
