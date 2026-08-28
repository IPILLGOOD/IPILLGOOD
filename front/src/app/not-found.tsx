"use client";

import { redirect } from "next/navigation";

// Redirect only when Next renders the fallback, not when preparing its RSC
// slot for valid pages. Client-component redirects also run during SSR.
export default function NotFound() {
  redirect("/404");
}
