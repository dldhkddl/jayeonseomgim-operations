"use client";

import { useState } from "react";
import { productGalleryImages, type Product } from "../lib/products";

type Props = { product: Product };

export default function ProductGalleryPreview({ product }: Props) {
  const images = productGalleryImages(product);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[Math.min(activeIndex, Math.max(0, images.length - 1))];
  const title = String(product.data.productName ?? "상품명 없음");
  const price = Number(String(product.data.price ?? "").replace(/[^0-9]/g, ""));

  return (
    <section className="pgp" aria-label="상품 이미지 미리보기">
      <div className="pgpMain">
        {active ? <img src={active} alt={`${title} ${activeIndex + 1}번 이미지`} /> : <div className="pgpEmpty">상품 사진이 없습니다.</div>}
        {images.length > 0 && <span>{activeIndex + 1}/{images.length}</span>}
      </div>
      {images.length > 1 && (
        <div className="pgpThumbs" aria-label="추가 이미지 선택">
          {images.map((src, index) => (
            <button
              type="button"
              key={`${src}-${index}`}
              className={index === activeIndex ? "on" : ""}
              aria-label={`${index + 1}번 상품 이미지 보기`}
              aria-pressed={index === activeIndex}
              onClick={() => setActiveIndex(index)}
            >
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
      <div className="pgpInfo">
        <b>{title}</b>
        {price > 0 && <strong>{price.toLocaleString("ko-KR")}원</strong>}
      </div>
    </section>
  );
}
