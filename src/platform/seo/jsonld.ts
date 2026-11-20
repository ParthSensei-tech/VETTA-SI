import { PLAN_TIERS } from "@/features/billing/domain/plans";
import { DEFINITION } from "@/shared/components/landing/content/site";
import type { PublicJob } from "@/features/recruiting/domain/types";
import {
  INDEX_FLOOR,
  formatDays,
  shortDate,
  type PublishedIndex,
} from "@/features/marketing/domain/vetta-index";

/**
 * JSON-LD builders, isomorphic so route `head()` can call them on both server
 * and client. Emitted through TanStack's `script:ld+json` meta, which escapes
 * the payload — never inline these into raw HTML yourself.
 */

export function organizationLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "Vetta",
    url: origin,
    logo: `${origin}/icon-512.png`,
    description: DEFINITION.lead,
  };
}

export function websiteLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: origin,
    name: "Vetta",
    publisher: { "@id": `${origin}/#organization` },
    inLanguage: "en",
  };
}

export function softwareApplicationLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Vetta",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: origin,
    description: DEFINITION.lead,
    publisher: { "@id": `${origin}/#organization` },
  };
}

export function faqPageLd(faqs: ReadonlyArray<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/**
 * The sellable plans, straight off the tier table — the page and the schema
 * cannot disagree about a price because there is only one number to edit.
 * Portfolio is deliberately absent: a quoted plan with no price is not an Offer.
 */
export function productLd(origin: string) {
  const priced = [PLAN_TIERS.starter, PLAN_TIERS.growth];
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Vetta",
    description: DEFINITION.lead,
    brand: { "@id": `${origin}/#organization` },
    offers: priced.map((tier) => ({
      "@type": "Offer",
      name: tier.displayName,
      url: `${origin}/pricing`,
      priceCurrency: "INR",
      price: String((tier.pricePaiseMonthly ?? 0) / 100),
      category: "Subscription",
    })),
  };
}

/**
 * The Vetta Index as a `Dataset`, so an AI engine that answers "how long does
 * startup hiring take in India?" can quote a number that arrives with its own
 * methodology attached.
 *
 * It takes a `PublishedIndex`, not a `PublicIndex`, on purpose: there is no
 * version of this call that can describe a statistic the gate refused to
 * publish. When there is no Index the page says so and emits no dataset —
 * a `Dataset` schema with nothing measurable in it is exactly the unattributed
 * benchmark we tell founders to distrust.
 */
export function datasetLd(origin: string, index: PublishedIndex) {
  const spread = index.metrics.timeToShortlist;
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${origin}/data#vetta-index`,
    name: "Vetta Index — median time to shortlist in Indian startup hiring",
    description:
      `Median ${formatDays(spread.medianDays)} from a candidate applying to a founder shortlisting them, ` +
      `measured over ${spread.sampleCount} applications across ${index.cohorts.orgs} companies and ` +
      `${index.cohorts.roles} open roles in the ${index.windowDays} days to ${shortDate(index.windowEnd)}. ` +
      `Interquartile range ${formatDays(spread.q1Days)} to ${formatDays(spread.q3Days)}. ` +
      `Published by Vetta, checked ${shortDate(index.builtAt)}. Vetta publishes nothing from a smaller ` +
      `cohort than ${INDEX_FLOOR.orgs} companies, ${INDEX_FLOOR.roles} roles and ${INDEX_FLOOR.applications} applications.`,
    url: `${origin}/data`,
    creator: { "@id": `${origin}/#organization` },
    publisher: { "@id": `${origin}/#organization` },
    dateModified: index.builtAt,
    temporalCoverage: `${index.windowStart}/${index.windowEnd}`,
    measurementTechnique:
      `Median and type-7 quartiles of per-application days between the application landing in a ` +
      `workspace and the first pipeline event that put the candidate on a shortlist or beyond. ` +
      `Medians and shares only — no individual application, company or candidate is identifiable in ` +
      `the published figures, and the cohort floor suppresses any window too small to be a market fact.`,
    variableMeasured: [
      "Time from application to first shortlist, in days",
      "Share of pipelines ending at each stage of the funnel",
    ],
    about: {
      "@type": "Thing",
      name: "Technical hiring velocity at seed to Series B startups in India",
    },
  };
}

/** Google for Jobs wants HTML in `description`; escape, then paragraph-ize. */
function htmlDescription(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Conservative "X–Y LPA" band parse; anything looser emits no baseSalary. */
function lpaRange(band: string): { min: number; max: number } | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:–|—|-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i.exec(band);
  if (!m) return null;
  const min = Number(m[1]) * 100_000;
  const max = Number(m[2]) * 100_000;
  return min > 0 && max >= min ? { min, max } : null;
}

export function jobPostingLd(job: PublicJob, url: string) {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: htmlDescription(job.jdText),
    datePosted: job.createdAt ?? job.postedAt,
    hiringOrganization: { "@type": "Organization", name: job.companyName },
    employmentType: job.employmentType === "contract" ? "CONTRACTOR" : "FULL_TIME",
    url,
  };
  if (job.workMode === "remote") {
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = { "@type": "Country", name: "India" };
  } else {
    ld.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        addressCountry: "IN",
      },
    };
  }
  const salary = lpaRange(job.compensationBand);
  if (salary) {
    ld.baseSalary = {
      "@type": "MonetaryAmount",
      currency: "INR",
      value: {
        "@type": "QuantitativeValue",
        minValue: salary.min,
        maxValue: salary.max,
        unitText: "YEAR",
      },
    };
  }
  return ld;
}