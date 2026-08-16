import { FileHeart, FileText } from "lucide-react";
import Image from "next/image";

const samples = [
  {
    type: "처방전",
    fileName: "prescription-sample.png",
    src: "/samples/prescription-sample.png",
    width: 620,
    height: 825,
    icon: FileText,
  },
  {
    type: "진단서",
    fileName: "diagnosis-sample.png",
    src: "/samples/diagnosis-sample.png",
    width: 590,
    height: 832,
    icon: FileHeart,
  },
] as const;

export function DemoDocumentSamples() {
  return (
    <section className="demo-document-samples" aria-labelledby="demo-samples-title">
      <div className="demo-document-samples__heading">
        <div>
          <span>데모 전용</span>
          <h3 id="demo-samples-title">비식별 샘플 문서</h3>
        </div>
        <p>문서 종류별 예시를 확인한 뒤 아래에서 샘플 분석을 체험하세요.</p>
      </div>
      <div className="demo-document-samples__grid">
        {samples.map(({ type, fileName, src, width, height, icon: Icon }) => (
          <figure className="demo-document-sample" key={type}>
            <div className="demo-document-sample__image">
              <Image
                src={src}
                width={width}
                height={height}
                sizes="(max-width: 720px) 100vw, 24rem"
                loading="eager"
                alt={`${type} 비식별 샘플`}
              />
            </div>
            <figcaption>
              <Icon size={17} aria-hidden="true" />
              <span><strong>{type}</strong><small>{fileName}</small></span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
