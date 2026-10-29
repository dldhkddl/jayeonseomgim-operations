export type InvoiceWorkflowState = {
  canCreateSupplierInvoice: boolean;
  canMatch: boolean;
  supplierStatus: string;
};

export function invoiceWorkflowState(
  hasNaverFile: boolean,
  hasSupplierFile: boolean,
): InvoiceWorkflowState {
  return {
    canCreateSupplierInvoice: hasNaverFile,
    canMatch: hasNaverFile && hasSupplierFile,
    supplierStatus: hasSupplierFile
      ? "공급처 송장 선택됨 · 자동 대조할 수 있습니다."
      : "기본양식 대기 · 공급처 송장을 올리면 대조할 수 있습니다.",
  };
}

export type CoupangInvoiceWorkflowInput = {
  hasOrderFile: boolean;
  reviewComplete: boolean;
  hasSupplierFile: boolean;
  readyMatches: number;
  pendingMatches: number;
};

export function coupangInvoiceWorkflowState(input: CoupangInvoiceWorkflowInput) {
  const canCreateSupplierInvoice = input.hasOrderFile && input.reviewComplete;
  return {
    canReview: input.hasOrderFile,
    canCreateSupplierInvoice,
    canMatch: canCreateSupplierInvoice && input.hasSupplierFile,
    canCreateCoupangDispatch: input.readyMatches > 0 && input.pendingMatches === 0,
  };
}
