// Single source of truth for the registration API and endpoint contract tests.
export const PUSH_ENDPOINT_HOSTS = [
  { host: "fcm.googleapis.com", subdomains: false, root: true },
  { host: "push.apple.com", subdomains: true, root: false },
  { host: "push.services.mozilla.com", subdomains: true, root: false },
  // Microsoft documents variable WNS subdomains; validate the DNS label boundary.
  { host: "notify.windows.com", subdomains: true, root: true },
] as const;

export function isAllowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const hostname = url.hostname.toLowerCase();
    return PUSH_ENDPOINT_HOSTS.some(({ host, subdomains, root }) =>
      (root && hostname === host) || (subdomains && hostname.endsWith(`.${host}`)),
    );
  } catch {
    return false;
  }
}
