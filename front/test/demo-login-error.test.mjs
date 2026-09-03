import assert from "node:assert/strict";
import test from "node:test";

import { getDemoLoginErrorMessage } from "../src/lib/auth/demo-login-error.ts";

test("로컬 데모 설정 누락은 환경 변수와 재시작 방법을 안내한다", () => {
  assert.equal(
    getDemoLoginErrorMessage("demo_login_unavailable", "local_demo_mode_disabled"),
    "로컬 데모가 꺼져 있어요. front/.env.local에 IPILLGOOD_DEMO_MODE=true를 추가하고 개발 서버를 다시 시작해주세요.",
  );
});

test("운영 비활성화와 예상하지 못한 실패는 설정 정보를 노출하지 않는다", () => {
  assert.equal(
    getDemoLoginErrorMessage("demo_login_unavailable"),
    "데모를 준비하지 못했어요. 잠시 후 다시 시도해주세요.",
  );
  assert.equal(
    getDemoLoginErrorMessage("unexpected"),
    "데모를 준비하지 못했어요. 잠시 후 다시 시도해주세요.",
  );
});
