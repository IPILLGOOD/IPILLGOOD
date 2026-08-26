import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginRequest } from "../src/lib/request-origin.ts";

test("명시적 동일 출처와 Origin이 없는 서버 요청은 허용한다", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("https://care.example/api", {
        headers: { origin: "https://care.example" },
      }),
    ),
    true,
  );
  assert.equal(isSameOriginRequest(new Request("https://care.example/api")), true);
});

test("opaque Origin은 브라우저가 동일 출처로 표시한 경우에만 허용한다", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("https://care.example/api", {
        headers: { origin: "null", "sec-fetch-site": "same-origin" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      new Request("https://care.example/api", {
        headers: { origin: "null", "sec-fetch-site": "cross-site" },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginRequest(
      new Request("https://care.example/api", {
        headers: { origin: "null" },
      }),
    ),
    false,
  );
});

test("외부 출처는 Fetch Metadata와 관계없이 거부한다", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("https://care.example/api", {
        headers: { origin: "https://attacker.example", "sec-fetch-site": "same-origin" },
      }),
    ),
    false,
  );
});
