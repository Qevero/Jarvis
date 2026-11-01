import { env } from "@/lib/env";
import { UserError } from "@/lib/ctx";

/**
 * Companies House public data API (free key). Used to cross-check Jarvis's
 * filing deadlines and fill in registered office, SIC codes and officers.
 */

const BASE = "https://api.company-information.service.gov.uk";
type J = Record<string, unknown>;

async function get(path: string): Promise<J> {
  const key = env.companiesHouseKey();
  if (!key) throw new UserError("Add COMPANIES_HOUSE_API_KEY (free from developer.company-information.service.gov.uk) to use Companies House data.");
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` }, cache: "no-store" });
  if (res.status === 404) throw new UserError("Companies House doesn't recognise that company number.");
  if (!res.ok) throw new UserError(`Companies House error ${res.status}.`);
  return (await res.json()) as J;
}

export async function companiesHouseProfile(companyNumber: string) {
  const p = await get(`/company/${encodeURIComponent(companyNumber)}`);
  const accounts = (p.accounts ?? {}) as J;
  const cs = (p.confirmation_statement ?? {}) as J;
  const addr = (p.registered_office_address ?? {}) as J;
  const officers = await get(`/company/${encodeURIComponent(companyNumber)}/officers`).catch(() => ({ items: [] }) as J);
  return {
    name: p.company_name as string,
    number: p.company_number as string,
    status: p.company_status as string,
    incorporated: (p.date_of_creation as string) ?? null,
    sicCodes: (p.sic_codes as string[]) ?? [],
    registeredOffice: [addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code].filter(Boolean).join(", "),
    accounts: {
      nextDue: ((accounts.next_accounts as J)?.due_on as string) ?? (accounts.next_due as string) ?? null,
      nextMadeUpTo: ((accounts.next_accounts as J)?.period_end_on as string) ?? (accounts.next_made_up_to as string) ?? null,
      overdue: Boolean((accounts.next_accounts as J)?.overdue ?? accounts.overdue),
      referenceDate: accounts.accounting_reference_date as J | undefined,
    },
    confirmationStatement: { nextDue: (cs.next_due as string) ?? null, nextMadeUpTo: (cs.next_made_up_to as string) ?? null, overdue: Boolean(cs.overdue) },
    officers: ((officers.items as J[]) ?? []).filter((o) => !o.resigned_on).map((o) => ({ name: o.name as string, role: o.officer_role as string, appointed: o.appointed_on as string })),
  };
}
