"use client";

import { createContext } from "react";
import type { ActionState } from "@care-atlas/backend";

// Only the public sample workspace provides this callback. Production keeps its server action.
export const PreviewDoseAction = createContext<null | ((state: ActionState, data: FormData) => Promise<ActionState>)>(null);
