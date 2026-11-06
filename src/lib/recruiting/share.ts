import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../auth/middleware.ts";
import { getSql } from "../db.ts";
import { iso, parseJson } from "../utils.ts";
import { decideApproval, loadRoleWorkspaceForUser } from "./api.ts";
import { mailtoUrl, whatsappUrl } from "./links.ts";
import type {
  Approval,
  ClientCard,
  ClientShareRecord,
  ExportSlateResult,
  RankResult,
  SendClientResult,
  ShareCandidate,
  ShareKind,
  ShareView,
} from "./types.ts";

function newId(): string {
  return crypto.randomUUID();
}

function token(): string {
  return newId().replace(/-/g, "") + newId().replace(/-/g, "").slice(0, 8);
}

type ShareRow = {
  id: string;
  user_id: string;
  role_id: string;
  token: string;
  kind: string;
  title: string;
  recipient_email: string;
  recipient_name: string;
  message: string;
  payload_json: string;
  email_status: string;
  created_at: unknown;
};

function mapRecord(row: ShareRow, url: string): ClientShareRecord {
  return {
    id: row.id,
    token: row.token,
    kind: row.kind as ShareKind,
    title: row.title,
    roleId: row.role_id,
    shareUrl: url,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    message: row.message,
    emailStatus: row.email_status,
    createdAt: iso(row.created_at),
  };
}

function viewFromRow(row: ShareRow): ShareView {
  return parseJson<ShareView>(row.payload_json, {
    id: row.id,
    token: row.token,
    kind: row.kind as ShareKind,
    title: row.title,
    roleTitle: "",
    companyName: "",
    companyStage: "",
    location: "",
    workMode: "",
    message: row.message,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    exportedAt: iso(row.created_at),
    candidates: [],
  });
}

async function trySendGmail(
  to: string,
  subject: string,
  body: string,
): Promise<{
  emailed: boolean;
  emailError: string | null;
  loginUrl: string | null;
}> {
  try {
    const { callTool } = await import("@/lib/app-data/client.server");
    const { ConnectorType } = await import("@/lib/app-data/types");
    const attempts: Array<{ tool: string; args: Record<string, unknown> }> = [
      { tool: "gmail_send_email", args: { to, subject, body, html: false } },
      { tool: "gmail_create_draft", args: { to, subject, body } },
    ];
    let loginUrl: string | null = null;
    let lastError: string | null = null;
    for (const attempt of attempts) {
      const result = await callTool(attempt.tool, attempt.args, {
        connectorType: ConnectorType.Gmail,
      });
      if (result.ok) return { emailed: true, emailError: null, loginUrl: null };
      if (result.loginRequired && result.loginUrl) loginUrl = result.loginUrl;
      lastError = result.errorMessage ?? lastError;
    }
    return { emailed: false, emailError: lastError, loginUrl };
  } catch (e) {
    return {
      emailed: false,
      emailError: e instanceof Error ? e.message : "Email connector unavailable",
      loginUrl: null,
    };
  }
}

function fitFromScore(score: number | null, card: ClientCard | null): string {
  if (card?.fit_label) return card.fit_label;
  if (score == null) return "Unranked";
  if (score >= 85) return "Strong match";
  if (score >= 70) return "Good match";
  if (score >= 50) return "Worth a conversation";
  return "Hold";
}

async function snapshotRole(
  userId: string,
  roleId: string,
  applicationIds: string[] | null,
): Promise<{
  view: Omit<ShareView, "id" | "token" | "exportedAt" | "recipientName" | "recipientEmail">;
  roleTitle: string;
}> {
  const { role, applications } = await loadRoleWorkspaceForUser(userId, roleId);
  const wanted = applicationIds ? new Set(applicationIds) : null;
  const picked = applications.filter((a) => {
    if (wanted) return wanted.has(a.id);
    return (
      ["shortlisted", "screening", "ready", "approved", "sent"].includes(a.pipelineStatus) ||
      a.rankScore != null
    );
  });
  const ordered = (wanted ? picked : picked.filter((a) => a.rankScore != null)).sort(
    (a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1),
  );
  const list = ordered.length ? ordered : picked;

  const sql = await getSql();
  const cards = new Map<string, ClientCard>();
  if (list.length) {
    const ids = list.map((a) => a.id);
    let orgId: string | null = null;
    try {
      const { ensureUserOrg } = await import("./org.server");
      orgId = (await ensureUserOrg(userId)).orgId;
    } catch {
      orgId = null;
    }
    const place = ids.map((_, i) => `$${i + 2}`).join(", ");
    const rows = orgId
      ? await sql.query<{ application_id: string; payload_json: string }>(
          `select application_id, payload_json from approvals
           where (org_id = $1 or (org_id is null and user_id = $1)) and application_id in (${place}) and status in ('approved','sent','pending')
           order by created_at desc`,
          [orgId, ...ids],
        )
      : await sql.query<{ application_id: string; payload_json: string }>(
          `select application_id, payload_json from approvals
           where user_id = $1 and application_id in (${place}) and status in ('approved','sent','pending')
           order by created_at desc`,
          [userId, ...ids],
        );
    for (const row of rows) {
      if (!cards.has(row.application_id)) {
        cards.set(row.application_id, parseJson<ClientCard>(row.payload_json, {} as ClientCard));
      }
    }
  }

  const candidates: ShareCandidate[] = list.map((a) => {
    const card = cards.get(a.id) ?? null;
    const rank = a.rank as RankResult | null;
    return {
      applicationId: a.id,
      candidateName: a.candidate.fullName,
      headline:
        card?.headline ||
        [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · "),
      currentTitle: a.candidate.currentTitle,
      currentCompany: a.candidate.currentCompany,
      location: a.candidate.location,
      rankScore: a.rankScore,
      fitLabel: fitFromScore(a.rankScore, card),
      rankSummary: rank?.summary ?? "",
      pipelineStatus: a.pipelineStatus,
      card,
      screenVerdict: a.screen?.evaluation.verdict || card?.screen?.verdict || "",
    };
  });

  return {
    roleTitle: role.title,
    view: {
      kind: "slate",
      title: `${role.companyName} · ${role.title}`,
      roleTitle: role.title,
      companyName: role.companyName,
      companyStage: role.companyStage,
      location: role.location,
      workMode: role.workMode,
      message: "",
      candidates,
    },
  };
}

/** Default client share TTL — 14 days (enterprise: no perpetual public links). */
const DEFAULT_SHARE_TTL_DAYS = 14;

async function persistShare(args: {
  userId: string;
  roleId: string;
  kind: ShareKind;
  title: string;
  recipientEmail: string;
  recipientName: string;
  message: string;
  view: ShareView;
  expiresInDays?: number;
}): Promise<ShareRow> {
  const sql = await getSql();
  const id = newId();
  const tok = token();
  const payload: ShareView = { ...args.view, id, token: tok };
  const ttl = Math.max(1, Math.min(90, args.expiresInDays ?? DEFAULT_SHARE_TTL_DAYS));
  let orgId: string | null = null;
  try {
    const { ensureUserOrg } = await import("./org.server.ts");
    orgId = (await ensureUserOrg(args.userId)).orgId;
  } catch {
    orgId = null;
  }
  if (orgId) {
    const { filterShareApplicationIds } = await import("./privacy.server.ts");
    const { stripShareCandidates } = await import("./privacy.ts");
    const ids = payload.candidates.map((c) => c.applicationId);
    const allowed = new Set(await filterShareApplicationIds({ orgId, applicationIds: ids }));
    const blocked = new Set(ids.filter((applicationId) => !allowed.has(applicationId)));
    const { kept } = stripShareCandidates(payload.candidates, blocked);
    if (kept.length === 0) {
      throw new Error(
        "No one on this slate can be shared. Each person needs a yes, or the company setting for uploaded resumes.",
      );
    }
    payload.candidates = kept;
  }
  await sql`
    insert into client_shares (
      id, user_id, role_id, token, kind, title, recipient_email, recipient_name, message, payload_json,
      expires_at, org_id
    ) values (
      ${id}, ${args.userId}, ${args.roleId}, ${tok}, ${args.kind}, ${args.title},
      ${args.recipientEmail}, ${args.recipientName}, ${args.message}, ${JSON.stringify(payload)},
      now() + (${ttl}::text || ' days')::interval, ${orgId}
    )`;
  await sql`insert into audit_events (id, user_id, entity_type, entity_id, action, meta_json)
    values (${newId()}, ${args.userId}, ${"share"}, ${id}, ${"created"}, ${JSON.stringify({ kind: args.kind, title: args.title, expiresInDays: ttl })})`;
  const rows = await sql<ShareRow>`select * from client_shares where id = ${id} limit 1`;
  return rows[0]!;
}

export async function loadPublicShareView(token: string): Promise<ShareView> {
  const sql = await getSql();
  const rows = await sql<
    ShareRow & { expires_at: unknown; revoked_at: unknown; org_id: string | null }
  >`
    select * from client_shares where token = ${token} limit 1`;
  const row = rows[0];
  if (!row) throw new Error("This share link is invalid or has expired.");
  if (row.revoked_at) throw new Error("This share link has been revoked.");
  if (row.expires_at) {
    const exp = new Date(String(row.expires_at));
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      throw new Error("This share link has expired.");
    }
  }
  const view = viewFromRow(row);
  if (row.org_id && view.candidates && view.candidates.length > 0) {
    const { filterShareApplicationIds } = await import("./privacy.server.ts");
    const { stripShareCandidates } = await import("./privacy.ts");
    const ids = view.candidates.map((c) => c.applicationId).filter(Boolean);
    if (ids.length > 0) {
      const allowed = new Set(
        await filterShareApplicationIds({ orgId: row.org_id, applicationIds: ids }),
      );
      const blocked = new Set(ids.filter((id) => !allowed.has(id)));
      if (blocked.size > 0) {
        const { kept } = stripShareCandidates(view.candidates, blocked);
        if (kept.length === 0) {
          await sql`update client_shares set revoked_at = now() where id = ${row.id}`;
          throw new Error("This share link has been revoked.");
        }
        view.candidates = kept;
        await sql`update client_shares set payload_json = ${JSON.stringify(view)} where id = ${row.id}`;
      }
    }
  }
  return view;
}

export const getPublicShare = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ token: z.string().min(8) }).parse(input))
  .handler(async ({ data }): Promise<ShareView> => loadPublicShareView(data.token));

export const exportRoleSlate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        applicationIds: z.array(z.string()).max(40).optional(),
        recipientEmail: z.string().email().optional().or(z.literal("")),
        recipientName: z.string().max(80).optional(),
        message: z.string().max(4000).optional(),
        sendEmail: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<ExportSlateResult> => {
    const snap = await snapshotRole(context.userId, data.roleId, data.applicationIds ?? null);
    if (!snap.view.candidates.length) throw new Error("No ranked candidates to export yet.");
    const message = data.message?.trim() ?? "";
    const recipientEmail = data.recipientEmail?.trim() ?? "";
    const recipientName = data.recipientName?.trim() ?? "";
    const viewPartial = { ...snap.view, message, recipientEmail, recipientName };
    const row = await persistShare({
      userId: context.userId,
      roleId: data.roleId,
      kind: "slate",
      title: snap.view.title,
      recipientEmail,
      recipientName,
      message,
      view: {
        ...viewPartial,
        id: "",
        token: "",
        exportedAt: new Date().toISOString(),
      },
    });
    const { shareUrl: makeShareUrl } = await import("./origin");
    const { shareToPdf, toBase64 } = await import("./pdf");
    const { shareToNotionMarkdown, shareToXlsxBase64 } = await import("./sheet");
    const view = viewFromRow(row);
    const url = makeShareUrl(row.token);
    view.token = row.token;
    const xlsx = await shareToXlsxBase64(view);
    const pdf = shareToPdf(view);
    const notionMarkdown = shareToNotionMarkdown(view);
    const subject = `Shortlist · ${view.companyName} · ${view.roleTitle}`;
    const body = [
      recipientName ? `Hi ${recipientName.split(" ")[0]},` : "Hi,",
      "",
      message || `Sharing the ranked slate for ${view.roleTitle} at ${view.companyName}.`,
      "",
      `Open the client page: ${url}`,
      "",
      "You can also ask me for the Google Sheet / PDF from the same link.",
      "",
      "— Vetta",
    ].join("\n");
    let emailed = false;
    let emailError: string | null = null;
    let loginUrl: string | null = null;
    if (data.sendEmail && recipientEmail) {
      const sent = await trySendGmail(
        recipientEmail,
        subject,
        `${body}\n\n${notionMarkdown.slice(0, 4000)}`,
      );
      emailed = sent.emailed;
      emailError = sent.emailError;
      loginUrl = sent.loginUrl;
      if (emailed) {
        const sql = await getSql();
        await sql`update client_shares set email_status = ${"sent"} where id = ${row.id}`;
        row.email_status = "sent";
      }
    }
    return {
      share: mapRecord(row, url),
      xlsxBase64: xlsx.base64,
      xlsxFilename: xlsx.filename,
      pdfBase64: toBase64(pdf),
      pdfFilename: xlsx.filename.replace(/\.xlsx$/i, ".pdf"),
      notionMarkdown,
      mailto: recipientEmail
        ? mailtoUrl(recipientEmail, subject, body)
        : mailtoUrl("", subject, body),
      emailed,
      emailError,
      loginUrl,
    };
  });

export const sendPackToClient = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        approvalId: z.string().min(1),
        recipientEmail: z.string().email().optional().or(z.literal("")),
        recipientName: z.string().max(80).optional(),
        message: z.string().max(4000).optional(),
        sendEmail: z.boolean().optional(),
        includeSlate: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SendClientResult> => {
    const sql = await getSql();
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);
    const existing = await sql<{
      id: string;
      application_id: string;
      role_id: string;
      status: string;
      title: string;
      payload_json: string;
    }>`
      select id, application_id, role_id, status, title, payload_json
      from approvals where id = ${data.approvalId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId})) limit 1`;
    const row = existing[0];
    if (!row) throw new Error("Approval not found");
    if (row.status !== "approved" && row.status !== "sent") {
      throw new Error("Only an approved pack can be sent to a client");
    }

    const { assertMayProcess } = await import("./privacy.server");
    const candRow = await sql<{ candidate_id: string }>`
      select candidate_id from applications where id = ${row.application_id} limit 1`;
    if (candRow[0]) {
      await assertMayProcess({
        orgId: org.orgId,
        subjectId: candRow[0].candidate_id,
        applicationId: row.application_id,
        purpose: "client_disclosure",
      });
    }

    const snap = await snapshotRole(
      context.userId,
      row.role_id,
      data.includeSlate ? null : [row.application_id],
    );
    const message = data.message?.trim() ?? "";
    const recipientEmail = data.recipientEmail?.trim() ?? "";
    const recipientName = data.recipientName?.trim() ?? "";
    const shareRow = await persistShare({
      userId: context.userId,
      roleId: row.role_id,
      kind: "pack",
      title: row.title,
      recipientEmail,
      recipientName,
      message,
      view: {
        ...snap.view,
        kind: "pack",
        title: row.title,
        message,
        recipientEmail,
        recipientName,
        id: "",
        token: "",
        exportedAt: new Date().toISOString(),
      },
    });
    const { shareUrl: makeShareUrl } = await import("./origin");
    const { shareToNotionMarkdown } = await import("./sheet");
    const url = makeShareUrl(shareRow.token);

    const approval: Approval =
      row.status === "sent"
        ? await (async () => {
            const rows = await sql<{
              id: string;
              application_id: string;
              role_id: string;
              artifact_type: string;
              title: string;
              payload_json: string;
              status: string;
              reviewer_note: string;
              decided_at: unknown;
              created_at: unknown;
              role_title: string;
              company_name: string;
              candidate_name: string;
            }>`
            select ap.*, r.title as role_title, r.company_name, c.full_name as candidate_name
            from approvals ap
            join roles r on r.id = ap.role_id
            join applications a on a.id = ap.application_id
            join candidates c on c.id = a.candidate_id
            where ap.id = ${row.id} and (ap.org_id = ${org.orgId} or (ap.org_id is null and ap.user_id = ${context.userId}))
            limit 1`;
            const r = rows[0]!;
            return {
              id: r.id,
              applicationId: r.application_id,
              roleId: r.role_id,
              roleTitle: r.role_title,
              companyName: r.company_name,
              candidateName: r.candidate_name,
              artifactType: r.artifact_type as Approval["artifactType"],
              title: r.title,
              payload: parseJson<ClientCard>(r.payload_json, {
                candidate_name: r.candidate_name,
                headline: "",
                fit_label: "",
                summary: "",
                highlights: [],
                watchouts: [],
                interview_probes: [],
                location: "",
                availability: "",
              }),
              status: r.status as Approval["status"],
              reviewerNote: r.reviewer_note,
              decidedAt: r.decided_at ? iso(r.decided_at) : null,
              createdAt: iso(r.created_at),
              shareUrl: url,
            };
          })()
        : await decideApproval({
            data: { approvalId: data.approvalId, decision: "sent", reviewerNote: message },
          });
    approval.shareUrl = url;

    const view = viewFromRow(shareRow);
    const notion = shareToNotionMarkdown(view);
    const subject = `${row.title} · ${snap.view.companyName}`;
    const body = [
      recipientName ? `Hi ${recipientName.split(" ")[0]},` : "Hi,",
      "",
      message || `Sharing a candidate pack for ${snap.view.roleTitle}.`,
      "",
      `Open the client page: ${url}`,
      "",
      notion.slice(0, 2500),
      "",
      "— Vetta",
    ].join("\n");

    let emailed = false;
    let emailError: string | null = null;
    let loginUrl: string | null = null;
    if (data.sendEmail && recipientEmail) {
      const sent = await trySendGmail(recipientEmail, subject, body);
      emailed = sent.emailed;
      emailError = sent.emailError;
      loginUrl = sent.loginUrl;
      if (emailed) {
        await sql`update client_shares set email_status = ${"sent"} where id = ${shareRow.id}`;
        shareRow.email_status = "sent";
      }
    }

    const candPhone = snap.view.candidates[0]
      ? ((
          await sql<{ phone: string }>`
            select c.phone from applications a
            join candidates c on c.id = a.candidate_id
            where a.id = ${row.application_id} limit 1`
        )[0]?.phone ?? "")
      : "";

    return {
      approval,
      share: mapRecord(shareRow, url),
      mailto: recipientEmail
        ? mailtoUrl(recipientEmail, subject, body)
        : mailtoUrl("", subject, body),
      whatsappUrl: recipientEmail ? null : whatsappUrl(candPhone, `${subject}\n${url}`),
      emailed,
      emailError,
      loginUrl,
    };
  });

export const listRoleShares = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<ClientShareRecord[]> => {
    const sql = await getSql();
    const { ensureUserOrg } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);

    // Verify role belongs to caller's org
    const roleCheck = await sql<{ id: string }>`
      select id from roles where id = ${data.roleId} and (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId})) limit 1`;
    if (!roleCheck[0]) throw new Error("Role not found");

    const { shareUrl: makeShareUrl } = await import("./origin");
    const rows = await sql<ShareRow>`
      select * from client_shares
      where (org_id = ${org.orgId} or (org_id is null and user_id = ${context.userId})) and role_id = ${data.roleId}
      order by created_at desc
      limit 20`;
    return rows.map((r) => mapRecord(r, makeShareUrl(r.token)));
  });
