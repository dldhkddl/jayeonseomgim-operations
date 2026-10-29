import { env } from "cloudflare:workers";
import {
  getAccessToken,
  uploadProductImage,
  registerProduct,
  isNaverApiError,
} from "../../../lib/naver";
import { resolveNaverContactPhone, validateNaverRegistration } from "../../../lib/naverRegistrationValidation";
import { existingDetailContent } from "../../../lib/channels/detail";

type NaverEnv = {
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_ORIGIN_AREA_CODE?: string;
  NAVER_AS_PHONE?: string;
  NAVER_AS_GUIDE?: string;
};

export async function POST(request: Request) {
  try {
    const {
      NAVER_CLIENT_ID: clientId,
      NAVER_CLIENT_SECRET: clientSecret,
      NAVER_ORIGIN_AREA_CODE: originAreaCode = "00",
      NAVER_AS_PHONE: configuredAfterServiceTelephoneNumber = "",
      NAVER_AS_GUIDE: afterServiceGuideContent = "구매 후 문의사항은 판매자에게 연락해 주세요.",
    } = env as unknown as NaverEnv;

    if (!clientId || !clientSecret) {
      return Response.json(
        { error: "서버에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되어 있지 않습니다." },
        { status: 400 }
      );
    }
    const form = await request.formData();

    const title = String(form.get("title") || "");
    const category = String(form.get("category") || "");
    const sellerProductCode = String(form.get("sellerProductCode") || "").trim();
    const summary = String(form.get("summary") || "");
    const origin = String(form.get("origin") || "");
    const weight = String(form.get("weight") || "");
    const storage = String(form.get("storage") || "");
    const shipping = String(form.get("shipping") || "");
    const producer = String(form.get("producer") || "");
    const feature = String(form.get("feature") || "");
    const importedDetailContent = String(form.get("detailContent") || "");
    const afterServiceTelephoneNumber = resolveNaverContactPhone(
      form.get("asPhone"),
      configuredAfterServiceTelephoneNumber,
    );
    const deliveryCompany = String(form.get("deliveryCompany") || "").trim();
    const returnDeliveryFeeRaw = String(form.get("returnDeliveryFee") || "").trim();
    const exchangeDeliveryFeeRaw = String(form.get("exchangeDeliveryFee") || "").trim();
    const greenCertificationId = String(form.get("greenCertificationId") || "EXCLUDED").trim();
    const greenCertificationName = String(form.get("greenCertificationName") || "").trim();
    const greenCertificationNumber = String(form.get("greenCertificationNumber") || "").trim();
    const unitPriceYnRaw = String(form.get("unitPriceYn") || "").trim();
    const totalCapacityValueRaw = String(form.get("totalCapacityValue") || "").trim();
    const unitCapacityRaw = String(form.get("unitCapacity") || "").trim();
    const indicationUnit = String(form.get("indicationUnit") || "").trim();
    const priceRaw = String(form.get("price") || "0");
    const stockRaw = String(form.get("stock") || "0");
    const salePrice = Number(priceRaw.replace(/[^0-9.-]/g, "")) || 0;
    const stockQuantity = Number(stockRaw.replace(/[^0-9.-]/g, "")) || 0;

    const files = form.getAll("images").filter((f): f is File => f instanceof File);
    const issues = validateNaverRegistration({
      title,
      category,
      sellerProductCode,
      price: priceRaw,
      stock: stockRaw,
      origin,
      phone: afterServiceTelephoneNumber,
      requirePhone: true,
      deliveryCompany,
      returnDeliveryFee: returnDeliveryFeeRaw,
      exchangeDeliveryFee: exchangeDeliveryFeeRaw,
      requireDelivery: true,
      imageCount: files.length,
      greenCertificationId,
      greenCertificationName,
      greenCertificationNumber,
      unitPriceYn: unitPriceYnRaw,
      totalCapacityValue: totalCapacityValueRaw,
      unitCapacity: unitCapacityRaw,
      indicationUnit,
    });
    if (issues.length) {
      return Response.json(
        { error: "등록 필수값을 확인해 주세요.", issues },
        { status: 400 },
      );
    }

    const { accessToken } = await getAccessToken({ clientId, clientSecret });

    const uploadedUrls: string[] = [];
    for (const file of files) {
      const url = await uploadProductImage(accessToken, file);
      uploadedUrls.push(url);
    }

    const generatedDetailContentHtml = `
      <div style="font-family:'Noto Sans KR',sans-serif;line-height:1.7">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(summary)}</p>
        <ul>
          <li>품종/구성: ${escapeHtml(weight)}</li>
          <li>원산지: ${escapeHtml(origin)}</li>
          <li>생산자: ${escapeHtml(producer)}</li>
          <li>보관 방법: ${escapeHtml(storage)}</li>
          <li>배송 조건: ${escapeHtml(shipping)}</li>
          <li>상품 특징: ${escapeHtml(feature)}</li>
        </ul>
        ${uploadedUrls.map((url) => `<img src="${url}" style="width:100%;display:block;margin:12px 0" />`).join("")}
      </div>
    `.trim();
    const detailContentHtml = existingDetailContent({ detailContent: importedDetailContent }) ?? generatedDetailContentHtml;

    const result = await registerProduct({
      accessToken,
      leafCategoryId: category,
      name: title,
      sellerProductCode,
      salePrice,
      stockQuantity,
      representativeImageUrl: uploadedUrls[0],
      optionalImageUrls: uploadedUrls.slice(1),
      detailContentHtml,
      originAreaContent: origin,
      originAreaCode,
      afterServiceTelephoneNumber,
      afterServiceGuideContent,
      weight,
      producer,
      storage,
      deliveryCompany,
      returnDeliveryFee: Number(returnDeliveryFeeRaw.replace(/,/g, "")),
      exchangeDeliveryFee: Number(exchangeDeliveryFeeRaw.replace(/,/g, "")),
      greenCertificationId,
      greenCertificationName,
      greenCertificationNumber,
      unitPriceYn: unitPriceYnRaw === "true",
      totalCapacityValue: Number(totalCapacityValueRaw.replace(/,/g, "")) || 0,
      unitCapacity: Number(unitCapacityRaw) || 0,
      indicationUnit,
    });

    return Response.json({ ok: true, result });
  } catch (error) {
    if (isNaverApiError(error)) {
      console.error("[naver-register]", {
        stage: error.stage,
        status: error.status,
        message: error.message,
        detail: error.detail,
      });
      return Response.json(
        { error: error.message, detail: error.detail, stage: error.stage },
        { status: error.status || 400 },
      );
    }
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
