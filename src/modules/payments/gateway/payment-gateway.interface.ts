// The provider abstraction spec section 27 asks for: Razorpay is the only
// implementation in Phase 6 (see RazorpayGatewayService), but every
// gateway-specific detail (SDK shape, header names, signature algorithm)
// lives behind this interface - PaymentsService never imports the
// `razorpay` package directly. A second gateway later is a new class
// implementing this interface and a config switch, never a rewrite of
// PaymentsService.
export interface CreateGatewayOrderInput {
  amountInSmallestUnit: number;
  currency: string;
  // Used as the gateway's `receipt` - our own Payment.id, so a created
  // order can always be traced back to exactly one internal row.
  receipt: string;
  notes?: Record<string, string>;
}

export interface CreateGatewayOrderResult {
  providerOrderId: string;
}

export interface VerifyPaymentSignatureInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface FetchGatewayPaymentResult {
  status: string;
  method?: string;
}

export interface CreateTransferInput {
  providerPaymentId: string;
  destinationAccountId: string;
  amountInSmallestUnit: number;
  currency: string;
  notes?: Record<string, string>;
}

export interface CreateTransferResult {
  providerTransferId: string;
  status: string;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
  amountInSmallestUnit: number;
  notes?: Record<string, string>;
}

export interface RefundPaymentResult {
  providerRefundId: string;
  status: string;
}

export interface PaymentGateway {
  createOrder(
    input: CreateGatewayOrderInput,
  ): Promise<CreateGatewayOrderResult>;
  verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean;
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean;
  fetchPayment(providerPaymentId: string): Promise<FetchGatewayPaymentResult>;
  // Marketplace/split-settlement transfer to the PG owner's linked
  // account (spec section 21) - never a plain internal ledger entry
  // pretending to be a real transfer.
  createTransfer(input: CreateTransferInput): Promise<CreateTransferResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
}

// DI token - PaymentsService/OwnerSettlementsService depend on this
// interface, not on RazorpayGatewayService directly, so a test can supply
// a fake gateway without touching the real Razorpay SDK.
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
