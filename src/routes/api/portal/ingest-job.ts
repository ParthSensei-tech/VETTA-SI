import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/platform/db";
import { processExternalPortalIngestion } from "@/features/people/server/external-portal-sync.server";
import { checkWebhookRateLimit } from "@/features/people/server/autonomous-portal.server";
import type { ExternalPortalCandidatePayload } from "@/features/recruiting/domain/types";

/**
 * Public Webhook Ingestion Relay for Official Company Career Portals
 *
 * Receives candidate applications directly from an authorized company career portal
 * using the role's unique cryptographic webhook token (?token=wh_tok_...).
 *
 * Guarantees:
 *  - Rate-limited to 60 requests/minute per token.
 *  - Automatically validates that the toggle is enabled for this opening.
 *  - Parses, ranks, and shortlists candidates with zero threat or write access to the client's site.
 */
export const Route = createFileRoute("/api/portal/ingest-job")({
  server: {
    handlers: {
      GET: () => {
        return Response.json({
          status: "healthy",
          service: "Vetta Official Career Portal Ingestion Relay",
          description: "One-way secure applicant ingestion bridge",
        });
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token")?.trim();

        if (!token) {
          return Response.json(
            { ok: false, error: "Missing required ?token query parameter" },
            { status: 401 },
          );
        }

        // 1. Sliding window rate-limiting
        const rateCheck = checkWebhookRateLimit({
          key: `portal_webhook:${token}`,
          limit: 60,
          windowMs: 60_000,
        });
        if (!rateCheck.allowed) {
          return Response.json(
            { ok: false, error: "Rate limit exceeded (max 60 req/min)" },
            { status: 429 },
          );
        }

        const sql = await getSql();

        // 2. Validate token and check that the toggle is enabled
        const [configRow] = await sql`
          select * from role_external_portal_configs
          where webhook_token = ${token}
          limit 1
        `;

        if (!configRow) {
          return Response.json(
            { ok: false, error: "Invalid webhook token" },
            { status: 404 },
          );
        }

        if (!configRow.is_enabled) {
          return Response.json(
            { ok: false, error: "Career portal ingestion is paused/disabled for this role" },
            { status: 403 },
          );
        }

        // 3. Parse incoming body (JSON or multipart)
        let payload: ExternalPortalCandidatePayload;
        const contentType = request.headers.get("content-type") || "";

        try {
          if (contentType.includes("application/json")) {
            payload = (await request.json()) as ExternalPortalCandidatePayload;
          } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
            const formData = await request.formData();
            const fullName = String(formData.get("fullName") || formData.get("name") || "");
            const email = String(formData.get("email") || "");
            const phone = String(formData.get("phone") || "");
            const location = String(formData.get("location") || "");
            const linkedinUrl = String(formData.get("linkedinUrl") || "");
            let resumeText = String(formData.get("resumeText") || "");
            let resumeBase64: string | undefined;
            let resumeFilename: string | undefined;

            const resumeFile = formData.get("resume") || formData.get("file");
            if (resumeFile && typeof resumeFile === "object" && "arrayBuffer" in resumeFile) {
              const file = resumeFile as File;
              resumeFilename = file.name;
              const buffer = Buffer.from(await file.arrayBuffer());
              resumeBase64 = buffer.toString("base64");
            }

            payload = {
              fullName,
              email,
              phone,
              location,
              linkedinUrl,
              resumeText,
              resumeBase64,
              resumeFilename,
            };
          } else {
            return Response.json(
              { ok: false, error: "Unsupported content type. Expected application/json or multipart/form-data" },
              { status: 415 },
            );
          }
        } catch (err: any) {
          return Response.json(
            { ok: false, error: `Malformed request payload: ${err.message}` },
            { status: 400 },
          );
        }

        // 4. Ingest and match candidate
        try {
          const result = await processExternalPortalIngestion({
            roleId: String(configRow.role_id),
            orgId: String(configRow.org_id),
            payload,
            syncType: "webhook",
          });

          return Response.json({
            ok: true,
            message: "Candidate ingested successfully from official company portal",
            applicationId: result.applicationId,
            candidateName: result.candidateName,
            score: result.score,
            fitLevel: result.fitLevel,
            shortlisted: result.shortlisted,
          });
        } catch (err: any) {
          return Response.json(
            { ok: false, error: err.message || "Failed to process candidate ingestion" },
            { status: 422 },
          );
        }
      },
    },
  },
});
