/** PWA foreground/BFCache restoration does not necessarily remount React. */
export function observePushReentry(
  refresh: () => void,
  page: EventTarget & { visibilityState: string },
  browser: EventTarget,
  displayMode: EventTarget,
) {
  const check = () => { if (page.visibilityState === "visible") refresh(); };
  page.addEventListener("visibilitychange", check);
  for (const event of ["pageshow", "focus", "online"]) browser.addEventListener(event, check);
  displayMode.addEventListener("change", check);
  check();
  return () => {
    page.removeEventListener("visibilitychange", check);
    for (const event of ["pageshow", "focus", "online"]) browser.removeEventListener(event, check);
    displayMode.removeEventListener("change", check);
  };
}
