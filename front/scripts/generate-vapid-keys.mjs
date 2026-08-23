import { randomBytes } from "node:crypto";

import { generateVapidKeys } from "@mmmike/web-push/vapid";

const { publicKey, privateKey } = await generateVapidKeys();
const cronSecret = randomBytes(32).toString("base64url");

console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
console.log("VAPID_SUBJECT=mailto:contact@example.com");
console.log("PUSH_CRON_SECRET=" + cronSecret);
