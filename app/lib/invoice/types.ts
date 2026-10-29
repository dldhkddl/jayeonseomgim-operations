export type MatchStatus = "auto_matched" | "review_required" | "confirmed" | "excluded";

export type NaverOrder = {
  productOrderId: string;
  productName: string;
  quantity: number;
  buyerName: string;
  recipientName: string;
  address: string;
  phone1: string;
  phone2: string;
  deliveryMessage: string;
  buyerPhone: string;
  sellerId: string;
  buyerId: string;
  status: string;
  sourceOrderKey?: string;
};

export type SupplierRow = {
  trackingNumber: string;
  carrier: string;
  productName: string;
  quantity: number;
  recipientName: string;
  phone: string;
  address: string;
  sourceOrderKey?: string;
  phoneRole?: "recipient" | "buyer";
  strictIdentity?: boolean;
};

export type SupplierShipment = {
  trackingNumber: string;
  carrier: string;
  recipientName: string;
  phone: string;
  phoneRole?: "recipient" | "buyer";
  address: string;
  strictIdentity?: boolean;
  items: Array<{ productName: string; quantity: number; sourceOrderKey?: string }>;
};

export type ShipmentMatch = {
  shipment: SupplierShipment;
  status: MatchStatus;
  orders: NaverOrder[];
  candidates: NaverOrder[];
  reason: string;
};

export type DispatchRow = {
  productOrderId: string;
  deliveryMethod: string;
  carrier: string;
  trackingNumber: string;
};
