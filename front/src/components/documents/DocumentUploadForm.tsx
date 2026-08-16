"use client";

import { FileImage, FlaskConical, LockKeyhole } from "lucide-react";
import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";

import {
  registerDocumentAction,
  registerSampleDocumentAction,
} from "@/app/actions";
import { FormMessage } from "@/components/ui/FormMessage";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionState } from "@care-atlas/backend";

const initialState: ActionState = { status: "idle", message: "" };

export function DocumentUploadForm() {
  const [state, action] = useActionState(registerDocumentAction, initialState);
  const [sampleState, sampleAction] = useActionState(
    registerSampleDocumentAction,
    initialState,
  );
  const [file, setFile] = useState<File | null>(null);
  const previewUrl = useMemo(
    () => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="upload-stack">
      <FormMessage state={state.status !== "idle" ? state : sampleState} />
      <form action={action}>
        <div className="field">
          <label htmlFor="documentType">문서 종류</label>
          <select id="documentType" name="documentType" defaultValue="처방전">
            <option>처방전</option>
            <option>복약안내서</option>
            <option>진단 관련 문서</option>
            <option>약 봉투</option>
          </select>
        </div>

        <label className="upload-dropzone" htmlFor="document">
          {previewUrl ? (
            <Image
              className="upload-preview"
              src={previewUrl}
              width={520}
              height={300}
              unoptimized
              alt="선택한 문서 미리보기"
            />
          ) : (
            <span>
              <FileImage size={34} aria-hidden="true" />
              <strong>사진 또는 PDF를 선택하세요</strong>
              <p>이름·주민번호·주소는 가린 뒤 올려주세요. 최대 5MB</p>
            </span>
          )}
          <input
            id="document"
            name="document"
            type="file"
            accept="image/*,application/pdf"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {file ? (
          <p className="selected-file" role="status">
            선택됨: {file.name} · {(file.size / 1024).toFixed(0)}KB
          </p>
        ) : null}

        <div className="privacy-note upload-privacy">
          <LockKeyhole size={20} aria-hidden="true" />
          <p>
            1차 MVP는 원본 파일을 저장하지 않고 파일명·종류·크기만 기록해요. AI 키를 연결한
            뒤에도 비식별화된 정보만 분석하도록 설계했어요.
          </p>
        </div>
        <div className="form-actions">
          <SubmitButton pendingText="문서 확인 중…">문서 정보 등록</SubmitButton>
        </div>
      </form>

      <div className="sample-divider" aria-hidden="true">
        <span>또는</span>
      </div>
      <form action={sampleAction}>
        <button className="button button--secondary sample-button" type="submit">
          <FlaskConical size={18} aria-hidden="true" />
          비식별 샘플 처방전으로 체험
        </button>
      </form>
    </div>
  );
}
