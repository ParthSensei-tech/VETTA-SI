/**
 * Transactional email, via Resend's REST API.
 *
 * Plain fetch, no SDK: one endpoint, one header, and nothing to install that
 * could fail the build. The key is server-only (`RESEND_API_KEY`, never a
 * `VITE_` name) and an unconfigured key is a silent no-op — lead capture must
 * never fail because email is not wired yet.
 *
 * Scope guard that is load-bearing for DPDP: this module is for *workspace and
 * lead* recipients only. The product does not email candidates about jobs —
 * outbound candidate messaging stays out of the codebase until the consent
 * story for it exists.
 */
import { env } from "../env.server.ts";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const key = env("RESEND_API_KEY");
  if (!key) return;
  const from = env("RESEND_FROM") ?? "Vetta <hello@vetta.hire>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/** Best-effort send: the product action already happened; the email is courtesy. */
export async function trySendEmail(msg: EmailMessage): Promise<void> {
  try {
    await sendEmail(msg);
  } catch {
    // Deliberately swallowed — see the header. Never fail a lead capture.
  }
}
