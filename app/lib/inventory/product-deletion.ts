export const PRODUCT_DELETION_CONFIRMATION = "확인했습니다.";

export function isExactProductDeletionConfirmation(value: string): boolean {
  return value === PRODUCT_DELETION_CONFIRMATION;
}

type ProductDeletionTarget = {
  channel: "naver" | "coupang";
  originProductNo: string;
};

export function buildProductDeletionRequest(target: ProductDeletionTarget, confirmation: string) {
  if (target.channel === "naver") {
    return {
      url: "/api/naver/products/delete",
      body: { originProductNo: target.originProductNo, confirmation },
    };
  }

  return {
    url: "/api/coupang/products/delete",
    body: { sellerProductId: target.originProductNo, confirmation },
  };
}
