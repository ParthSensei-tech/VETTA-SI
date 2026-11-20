import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { getPublicIndex } from "@/features/marketing/api/vetta-index";
import { FAQS } from "@/shared/components/landing/content/site";
import {
  faqPageLd,
  organizationLd,
  softwareApplicationLd,
  websiteLd,
} from "@/platform/seo/jsonld";

const LandingPage = lazyRouteComponent(
  () => import("@/shared/components/landing/page"),
  "LandingPage",
);

export const Route = createFileRoute("/")({
  loader: async () => {
    // The landing page's one number is read, never written into copy: a stale
    // median on the front door is the fastest way to lose the argument the
    // whole product is built on. Null means the read failed, which is rendered
    // as no stat at all rather than as a claim about not having one.
    const [{ seoOrigin }, index] = await Promise.all([
      import("@/platform/seo/origin"),
      getPublicIndex().catch(() => null),
    ]);
    return { origin: seoOrigin(), index };
  },
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    return {
      meta: [
        { title: "Vetta — AI-native recruiting for startups" },
        {
          name: "description",
          content:
            "AI-native recruiting for seed to Series B startups. Define a role — Vetta sources, screens and shortlists candidates, every decision traced to evidence.",
        },
        ...(origin
          ? [
              { "script:ld+json": organizationLd(origin) },
              { "script:ld+json": websiteLd(origin) },
              { "script:ld+json": softwareApplicationLd(origin) },
              { "script:ld+json": faqPageLd(FAQS) },
            ]
          : []),
      ],
      links: origin ? [{ rel: "canonical", href: `${origin}/` }] : [],
    };
  },
  component: Landing,
});

function Landing() {
  const { index } = Route.useLoaderData();
  return <LandingPage index={index} />;
}