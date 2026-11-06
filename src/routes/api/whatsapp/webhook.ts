import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/platform/db";
import { phonesMatch } from "@/features/ranking/domain/prescreen";
import { postScreenTurn } from "@/lib/recruiting/screen-session";

/**
 * Optional WhatsApp Cloud API webhook.
 * Works only if you later set free Meta developer env vars.
 * The product does not call out, and does not require this route to screen people.
 */
export const Route = createFileRoute("/api/whatsapp/webhook")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const expected = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!expected) return Response.json({ configured: false });
        if (mode === "subscribe" && token === expected && challenge) return new Response(challenge);
        return new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        if (!process.env.WHATSAPP_VERIFY_TOKEN) return Response.json({ configured: false });
        const body = (await request.json().catch(() => null)) as {
          entry?: Array<{
            changes?: Array<{
              value?: {
                messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>;
              };
            }>;
          }>;
        } | null;
        const messages =
          body?.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ??
          [];
        const sql = await getSql();
        for (const message of messages) {
          if (message.type !== "text" || !message.from || !message.text?.body) continue;
          const candidates = await sql<{ phone: string; application_id: string }>`
            select c.phone, s.application_id
            from screens s
            join applications a on a.id = s.application_id
            join candidates c on c.id = a.candidate_id
            where s.status <> 'evaluated' and c.phone <> ''
            order by s.updated_at desc
            limit 40`;
          const hit = candidates.find((c) => phonesMatch(c.phone, message.from!));
          if (!hit) continue;
          const text = message.text.body.trim();
          if (text.length < 8) continue;
          await postScreenTurn({
            data: { applicationId: hit.application_id, text, channel: "whatsapp" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
