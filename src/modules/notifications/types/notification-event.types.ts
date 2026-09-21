// Every domain event payload is deliberately just entity ids - never a
// recipient user id, never rendered title/body text (spec section 66:
// "every event handler must resolve recipients from server-side
// relationships... do not accept a recipient user ID from the ...
// request"). NotificationEventService re-reads each entity from Postgres
// itself before resolving recipients or rendering a template, so a
// business module's event payload can never be used to spoof who receives
// a notification or what it says.
export interface ResidencyEventPayload {
  residencyId: string;
}

export interface InvoiceEventPayload {
  invoiceId: string;
}

export interface RentPaymentEventPayload {
  paymentId: string;
}

export interface FoodMenuEventPayload {
  menuId: string;
}

export interface FoodSubscriptionEventPayload {
  subscriptionId: string;
}

export interface FoodSubscriptionPaymentEventPayload {
  foodSubscriptionPaymentId: string;
}

export interface ComplaintEventPayload {
  complaintId: string;
}

export interface SaasSubscriptionPaymentEventPayload {
  subscriptionPaymentId: string;
}

export interface SaasSubscriptionEventPayload {
  organizationId: string;
}
