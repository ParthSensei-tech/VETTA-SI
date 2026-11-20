import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { requestDemo } from "@/features/marketing/api/demo-requests";
import { getStoredUtm } from "@/platform/telemetry/utm";
import { FINAL_CTA } from "../content/site";
import { GlassPanel } from "../ui/primitives";

export function DemoCta() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">("idle");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "pending") return;
    setStatus("pending");
    const utm = getStoredUtm();
    try {
      await requestDemo({
        data: {
          email,
          name,
          company,
          marketingOptIn,
          utmSource: utm?.utm_source || "",
          utmMedium: utm?.utm_medium || "",
          utmCampaign: utm?.utm_campaign || "",
          utmTerm: utm?.utm_term || "",
          utmContent: utm?.utm_content || "",
          initialReferrer: utm?.initial_referrer || "",
        },
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-5 pb-24 sm:px-8">
        <GlassPanel className="rounded-3xl p-8 text-center sm:p-14">
          <h2
            id="demo-title"
            className="mx-auto max-w-2xl font-l-display text-[clamp(1.5rem,3.2vw,2.4rem)] leading-snug tracking-tight text-l-text"
          >
            {FINAL_CTA.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-l-muted">
            {FINAL_CTA.sub}
          </p>
          {status === "done" ? (
            <p className="mt-8 text-sm font-medium text-mint" role="status">
              {FINAL_CTA.success}
            </p>
          ) : (
            <form
              onSubmit={onSubmit}
              className="mx-auto mt-8 flex max-w-md flex-col gap-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="demo-email" className="sr-only">
                  Work email
                </label>
                <input
                  id="demo-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={FINAL_CTA.placeholder}
                  className="min-w-0 flex-1 rounded-full border border-l-hairline bg-l-bg/60 px-5 py-3 text-sm text-l-text placeholder:text-l-muted/60"
                />
                <button
                  type="submit"
                  disabled={status === "pending"}
                  className="l-pill-ember rounded-full px-6 py-3 text-sm font-semibold disabled:opacity-60"
                >
                  {status === "pending" ? "Sending…" : FINAL_CTA.button}
                </button>
              </div>
              {/* Optional and unobtrusive: the email is the yes we are asking
                  for. These two only help the founder know who replied. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label htmlFor="demo-name" className="sr-only">
                  Your name
                </label>
                <input
                  id="demo-name"
                  type="text"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  className="min-w-0 rounded-full border border-l-hairline bg-l-bg/40 px-5 py-2.5 text-sm text-l-text placeholder:text-l-muted/50"
                />
                <label htmlFor="demo-company" className="sr-only">
                  Company
                </label>
                <input
                  id="demo-company"
                  type="text"
                  maxLength={120}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company (optional)"
                  className="min-w-0 rounded-full border border-l-hairline bg-l-bg/40 px-5 py-2.5 text-sm text-l-text placeholder:text-l-muted/50"
                />
              </div>
              <label
                htmlFor="demo-optin"
                className="flex cursor-pointer items-start gap-2 text-left text-xs text-l-muted"
              >
                <input
                  id="demo-optin"
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 size-3.5 shrink-0 accent-mint"
                />
                Send me the weekly Vetta Index — hiring data, no pitch. Unsubscribe any time;
                we store the date you said yes.
              </label>
            </form>
          )}
          {status === "error" ? (
            <p className="mt-4 text-xs text-ember" role="alert">
              That didn't go through — check the address and try again.
            </p>
          ) : null}
          <p className="mt-6 text-xs text-l-muted">
            Prefer to look first?{" "}
            <Link to="/jobs" className="text-mint underline-offset-4 hover:underline">
              Browse open roles
            </Link>
          </p>
        </GlassPanel>
      </div>
    </section>
  );
}