"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PillWebResult } from "@care-atlas/backend/pill-photo-web";
import { prepareWebPhoto, pillWebForm, type PreparedWebPhoto } from "./prepare-photo";
import { PillPhotoResults } from "./PillPhotoResults";
import styles from "./PillPhoto.module.css";

type Side = "front" | "back";
const labels: Record<Side, string> = { front: "앞면", back: "뒷면" };
export function PillPhotoForm() {
  const [photos, setPhotos] = useState<Partial<Record<Side, PreparedWebPhoto>>>({});
  const currentPhotos = useRef(photos);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const [result, setResult] = useState<PillWebResult | null>(null);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const resultRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = new AbortController();
    fetch("/api/pills/analyze", { signal: active.signal }).then(response => response.json()).then(status => {
      setReady(status.ready === true); if (!status.ready) setError(status.message || "사진 분석을 준비하지 못했어요.");
    }).catch(() => { if (!active.signal.aborted) { setReady(false); setError("연결을 확인한 뒤 페이지를 다시 열어주세요."); } });
    const generation = operation;
    return () => { active.abort(); controller.current?.abort(); generation.current++; Object.values(currentPhotos.current).forEach(photo => URL.revokeObjectURL(photo.preview)); };
  }, []);
  async function select(side: Side, file?: File) {
    if (!file) return;
    const id = ++operation.current;
    setBusy(`${labels[side]} 사진을 준비하고 있어요.`); setError(""); setResult(null); setConsent(false);
    try {
      const photo = await prepareWebPhoto(file);
      if (operation.current !== id) { URL.revokeObjectURL(photo.preview); return; }
      const old = currentPhotos.current[side]; if (old) URL.revokeObjectURL(old.preview);
      const next = { ...currentPhotos.current, [side]: photo }; currentPhotos.current = next; setPhotos(next); setConsent(false);
    } catch (e) { if (operation.current === id) setError(e instanceof Error ? e.message : "사진을 다시 선택해주세요."); }
    finally { if (operation.current === id) setBusy(""); }
  }
  function clear() {
    operation.current++; controller.current?.abort(); controller.current = null;
    Object.values(currentPhotos.current).forEach(photo => URL.revokeObjectURL(photo.preview));
    currentPhotos.current = {}; setPhotos({}); setResult(null); setConsent(false); setBusy(""); setError("");
  }
  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    if (!photos.front || !photos.back || !consent || busy || !ready) return;
    const id = ++operation.current;
    const active = new AbortController(); controller.current = active;
    setBusy("사진의 특징과 앞뒤 각인을 읽고 있어요. 최대 2분 정도 걸릴 수 있어요."); setError(""); setResult(null);
    const timeout = setTimeout(() => active.abort("timeout"), 125_000);
    try {
      const response = await fetch("/api/pills/analyze", { method: "POST", body: pillWebForm(photos.front, photos.back), signal: active.signal });
      const body = await response.json();
      if (!response.ok || body.status !== "completed") throw new Error(body.message || "사진 분석을 완료하지 못했어요.");
      if (operation.current === id) { setResult(body); requestAnimationFrame(() => resultRegion.current?.focus()); }
    } catch (e) {
      if (operation.current === id) setError(active.signal.aborted ? "응답 대기 시간이 길어져 중단했어요. 잠시 후 다시 시도해주세요." : e instanceof Error ? e.message : "연결 상태를 확인해주세요.");
    } finally { clearTimeout(timeout); if (operation.current === id) { setBusy(""); controller.current = null; } }
  }
  return <div className={styles.container}>
    <section className={styles.guide} aria-labelledby="pill-photo-guide"><h2 id="pill-photo-guide">같은 알약을 뒤집어 한 장씩 찍어주세요</h2>
      <ol><li>온전한 알약 한 개를 무늬 없는 밝은 배경에 놓으세요.</li><li>알약 전체가 중앙의 점선 안에 들어오도록 가까이 촬영하세요.</li><li>앞면을 찍고 뒤집어서 뒷면도 찍으세요. 사람·처방전·이름은 사진에 담지 마세요.</li></ol>
      <p className={styles.caution}>외형이 비슷한 다른 약이 있을 수 있어요. 결과는 비교 후보이며, 약 이름이나 복용 가능 여부를 확정하지 않습니다.</p>
    </section>
    <form onSubmit={analyze}>
      <div className={styles.photos}>{(["front", "back"] as const).map(side => <fieldset key={side} disabled={!!busy || ready !== true} className={styles.photo}>
        <legend>{labels[side]} 사진</legend>
        <div className={styles.preview} style={photos[side] ? { "--photo-ratio": `${photos[side].width} / ${photos[side].height}`, "--crop-width": `${40 * Math.min(1, photos[side].height / photos[side].width)}%` } as CSSProperties : undefined}>{photos[side]
          // The local object URL contains only the re-encoded image and is revoked on replacement/unmount.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photos[side].preview} alt={`${labels[side]} 선택 사진`} /> : <span>{labels[side]}을 중앙에 놓아주세요</span>}
          <span className={styles.crop} aria-hidden="true" />
        </div>
        <label className={styles.picker}>{labels[side]} 사진 선택<input aria-label={`${labels[side]} 사진 선택`} type="file" accept="image/jpeg,image/png" onChange={event => { void select(side, event.target.files?.[0]); event.target.value = ""; }} /></label>
        <label className={styles.camera}>{labels[side]} 카메라 촬영<input aria-label={`${labels[side]} 카메라 촬영`} type="file" capture="environment" accept="image/jpeg,image/png" onChange={event => { void select(side, event.target.files?.[0]); event.target.value = ""; }} /></label>
      </fieldset>)}</div>
      <p className={styles.meta}>JPEG·PNG · 한 장당 5MB 이하 · 원본 위치 정보는 전처리 과정에서 제거됩니다.</p>
      <label className={styles.consent}><input type="checkbox" checked={consent} disabled={!!busy || !photos.front || !photos.back} onChange={event => setConsent(event.target.checked)} /><span>선택한 두 사진을 OpenAI에 전송하여 외형·각인을 분석하는 데 동의합니다. 사진과 분석 결과는 서비스에 저장되지 않습니다.</span></label>
      <div className={styles.actions}><button className="button button--primary" disabled={!ready || !photos.front || !photos.back || !consent || !!busy} type="submit">사진으로 후보 찾기</button>
        {(photos.front || photos.back || busy) && <button className="button button--secondary" type="button" onClick={clear}>{busy ? "분석 화면 초기화" : "사진 지우기"}</button>}</div>
      {busy && <p role="status" className={styles.status}>{busy}</p>}
      {busy && <p className={styles.meta}>전송 후 화면을 초기화해도 이미 시작된 서버 분석은 끝날 수 있어요.</p>}
      {ready === null && <p role="status">공식 목록 연결을 확인하고 있어요.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
    <div ref={resultRegion} tabIndex={-1}>{result && <PillPhotoResults result={result} />}</div>
  </div>;
}
