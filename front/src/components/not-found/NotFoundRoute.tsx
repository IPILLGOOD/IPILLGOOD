"use client";

import { redirect, usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NotFoundRoute({ children }: { children: ReactNode }) {
  // OpenNext renders the root fallback for /404 instead of app/404/page.tsx.
  // Render that canonical request; redirect only other missing paths. Keeping
  // this check in a client boundary avoids redirects while Next prepares the
  // fallback's RSC slot for valid pages, and still redirects during SSR.
  if (usePathname() !== "/404") redirect("/404");
  return children;
}
