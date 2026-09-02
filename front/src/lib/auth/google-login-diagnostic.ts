type GoogleLoginFailure = {
  clientCode: "firebase_local_emulator_unavailable" | "firebase_server_permission" | "google_login_failed";
  logMessage?: string;
  status: 401 | 503;
};

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function googleLoginFailure(error: unknown, environment: { authEmulatorHost?: string; nodeEnv?: string }): GoogleLoginFailure {
  const message = errorText(error);
  if (
    environment.nodeEnv !== "production" &&
    environment.authEmulatorHost &&
    /ECONNREFUSED|fetch failed|emulator verification is unavailable/i.test(message)
  ) {
    return {
      clientCode: "firebase_local_emulator_unavailable",
      logMessage: "로컬 Firebase Emulator에 연결하지 못했습니다. 루트에서 `npm run dev:local`을 실행하고 Auth·Firestore 포트를 확인하세요.",
      status: 503,
    };
  }
  if (
    /PERMISSION_DENIED|UNAUTHENTICATED|AUTH_CREDENTIALS_MISSING|Could not load the default credentials|FIREBASE_ACCOUNT_[A-Z_]+_FAILED/i.test(message)
  ) {
    return {
      clientCode: "firebase_server_permission",
      logMessage: "Firebase 서버 자격 증명 또는 IAM 권한이 부족합니다. 브라우저 로그인 계정이 아니라 ADC 실행 계정에 Firestore·Firebase Auth 최소 권한을 부여하거나 `npm run dev:local`을 사용하세요.",
      status: 503,
    };
  }
  return {
    clientCode: "google_login_failed",
    status: 401,
  };
}
