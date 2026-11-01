import type { DraftLine } from "@/lib/invoicing/math";

/** Starting templates for Qevero proposals, one per revenue stream. Edit freely in the proposal editor. */

export type ProposalSection = { heading: string; body: string };
export type ProposalTemplate = { id: string; name: string; intro: string; sections: ProposalSection[]; lines: DraftLine[]; terms: string; depositPercent: number };

export const STANDARD_TERMS = `Prices exclude VAT, which is charged at the standard rate (20%).
Payment terms: 14 days from invoice date.
One-off work: a deposit is invoiced on acceptance, with the balance on completion.
Monthly services run on a rolling monthly basis with 30 days' notice, invoiced in advance.
This proposal is valid for 30 days from the date of issue.
Qevero Ltd, registered in England and Wales, company number 17497612. VAT number GB531607691.`;

export const TEMPLATES: ProposalTemplate[] = [
  {
    id: "website",
    name: "Website build",
    intro: "Thank you for the opportunity to propose a new website. Below is what we'll build, how we'll work together, and what it costs.",
    sections: [
      { heading: "Your goals", body: "- \n- \n- " },
      { heading: "What we'll deliver", body: "- Discovery workshop and sitemap\n- Custom design for key templates (desktop and mobile)\n- Build on a fast, secure, easy-to-edit platform\n- On-page SEO foundations and analytics set-up\n- Training session and launch support" },
      { heading: "Timeline", body: "Week 1–2: discovery and design\nWeek 3–5: build and content entry\nWeek 6: testing, training and launch" },
      { heading: "Why Qevero", body: "We combine design, build and search under one roof, so your site launches ready to be found." },
    ],
    lines: [
      { description: "Website design and build", quantity: 1, unitPricePence: 450000, stream: "website_builds", billing: "one-off" },
      { description: "Hosting, security and maintenance", quantity: 1, unitPricePence: 4500, stream: "software_hosting", billing: "monthly" },
    ],
    terms: STANDARD_TERMS,
    depositPercent: 50,
  },
  {
    id: "seo",
    name: "SEO/GEO retainer",
    intro: "Here's how we'll grow your visibility in Google and in AI answer engines (GEO), month by month.",
    sections: [
      { heading: "Where you are now", body: "Summary of the audit findings: technical health, content gaps and competitors." },
      { heading: "Monthly activity", body: "- Technical SEO monitoring and fixes\n- Content: new pages and optimisation\n- Local SEO and Google Business Profile\n- GEO: structured data and answer-engine visibility\n- Monthly report and call" },
      { heading: "How we measure success", body: "Organic sessions, enquiries from search, rankings for priority terms, and AI answer citations." },
    ],
    lines: [
      { description: "SEO/GEO retainer", quantity: 1, unitPricePence: 75000, stream: "seo_geo_retainers", billing: "monthly" },
      { description: "Onboarding audit and set-up", quantity: 1, unitPricePence: 50000, stream: "seo_geo_retainers", billing: "one-off" },
    ],
    terms: STANDARD_TERMS,
    depositPercent: 0,
  },
  {
    id: "paid_media",
    name: "Paid media management",
    intro: "A proposal to plan, run and optimise your paid advertising.",
    sections: [
      { heading: "Channels", body: "Google Ads, Meta (Facebook/Instagram) and LinkedIn as appropriate." },
      { heading: "What's included", body: "- Account audit and tracking set-up\n- Campaign build and creative\n- Weekly optimisation\n- Monthly reporting" },
      { heading: "Ad spend", body: "Media spend is paid directly to the ad platforms and is not included in our fees." },
    ],
    lines: [
      { description: "Paid media management (monthly)", quantity: 1, unitPricePence: 60000, stream: "paid_media", billing: "monthly" },
      { description: "Campaign set-up", quantity: 1, unitPricePence: 40000, stream: "paid_media", billing: "one-off" },
    ],
    terms: STANDARD_TERMS,
    depositPercent: 100,
  },
  {
    id: "software",
    name: "Software / AI build",
    intro: "A proposal to design and build custom software to streamline your operations.",
    sections: [
      { heading: "The problem", body: "" },
      { heading: "The solution", body: "" },
      { heading: "Phases and milestones", body: "Phase 1: specification\nPhase 2: build\nPhase 3: testing and launch" },
      { heading: "Support", body: "Hosting, monitoring and updates after launch." },
    ],
    lines: [
      { description: "Specification and build", quantity: 1, unitPricePence: 800000, stream: "software_hosting", billing: "one-off" },
      { description: "Hosting and support", quantity: 1, unitPricePence: 15000, stream: "software_hosting", billing: "monthly" },
    ],
    terms: STANDARD_TERMS,
    depositPercent: 40,
  },
  {
    id: "creative",
    name: "Creative / content",
    intro: "A proposal for creative and content production.",
    sections: [
      { heading: "Brief", body: "" },
      { heading: "Deliverables", body: "- \n- " },
      { heading: "Rounds of revisions", body: "Two rounds of revisions are included." },
    ],
    lines: [{ description: "Creative production", quantity: 1, unitPricePence: 120000, stream: "creative_content", billing: "one-off" }],
    terms: STANDARD_TERMS,
    depositPercent: 50,
  },
  { id: "blank", name: "Blank", intro: "", sections: [], lines: [], terms: STANDARD_TERMS, depositPercent: 0 },
];

export function templateById(id: string | null | undefined): ProposalTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[TEMPLATES.length - 1];
}
