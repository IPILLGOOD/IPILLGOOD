const LOOPBACK_EMULATOR_HOST = /^(?:127\.0\.0\.1|localhost):(\d{1,5})$/;

function assertDemoProject(projectId: string) {
  if (!projectId.startsWith("demo-")) {
    throw new Error("Firebase emulators require a demo- project ID.");
  }
}

export function firebaseEmulatorOrigin(projectId: string, host: string | undefined) {
  if (!host) return undefined;
  assertDemoProject(projectId);
  const match = LOOPBACK_EMULATOR_HOST.exec(host);
  const port = Number(match?.[1]);
  if (!match || port < 1 || port > 65_535) {
    throw new Error("Firebase emulators require a loopback host and valid port.");
  }
  return `http://${host}`;
}

export function localFirebaseAuthEmulator(input: {
  authHost?: string;
  firestoreHost?: string;
  nodeEnv?: string;
  projectId: string;
}) {
  if (!input.authHost || input.nodeEnv === "production") return undefined;
  const authOrigin = firebaseEmulatorOrigin(input.projectId, input.authHost);
  if (!input.firestoreHost) {
    throw new Error("Local Google login requires FIRESTORE_EMULATOR_HOST.");
  }
  firebaseEmulatorOrigin(input.projectId, input.firestoreHost);
  return { authOrigin, projectId: input.projectId };
}
