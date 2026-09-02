import { fetchOfficialPillPage, type OfficialPillItem } from "../src/official-pill-catalog.ts";
import {
  loadRegisteredPillPhotoEvaluationFixture,
  parsePillPhotoEvaluationFixtureKey,
} from "../test-support/pill-photo-evaluation-registry.ts";
import { loadFrozenPillPhotoFixture } from "../test-support/pill-photo-fixture.ts";
import {
  auditPillPhotoOfficialLabels,
  type ExpectedPillPhotoProduct,
} from "../test-support/pill-photo-label-audit.ts";

const args = process.argv.slice(2);
const flags = new Map<string, string>();
for (let index = 0; index < args.length; index++) {
  const flag = args[index]!;
  if (!["--live", "--fixture"].includes(flag) || flags.has(flag)) {
    throw new Error("usage: pill-photo-label-audit [--fixture v2|v3] [--live]");
  }
  if (flag === "--live") { flags.set(flag, "true"); continue; }
  const value = args[++index];
  if (!value || value.startsWith("--")) throw new Error("usage: pill-photo-label-audit [--fixture v2|v3] [--live]");
  flags.set(flag, value);
}
const live = flags.has("--live");
const fixture = parsePillPhotoEvaluationFixtureKey(flags.get("--fixture"));
const { manifest } = await loadRegisteredPillPhotoEvaluationFixture(fixture);
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

const auditProducts = manifest.products.map((product): ExpectedPillPhotoProduct => ({
  receipt: "sourceGroup" in product ? product.sourceGroup : product.receipt,
  expectedItemSeq: product.expectedItemSeq,
  mappingEvidenceUrl: product.mappingEvidenceUrl,
  expectedOfficialRecordSha256: product.expectedOfficialRecordSha256,
  expectedObservation: product.expectedObservation,
}));
const audit = auditPillPhotoOfficialLabels(auditProducts, officialItems);
console.log(JSON.stringify({
  mode: live ? "live_mfds_item_seq_lookup" : "fixed_catalog",
  evaluationFixtureVersion: manifest.fixtureVersion,
  catalogVersion,
  requests,
  ...audit,
}, null, 2));
if (!audit.ok) process.exitCode = 1;
