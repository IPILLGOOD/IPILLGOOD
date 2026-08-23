const FALLBACK_MESSAGE = "Google 로그인을 완료하지 못했어요. 다시 시도해주세요.";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/popup-closed-by-user": "Google 로그인 창이 닫혔어요. 다시 시도해주세요.",
  "auth/cancelled-popup-request": "이미 Google 로그인 창이 열려 있어요.",
  "auth/popup-blocked": "팝업이 차단됐어요. 브라우저에서 팝업을 허용해주세요.",
  "auth/popup-timeout": "Google 로그인 응답이 늦어지고 있어요. 다시 시도해주세요.",
  "auth/redirect-timeout": "Google 로그인 결과를 확인하지 못했어요. 다시 시도해주세요.",
  "auth/redirect-result-missing":
    "Google 로그인 결과가 앱으로 돌아오지 않았어요. 다시 시도해주세요.",
  "auth/network-request-failed": "네트워크 연결을 확인하고 다시 시도해주세요.",
  "auth/unauthorized-domain": "현재 접속 주소가 Google 로그인에 등록되지 않았어요.",
  "auth/operation-not-allowed": "Google 로그인이 아직 활성화되지 않았어요.",
  "auth/configuration-not-found":
    "Google 로그인 설정이 완료되지 않았어요. 관리자에게 알려주세요.",
  "auth/invalid-api-key": "Google 로그인 앱 설정이 올바르지 않아요. 관리자에게 알려주세요.",
  "server/google_login_failed":
    "Google 계정은 확인했지만 로그인 세션을 만들지 못했어요. 잠시 후 다시 시도해주세요.",
  "server/session_timeout":
    "로그인 세션 생성이 늦어지고 있어요. 네트워크를 확인하고 다시 시도해주세요.",
};

export function getGoogleAuthErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return AUTH_ERROR_MESSAGES[String(error.code)] ?? FALLBACK_MESSAGE;
  }

  return FALLBACK_MESSAGE;
}

export function googleAuthServerError(code: string) {
  return Object.assign(new Error(code), { code: `server/${code}` });
}
