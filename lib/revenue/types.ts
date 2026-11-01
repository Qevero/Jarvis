/** Rows as stored in Supabase (mirrors of Xero data). Money in pounds as numbers. */

export type InvoiceType = "ACCREC" | "ACCPAY" | "ACCRECCREDIT" | "ACCPAYCREDIT";

export type InvoiceRow = {
  invoice_id: string;
  type: InvoiceType;
  number: string | null;
  reference: string | null;
  contact_id: string | null;
  contact_name: string | null;
  status: string;
  date: string | null;
  due_date: string | null;
  fully_paid_on: string | null;
  currency_code: string;
  currency_rate: number;
  line_amount_types: string | null;
  sub_total: number;
  total_tax: number;
  total: number;
  amount_due: number;
  amount_paid: number;
  has_attachments: boolean;
  repeating_invoice_id: string | null;
  sent_to_contact?: boolean | null;
  updated_utc?: string | null;
};

export type LineRow = {
  invoice_id: string;
  line_item_id: string;
  position: number;
  description: string | null;
  quantity: number | null;
  unit_amount: number | null;
  account_code: string | null;
  tax_type: string | null;
  tax_amount: number;
  line_amount: number;
  net_amount: number;
  tracking: { Name?: string; Option?: string }[];
  stream_option: string | null;
};

export type BankTransactionRow = {
  bank_transaction_id: string;
  type: string;
  status: string | null;
  contact_name: string | null;
  date: string | null;
  reference: string | null;
  bank_account: string | null;
  is_reconciled: boolean;
  has_attachments: boolean;
  line_amount_types: string | null;
  sub_total: number;
  total_tax: number;
  total: number;
  lines: { Description?: string; AccountCode?: string; TaxType?: string; TaxAmount?: number; LineAmount?: number }[];
};

/** Statuses that count as real (posted) transactions. */
export const POSTED = new Set(["AUTHORISED", "PAID"]);

/** One line of recognised revenue, net of VAT, in GBP. Credit notes are negative. */
export type RevenueLine = {
  key: string;
  invoiceId: string;
  number: string | null;
  contactId: string | null;
  contactName: string;
  date: string;
  stream: string;
  streamSource: "override" | "tracking" | "account" | "none";
  net: number;
  recurring: boolean;
  accountCode: string | null;
  description: string | null;
};
