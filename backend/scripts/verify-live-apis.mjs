import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import { runCareAgent } from "../src/ai/care-agent.ts";
import { analyzeMedicationDocument } from "../src/ai/medication-analyzer.ts";
import { searchPharmacogenomicInfo } from "../src/official-medication-api.ts";

function requireSecret(name) {
  if (!process.env[name]) throw new Error(`${name} is required for live verification.`);
}

async function createDocumentImage(filePath, lines) {
  const lineElements = lines
    .map(
      (line, index) =>
        `<text x="80" y="${130 + index * 72}" font-size="34" fill="#17211b">${line}</text>`,
    )
    .join("");
  const svg = `<svg width="1400" height="1000" xmlns="http://www.w3.org/2000/svg">
    <rect width="1400" height="1000" fill="#fff"/>
    <rect x="30" y="30" width="1340" height="940" fill="none" stroke="#42584b" stroke-width="3"/>
    <g font-family="Arial, Apple SD Gothic Neo, sans-serif">${lineElements}</g>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

function careSnapshot() {
  return {
    recipient: {
      id: "live-test-recipient",
      displayName: "비식별 테스트",
      ageBand: "70대",
      allergies: [],
      conditions: ["고혈압"],
      mobilityNote: "",
      accessibilityPreferences: [],
      caregiverNote: "",
      consentConfirmed: true,
      lastConfirmedAt: "2026-08-16T08:00:00+09:00",
    },
    medications: [
      {
        id: "live-med-amlodipine",
        productName: "노바스크정 5mg",
        ingredientName: "암로디핀",
        purposePlain: "",
        descriptionPlain: "",
        doseAmount: "1정",
        frequency: "하루 1회",
        timing: "아침 식후",
        startDate: "2026-08-12",
        status: "active",
        isNew: true,
        sourceLabel: "비식별 테스트",
        watchFor: [],
      },
    ],
    doseEvents: [
      {
        id: "live-dose-1",
        medicationPlanId: "live-med-amlodipine",
        scheduledAt: "2026-08-15T08:00:00+09:00",
        response: "unconfirmed",
        answeredBy: "caregiver",
      },
    ],
    symptomEvents: [
      {
        id: "live-symptom-1",
        symptomType: "어지러움",
        occurredAt: "2026-08-15T11:00:00+09:00",
        severity: 3,
        dailyLifeImpact: "10분 쉬었어요.",
        reporterType: "caregiver_observed",
      },
    ],
    documents: [],
    clinicianQuestions: [],
    dataSource: "local-fallback",
    revision: 0,
  };
}

requireSecret("OPENAI_API_KEY");
requireSecret("MFDS_PARMGEN_API_KEY");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "care-atlas-live-"));

try {
  const prescriptionPath = join(temporaryDirectory, "prescription.png");
  const diagnosisPath = join(temporaryDirectory, "diagnosis.png");
  await Promise.all([
    createDocumentImage(prescriptionPath, [
      "처방전 (비식별 API 테스트)",
      "처방일: 2026-08-16",
      "노바스크정 5mg | 1정 | 하루 1회 | 아침 식후 | 7일",
      "세레브렉스캡슐 100mg | 1캡슐 | 하루 2회 | 아침·저녁 식후 | 5일",
    ]),
    createDocumentImage(diagnosisPath, [
      "진단서 (비식별 API 테스트)",
      "진단명: 본태성(원발성) 고혈압",
      "질병코드: I10",
      "향후 계획: 혈압 기록을 지참하여 외래 추적 관찰",
    ]),
  ]);

  const [prescriptionBytes, diagnosisBytes] = await Promise.all([
    readFile(prescriptionPath),
    readFile(diagnosisPath),
  ]);
  const prescription = await analyzeMedicationDocument({
    documentType: "처방전",
    fileName: "prescription.png",
    contentType: "image/png",
    contentBase64: prescriptionBytes.toString("base64"),
  });
  const diagnosis = await analyzeMedicationDocument({
    documentType: "진단서",
    fileName: "diagnosis.png",
    contentType: "image/png",
    contentBase64: diagnosisBytes.toString("base64"),
  });
  const medication = await searchPharmacogenomicInfo("와파린", {
    apiKey: process.env.MFDS_PARMGEN_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
  });
  const careAgent = await runCareAgent({
    snapshot: careSnapshot(),
    targetDate: "2026-08-16",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const medicationItem = medication.items[0];
  const extractedMedication = /노바스크|세레브렉스/.test(
    JSON.stringify(prescription.analysis.findings),
  );
  const diagnosisMatched = Boolean(
    diagnosis.analysis.diagnoses?.some(
      (item) => item.code === "I10" || item.name.includes("고혈압"),
    ),
  );
  const hasPlainExplanation = Boolean(medicationItem?.plainExplanation?.overview);
  assert.equal(prescription.analysis.source, "openai");
  assert.equal(extractedMedication, true);
  assert.equal(diagnosis.analysis.source, "openai");
  assert.equal(diagnosisMatched, true);
  assert.equal(medication.status, "connected");
  assert.equal(
    medication.status === "connected" ? medication.plainLanguageStatus : "not_run",
    "complete",
  );
  assert.equal(hasPlainExplanation, true);
  assert.equal(careAgent.source, "agent");
  assert.equal(careAgent.run.status, "completed");
  console.log(
    JSON.stringify(
      {
        prescription: {
          status: prescription.status,
          source: prescription.analysis.source,
          findingCount: prescription.analysis.findings.length,
          extractedMedication,
        },
        diagnosis: {
          status: diagnosis.status,
          source: diagnosis.analysis.source,
          diagnosisMatched,
          diseaseLookupStatus: diagnosis.analysis.diseaseLookup?.status ?? "not_run",
        },
        medication: {
          status: medication.status,
          itemCount: medication.items.length,
          plainLanguageStatus:
            medication.status === "connected" ? medication.plainLanguageStatus : "not_run",
          hasPlainExplanation,
        },
        careAgent: {
          source: careAgent.source,
          runStatus: careAgent.run.status,
          schemaVersion: careAgent.output.schema_version,
          findingCount: careAgent.output.findings.length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
