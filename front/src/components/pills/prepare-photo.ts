import { PILL_WEB_PREPROCESSING_VERSION } from "@care-atlas/backend/pill-photo-web-contract";
import { stripJpegMetadata } from "./jpeg-metadata";

export type PreparedWebPhoto = { preview: string; width: number; height: number; images: Record<string, Blob> };
const canvas = (width: number, height: number) => {
  const node = document.createElement("canvas"); node.width = width; node.height = height;
  const context = node.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("이 브라우저에서 사진을 처리할 수 없어요.");
  context.fillStyle = "white"; context.fillRect(0, 0, width, height);
  return { node, context };
};
async function jpeg(node: HTMLCanvasElement) {
  for (const quality of [0.92, 0.82, 0.7]) {
    const blob = await new Promise<Blob | null>(resolve => node.toBlob(resolve, "image/jpeg", quality));
    if (blob) {
      const clean = new Blob([stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()))], { type: "image/jpeg" });
      if (clean.size <= 512 * 1024) return clean;
    }
  }
  throw new Error("사진 용량이 너무 커요. 배경을 단순하게 하고 다시 촬영해주세요.");
}
export async function prepareWebPhoto(file: File): Promise<PreparedWebPhoto> {
  if (!["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    throw new Error("5MB 이하의 JPEG 또는 PNG 사진을 선택해주세요.");
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("사진을 열 수 없어요. JPEG 또는 PNG로 저장한 뒤 다시 선택해주세요."); }
  try {
    const { width, height } = bitmap;
    if (width < 160 || height < 160 || width * height > 25_000_000) throw new Error("사진 크기는 가로·세로 160px 이상, 2,500만 화소 이하로 선택해주세요.");
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const context = canvas(Math.round(width * scale), Math.round(height * scale));
    context.context.drawImage(bitmap, 0, 0, context.node.width, context.node.height);
    const edge = Math.floor(Math.min(width, height) * 0.4);
    const color = canvas(768, 768);
    color.context.drawImage(bitmap, Math.floor((width - edge) / 2), Math.floor((height - edge) / 2), edge, edge, 0, 0, 768, 768);
    const contrast = canvas(768, 768);
    const pixels = color.context.getImageData(0, 0, 768, 768);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = Math.round(0.2126 * pixels.data[i]! + 0.7152 * pixels.data[i + 1]! + 0.0722 * pixels.data[i + 2]!);
      pixels.data[i] = gray; histogram[gray]++;
    }
    const percentile = (fraction: number) => {
      let count = 0;
      for (let i = 0; i < 256; i++) { count += histogram[i]!; if (count >= 768 * 768 * fraction) return i; }
      return 255;
    };
    const low = percentile(0.01); const high = percentile(0.99);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = high > low ? Math.round((pixels.data[i]! - low) * 255 / (high - low)) : pixels.data[i]!;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    }
    contrast.context.putImageData(pixels, 0, 0);
    const images: Record<string, Blob> = { context: await jpeg(context.node) };
    for (const [kind, source] of [["color", color.node], ["contrast", contrast.node]] as const) {
      for (const angle of [0, 90, 180, 270]) {
        const target = canvas(768, 768);
        target.context.translate(384, 384); target.context.rotate(angle * Math.PI / 180);
        target.context.drawImage(source, -384, -384);
        images[`${kind}-${angle}`] = await jpeg(target.node);
        target.node.width = 0;
      }
    }
    const preview = URL.createObjectURL(images.context!);
    context.node.width = color.node.width = contrast.node.width = 0;
    return { images, preview, width: Math.round(width * scale), height: Math.round(height * scale) };
  } finally { bitmap.close(); }
}
export function pillWebForm(front: PreparedWebPhoto, back: PreparedWebPhoto) {
  const form = new FormData();
  form.set("consent", "true"); form.set("version", PILL_WEB_PREPROCESSING_VERSION);
  let size = 0;
  for (const [side, photo] of [["front", front], ["back", back]] as const) {
    for (const [kind, blob] of Object.entries(photo.images)) {
      size += blob.size; form.set(`${side}-${kind}`, blob, `${side}-${kind}.jpg`);
    }
  }
  if (size > 5.5 * 1024 * 1024) throw new Error("사진 용량이 너무 커요. 배경을 단순하게 하고 다시 촬영해주세요.");
  return form;
}
