import type { EmailMessage } from "./server.ts";

/** These strings come from database rows and from a stranger's keyboard. */
function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, body: string): { html: string; text: string } {
  return {
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0b0b0c">
  <p style="font-size:12px;letter-spacing:0.35em;text-transform:uppercase;color:#6b7280;margin:0 0 20px">VETTA</p>
  <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
  ${body}
  <p style="font-size:12px;color:#6b7280;margin-top:28px">Vetta · AI-native recruiting for India's early-stage teams<br/>You can reply to this email — a human reads it.</p>
</div>`,
    text: `VETTA\n\n${title}\n\n${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n\n— Vetta · a human reads replies`,
  };
}

export function welcomeEmail(args: { to: string; companyName: string }): EmailMessage {
  const { html, text } = shell(
    `Welcome to Vetta, ${args.companyName}`,
    `<p style="font-size:14px;line-height:1.6">Your workspace is live. One action starts everything: paste the role you can't fill, and Vetta will show you an evidence-traced shortlist — every verdict citing the line in the resume that earned it.</p>
     <p style="font-size:14px"><a href="/app/onboarding" style="color:#0b0b0c;font-weight:600">Open your first role →</a></p>`,
  );
  return { to: args.to, subject: `Your Vetta workspace for ${args.companyName} is ready`, html, text };
}

export function demoConfirmationEmail(args: { to: string; name?: string }): EmailMessage {
  const greeting = args.name ? `Thanks, ${args.name} —` : "Thanks —";
  const { html, text } = shell(
    "Your demo request landed",
    `<p style="font-size:14px;line-height:1.6">${greeting} it's on the founder's list, and every one gets a reply personally, usually the same day. If you want to skip the queue, the free tier runs one of your live roles today — no card, no call.</p>`,
  );
  return { to: args.to, subject: "Vetta demo — what happens next", html, text };
}

export function teaserUnlockEmail(args: {
  to: string;
  jobTitle: string;
  /** Built by the caller: the same address they unlocked with is the only key. */
  unlockUrl: string;
}): EmailMessage {
  const title = esc(args.jobTitle);
  const href = esc(args.unlockUrl);
  const { html, text } = shell(
    `The shortlist for ${title}`,
    `<p style="font-size:14px;line-height:1.6">Here is the unlocked view: <a href="${href}" style="color:#0b0b0c;font-weight:600">the full ${title} shortlist on Vetta →</a></p>
     <p style="font-size:14px;line-height:1.6">Open it with the same email address you gave us — that is the whole key, and the reason there is no attachment. Names, contact details and the evidence cards behind each verdict stay inside the workspace that hired for the role: they belong to people who consented to be seen by their next employer, not by the internet.</p>`,
  );
  return { to: args.to, subject: `Your Vetta teaser for ${title} is ready`, html, text };
}
