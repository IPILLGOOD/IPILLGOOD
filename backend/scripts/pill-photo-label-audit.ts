import { fetchOfficialPillPage, type OfficialPillItem } from "../src/official-pill-catalog.ts";
import { loadPillPhotoEvaluationFixture } from "../test-support/pill-photo-evaluation.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import { auditPillPhotoOfficialLabels } from "../test-support/pill-photo-label-audit.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--live") || args.filter((arg) => arg === "--live").length > 1) {
  throw new Error("usage: pill-photo-label-audit [--live]");
}
const live = args.includes("--live");
const { manifest } = await loadPillPhotoEvaluationFixture();
let officialItems: OfficialPillItem[];
let catalogVersion: string | null = null;
let requests = 0;

if (live) {
  officialItems = [];
  for (const product of manifest.products) {
    requests++;
    const response = await fetchOfficialPillPage({ itemSeq: product.expectedItemSeq, pageNo: 1, numOfRows: 100 });
    if (response.status !== "connected" || response.totalCount !== response.items.length) {
      throw new Error(`official_label_audit_query_failed:${product.expectedItemSeq}:${response.status}`);
    }
    officialItems.push(...response.items);
  }
} else {
  const frozen = await loadFrozenPillPhotoFixture();
  officialItems = frozen.snapshot.items;
  catalogVersion = frozen.snapshot.version;
}

const audit = auditPillPhotoOfficialLabels(manifest.products, officialItems);
console.log(JSON.stringify({
  mode: live ? "live_mfds_item_seq_lookup" : "fixed_catalog",
  evaluationFixtureVersion: manifest.fixtureVersion,
  catalogVersion,
  requests,
  ...audit,
}, null, 2));
if (!audit.ok) process.exitCode = 1;
