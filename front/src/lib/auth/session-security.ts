const MIN_SESSION_SECRET_BYTES = 32;
const MIN_ESTIMATED_ENTROPY_BITS = 128;

const FORBIDDEN_SESSION_SECRETS = new Set([
  "care-atlas-local-demo-session-secret-change-before-deploying",
  "change-me",
  "changeme",
]);

type SessionSecurityEnvironment = {
  nodeEnv?: string;
  sessionSecret?: string;
};

type DemoLoginEnvironment = {
  allowedHosts?: string;
  demoMode?: string;
  hostname: string;
  nodeEnv?: string;
  publicDemoMode?: string;
};

function estimatedShannonEntropyBits(value: string) {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let bitsPerCharacter = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    bitsPerCharacter -= probability * Math.log2(probability);
  }
  return bitsPerCharacter * value.length;
}

export function sessionSecretBytes(environment: SessionSecurityEnvironment) {
  const configured = environment.sessionSecret?.trim();
  if (!configured) {
    throw new Error("SESSION_SECRET 환경 변수가 설정되지 않았습니다.");
  }

  if (FORBIDDEN_SESSION_SECRETS.has(configured.toLowerCase())) {
    throw new Error("SESSION_SECRET에 알려진 예시 또는 fallback 값을 사용할 수 없습니다.");
  }

  const encoded = new TextEncoder().encode(configured);
  if (encoded.byteLength < MIN_SESSION_SECRET_BYTES) {
    throw new Error(`SESSION_SECRET은 최소 ${MIN_SESSION_SECRET_BYTES}바이트여야 합니다.`);
  }

  if (estimatedShannonEntropyBits(configured) < MIN_ESTIMATED_ENTROPY_BITS) {
    throw new Error("SESSION_SECRET의 엔트로피가 부족합니다. 무작위로 생성한 값을 사용하세요.");
  }

  return encoded;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function allowedPublicDemoHostname(hostname: string, allowedHosts: string | undefined) {
  const normalized = hostname.toLowerCase();
  return Boolean(
    allowedHosts
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .includes(normalized),
  );
}

export function isDemoLoginAllowed(environment: DemoLoginEnvironment) {
  if (environment.demoMode !== "true") return false;
  if (environment.nodeEnv !== "production") {
    return isLoopbackHostname(environment.hostname);
  }
  return (
    environment.publicDemoMode === "isolated" &&
    allowedPublicDemoHostname(environment.hostname, environment.allowedHosts)
  );
}
