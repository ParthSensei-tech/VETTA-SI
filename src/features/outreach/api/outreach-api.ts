import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import {
  dispatchProofOfWorkHook,
  getConversationTimeline,
  handleInboundCandidateReply,
} from "../server/outreach.server";

export const sendCandidateOutreachAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        candidateId: z.string().min(1),
        candidateName: z.string().min(1),
        phone: z.string().min(6),
        email: z.string().optional(),
        roleId: z.string().min(1),
        companyName: z.string().min(1),
        companyFunding: z.string().optional(),
        roleTitle: z.string().min(1),
        fixedLpa: z.union([z.number(), z.string()]),
        proofOfWorkContext: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { ensureUserOrg } = await import("@/features/people/server/org.server");
    const org = await ensureUserOrg(context.userId);
    return dispatchProofOfWorkHook({
      ...data,
      orgId: org.orgId,
    });
  });

export const getOutreachThreadAction = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ conversationId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    return getConversationTimeline(data.conversationId);
  });

export const simulateInboundCandidateReplyAction = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        phone: z.string().min(6),
        text: z.string().min(1),
        channel: z.enum(["whatsapp", "sms", "email"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    return handleInboundCandidateReply(data);
  });
