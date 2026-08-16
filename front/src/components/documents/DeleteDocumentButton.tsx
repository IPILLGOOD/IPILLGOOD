"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { deleteDocumentAction } from "@/app/actions";

export function DeleteDocumentButton({
  documentId,
  fileName,
}: {
  documentId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(`“${fileName}” 문서를 삭제할까요?\n삭제한 기록은 복구할 수 없어요.`)) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        await deleteDocumentAction(formData);
        router.refresh();
      } catch {
        setError("문서를 삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return (
    <form className="document-delete-form" onSubmit={handleSubmit}>
      <input type="hidden" name="documentId" value={documentId} />
      <button
        className="document-delete-button"
        type="submit"
        disabled={pending}
        aria-label={`“${fileName}” 문서 삭제`}
      >
        <Trash2 size={16} aria-hidden="true" />
        {pending ? "삭제 중…" : "삭제"}
      </button>
      {error ? <span className="document-delete-error" role="alert">{error}</span> : null}
    </form>
  );
}
