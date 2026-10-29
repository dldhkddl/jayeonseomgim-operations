/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import { buildPremiumDetailModel, type DetailTheme } from "../lib/premiumDetail";
import type { CanonicalRow } from "../lib/channels/canonical";

type Props = {
  row: CanonicalRow;
  images: string[];
  theme: DetailTheme;
  guide?: string;
  phone?: string;
};

type Card = { label: string; value: string };

function Cards({ items, className = "" }: { items: Card[]; className?: string }) {
  return (
    <div className={`pdtCards ${className}`}>
      {items.map((item, index) => (
        <article className="pdtCard" key={`${item.label}-${index}`}>
          <b>{item.label}</b>
          <p>{item.value}</p>
        </article>
      ))}
    </div>
  );
}

function Heading({ eyebrow, children, copy }: { eyebrow: string; children: ReactNode; copy?: string }) {
  return (
    <header className="pdtHeading">
      <small>{eyebrow}</small>
      <h3>{children}</h3>
      {copy && <p>{copy}</p>}
    </header>
  );
}

export default function PremiumDetailPage({ row, images, theme, guide, phone }: Props) {
  const model = buildPremiumDetailModel(row, images);
  const image = (index: number) => model.images[index] || model.images[0] || "";
  const visualStoryImages = model.images.slice(4, 7);
  const vars = {
    "--pdt-primary": theme.primary,
    "--pdt-primary-text": theme.primaryText,
    "--pdt-accent": theme.accent,
    "--pdt-soft": theme.soft,
    "--pdt-cream": theme.cream,
    "--pdt-ink": theme.ink,
  } as CSSProperties;
  const tasteCards = (model.features.length ? model.features : ["입력된 상품 특징을 확인해 주세요"]).map((value, index) => ({
    label: `POINT ${String(index + 1).padStart(2, "0")}`,
    value,
  }));
  const storageCards: Card[] = [
    { label: "받은 즉시", value: "상품 상태와 주문 구성을 확인해 주세요" },
    { label: "보관 방법", value: model.storage || "상품정보에 표시된 방법으로 보관해 주세요" },
    { label: "섭취 전", value: "상품 상태를 다시 한번 확인해 주세요" },
    { label: "문의 사항", value: phone ? `문의 ${phone}` : "판매자 문의를 이용해 주세요" },
  ];

  return (
    <div className="pdt" style={vars}>
      <section className="pdtHero" data-section="hero">
        <div className="pdtHeroCopy">
          <small>FRESH FROM FARM</small>
          <h1>{model.name || "오늘의 신선함"}</h1>
          <p>{model.summary}</p>
        </div>
        {image(0) && <img src={image(0)} alt={model.name || "상품 대표"} />}
        <div className="pdtHeroPills">
          {model.origin && <span>{model.origin}</span>}
          {model.variety && <span>{model.variety}</span>}
          {model.weight && <span>{model.weight}</span>}
        </div>
      </section>

      <section className="pdtEmpathy" data-section="empathy">
        <div className="pdtQuote">“</div>
        <h2>좋은 상품을 고르는 기준,<br />복잡할 필요 없습니다</h2>
        <p>확인된 상품정보를 보기 쉽게 정리해 드립니다.</p>
      </section>

      <section className="pdtSection" data-section="taste">
        <Heading eyebrow="TASTE & STORY" copy={model.features.slice(1).join(" · ")}>
          {model.features[0] || "상품의 특징을 확인해 보세요"}
        </Heading>
        <div className="pdtSplit">
          {image(1) && <img className="pdtRoundedImage" src={image(1)} alt={`${model.name} 특징`} />}
          <Cards items={tasteCards} className="pdtCardsOne" />
        </div>
      </section>

      <section className="pdtSection pdtWhite" data-section="criteria">
        <Heading eyebrow="BEFORE YOU BUY" copy="원산지·품종·구성·보관 방법처럼 입력된 정보만 안내합니다.">
          구매 전 상품정보를<br />확인해 주세요
        </Heading>
        <Cards items={model.criteria.length ? model.criteria : [{ label: "상품정보", value: "등록된 상세정보를 확인해 주세요" }]} />
      </section>

      <section className="pdtSection pdtSoft" data-section="promises">
        <Heading eyebrow="THREE POINTS">안심하고 고르기 위한<br />세 가지 기준</Heading>
        <Cards items={model.promises} className="pdtCardsThree" />
      </section>

      <section className="pdtShowcase" data-section="showcase">
        {image(2) && <img src={image(2)} alt={`${model.name} 구성`} />}
        <div>
          <b>상품정보를 먼저 확인하세요</b>
          <span>{model.weight || model.summary}</span>
        </div>
      </section>

      {visualStoryImages.length > 0 && (
        <section className="pdtSection pdtWhite pdtVisualStory" data-section="visual-story">
          <Heading eyebrow="FRESH MOMENTS" copy="상품의 질감부터 산지와 식탁의 분위기까지 다양한 장면으로 확인해 보세요.">
            눈으로 먼저 만나는<br />신선한 순간
          </Heading>
          <div className="pdtVisualStoryGrid">
            {visualStoryImages.map((src, index) => (
              <img key={src} src={src} alt={`${model.name} 연출 사진 ${index + 1}`} />
            ))}
          </div>
        </section>
      )}

      <section className="pdtSection" data-section="process">
        <Heading eyebrow="FRESH PROCESS">보내기 전까지<br />한 번 더 확인합니다</Heading>
        <Cards
          className="pdtCardsFour"
          items={model.process.map((item, index) => ({
            label: `STEP ${String(index + 1).padStart(2, "0")} · ${item.label}`,
            value: item.value,
          }))}
        />
      </section>

      <section className="pdtSection pdtSoft pdtPackage" data-section="package">
        <div>
          <small>PACKAGE</small>
          <h3>선택하신 구성을<br />확인해 주세요</h3>
          <p>{model.weight || "선택 옵션에 표시된 구성으로 준비됩니다."}</p>
          <p>{model.delivery || "배송 조건은 상품정보를 확인해 주세요."}</p>
        </div>
        {image(3) && <img className="pdtRoundedImage" src={image(3)} alt={`${model.name} 포장`} />}
      </section>

      <section className="pdtSection pdtWhite" data-section="specs">
        <Heading eyebrow="PRODUCT GUIDE">구매 전 확인해 주세요</Heading>
        <dl className="pdtSpecs">
          {model.specs.map((item) => (
            <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
          ))}
        </dl>
        {guide && <p className="pdtGuide">{guide}</p>}
      </section>

      <section className="pdtSection" data-section="storage">
        <Heading eyebrow="STORAGE TIP">더 맛있게 즐기는 방법</Heading>
        <Cards items={storageCards} />
      </section>

      <section className="pdtClosing" data-section="closing">
        <small>THANK YOU</small>
        <h3>오늘의 신선함을<br />더 기분 좋게</h3>
        <p>상품정보를 확인하고 알맞은 구성을 선택해 주세요.</p>
      </section>
    </div>
  );
}
