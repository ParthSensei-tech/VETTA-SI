/**
 * Omnichannel Outreach Engine (WhatsApp Primary -> SMS Fallback -> Email Official)
 * 
 * Manages candidate messaging across channels, coordinates proof-of-work outreach,
 * handles 1-click opt-out to safeguard telecom/WhatsApp quality scores,
 * and maintains a unified chronological communication timeline.
 */

import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";
import {
  buildOptOutConfirmationMessage,
  buildProofOfWorkWhatsAppHook,
  buildSmsFallbackMessage,
  type HookParameters,
} from "../domain/whatsapp-templates.ts";
import type {
  JsonSerializable,
  OutreachActionType,
  OutreachChannel,
  OutreachConversation,
  OutreachMessage,
  OutreachStatus,
} from "../domain/outreach-types.ts";

export async function getOrCreateConversation(input: {
  orgId: string;
  candidateId: string;
  candidateName: string;
  phone: string;
  email?: string;
  roleId: string;
  companyName: string;
  proofOfWorkHook?: string;
}): Promise<OutreachConversation> {
  const sql = await getSql();
  const normalizedPhone = input.phone.replace(/[^0-9+]/g, "");

  const existing = await sql<{
    id: string;
    org_id: string;
    candidate_id: string;
    candidate_name: string;
    phone: string;
    email: string;
    current_role_id: string;
    channel: string;
    status: string;
    opted_out: boolean;
    opted_out_at: string | null;
    opt_out_reason: string | null;
    proof_of_work_hook: string;
    company_name: string;
    last_message_at: string;
    created_at: string;
  }>`
    select * from outreach_conversations
    where org_id = ${input.orgId} and candidate_id = ${input.candidateId}
    limit 1`;

  if (existing[0]) {
    const e = existing[0];
    return {
      id: e.id,
      orgId: e.org_id,
      candidateId: e.candidate_id,
      candidateName: e.candidate_name,
      phone: e.phone,
      email: e.email,
      currentRoleId: e.current_role_id,
      channel: e.channel as OutreachChannel,
      status: e.status as OutreachStatus,
      optedOut: Boolean(e.opted_out),
      optedOutAt: e.opted_out_at,
      optOutReason: e.opt_out_reason,
      proofOfWorkHook: e.proof_of_work_hook,
      companyName: e.company_name,
      lastMessageAt: e.last_message_at,
      createdAt: e.created_at,
    };
  }

  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await sql`
    insert into outreach_conversations (
      id, org_id, candidate_id, candidate_name, phone, email, current_role_id,
      channel, status, opted_out, proof_of_work_hook, company_name, last_message_at, created_at
    ) values (
      ${id}, ${input.orgId}, ${input.candidateId}, ${input.candidateName},
      ${normalizedPhone}, ${input.email ?? ""}, ${input.roleId}, 'whatsapp', 'active',
      false, ${input.proofOfWorkHook ?? ""}, ${input.companyName}, now(), now()
    )`;

  return {
    id,
    orgId: input.orgId,
    candidateId: input.candidateId,
    candidateName: input.candidateName,
    phone: normalizedPhone,
    email: input.email ?? "",
    currentRoleId: input.roleId,
    channel: "whatsapp",
    status: "active",
    optedOut: false,
    optedOutAt: null,
    optOutReason: null,
    proofOfWorkHook: input.proofOfWorkHook ?? "",
    companyName: input.companyName,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

export async function appendMessage(input: {
  conversationId: string;
  direction: "outbound" | "inbound";
  channel: OutreachChannel;
  content: string;
  actionType?: OutreachActionType;
  deliveryStatus?: "pending" | "sent" | "delivered" | "read" | "failed";
  metadata?: Record<string, JsonSerializable>;
}): Promise<OutreachMessage> {
  const sql = await getSql();
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const status = input.deliveryStatus ?? "sent";

  await sql`
    insert into outreach_messages (
      id, conversation_id, direction, channel, content, action_type, delivery_status, metadata_json, created_at
    ) values (
      ${id}, ${input.conversationId}, ${input.direction}, ${input.channel},
      ${input.content}, ${input.actionType ?? null}, ${status},
      ${JSON.stringify(input.metadata ?? {})}, now()
    )`;

  await sql`
    update outreach_conversations
    set last_message_at = now()
    where id = ${input.conversationId}`;

  return {
    id,
    conversationId: input.conversationId,
    direction: input.direction,
    channel: input.channel,
    content: input.content,
    actionType: input.actionType ?? null,
    deliveryStatus: status,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}

/**
 * Initiates primary WhatsApp Proof-of-Work outreach with candidate
 */
export async function dispatchProofOfWorkHook(input: {
  orgId: string;
  candidateId: string;
  candidateName: string;
  phone: string;
  email?: string;
  roleId: string;
  companyName: string;
  companyFunding?: string;
  roleTitle: string;
  fixedLpa: number | string;
  proofOfWorkContext?: string;
}): Promise<{ conversation: OutreachConversation; message: OutreachMessage }> {
  const hook = buildProofOfWorkWhatsAppHook({
    candidateName: input.candidateName,
    companyName: input.companyName,
    companyFunding: input.companyFunding,
    roleTitle: input.roleTitle,
    fixedLpa: input.fixedLpa,
    proofOfWorkContext: input.proofOfWorkContext,
  });

  const conversation = await getOrCreateConversation({
    orgId: input.orgId,
    candidateId: input.candidateId,
    candidateName: input.candidateName,
    phone: input.phone,
    email: input.email,
    roleId: input.roleId,
    companyName: input.companyName,
    proofOfWorkHook: hook.bodyText,
  });

  if (conversation.optedOut) {
    throw new Error("Candidate has previously opted out of communications");
  }

  const message = await appendMessage({
    conversationId: conversation.id,
    direction: "outbound",
    channel: "whatsapp",
    content: hook.bodyText,
    actionType: "proof_of_work_hook",
    deliveryStatus: "delivered",
    metadata: {
      quickReplies: hook.quickReplyOptions,
      companyName: input.companyName,
      roleTitle: input.roleTitle,
    },
  });

  return { conversation, message };
}

/**
 * Handles incoming candidate message or button click webhook
 */
export async function handleInboundCandidateReply(input: {
  phone: string;
  text: string;
  channel?: OutreachChannel;
}): Promise<{
  conversationId: string;
  optedOut: boolean;
  replyMessage?: string;
}> {
  const sql = await getSql();
  const normalizedPhone = input.phone.replace(/[^0-9+]/g, "");

  const convs = await sql<{
    id: string;
    org_id: string;
    candidate_name: string;
    opted_out: boolean;
  }>`
    select id, org_id, candidate_name, opted_out
    from outreach_conversations
    where phone = ${normalizedPhone}
    order by last_message_at desc
    limit 1`;

  const conv = convs[0];
  if (!conv) {
    return { conversationId: "", optedOut: false };
  }

  const channel = input.channel ?? "whatsapp";
  const textClean = input.text.trim();

  // 1. Record incoming candidate message
  await appendMessage({
    conversationId: conv.id,
    direction: "inbound",
    channel,
    content: textClean,
    actionType: "manual",
  });

  // 2. Check 1-Click Opt-Out or negative intent
  const isOptOut =
    /not looking/i.test(textClean) ||
    /unsubscribe/i.test(textClean) ||
    /stop/i.test(textClean) ||
    /do not contact/i.test(textClean);

  if (isOptOut) {
    await sql`
      update outreach_conversations
      set opted_out = true,
          status = 'opted_out',
          opted_out_at = now(),
          opt_out_reason = ${textClean}
      where id = ${conv.id}`;

    const confirmationText = buildOptOutConfirmationMessage(conv.candidate_name);
    await appendMessage({
      conversationId: conv.id,
      direction: "outbound",
      channel,
      content: confirmationText,
      actionType: "opt_out_confirm",
    });

    return {
      conversationId: conv.id,
      optedOut: true,
      replyMessage: confirmationText,
    };
  }

  // 3. Mark conversation as responded
  await sql`
    update outreach_conversations
    set status = 'responded'
    where id = ${conv.id} and status = 'active'`;

  return {
    conversationId: conv.id,
    optedOut: false,
  };
}

/**
 * Checks for conversations where primary WhatsApp remained unread > 6 hours
 * and triggers fallback transactional SMS
 */
export async function triggerSmsFallbackIfNeeded(input: {
  conversationId: string;
  portalUrl: string;
  roleTitle: string;
}): Promise<OutreachMessage | null> {
  const sql = await getSql();
  const convs = await sql<{
    id: string;
    candidate_name: string;
    company_name: string;
    status: string;
    opted_out: boolean;
    last_message_at: string;
  }>`
    select * from outreach_conversations
    where id = ${input.conversationId}
    limit 1`;

  const conv = convs[0];
  if (!conv || conv.opted_out || conv.status !== "active") return null;

  // Check if unread for at least 6 hours (in ms: 6 * 3600 * 1000 = 21,600,000)
  const lastMsgTime = new Date(conv.last_message_at).getTime();
  const elapsed = Date.now() - lastMsgTime;
  const SIX_HOURS = 6 * 3600 * 1000;

  if (elapsed < SIX_HOURS) return null;

  const smsText = buildSmsFallbackMessage({
    candidateName: conv.candidate_name,
    companyName: conv.company_name,
    roleTitle: input.roleTitle,
    portalUrl: input.portalUrl,
  });

  return appendMessage({
    conversationId: conv.id,
    direction: "outbound",
    channel: "sms",
    content: smsText,
    actionType: "sms_fallback",
  });
}

/**
 * Retrieves the full unified communication timeline for a conversation
 */
export async function getConversationTimeline(conversationId: string): Promise<{
  conversation: OutreachConversation;
  messages: OutreachMessage[];
}> {
  const sql = await getSql();
  const convs = await sql<any>`
    select * from outreach_conversations where id = ${conversationId} limit 1`;
  const conv = convs[0];
  if (!conv) throw new Error("Conversation not found");

  const msgRows = await sql<any>`
    select * from outreach_messages
    where conversation_id = ${conversationId}
    order by created_at asc`;

  const messages: OutreachMessage[] = msgRows.map((m: any) => ({
    id: m.id,
    conversationId: m.conversation_id,
    direction: m.direction,
    channel: m.channel,
    content: m.content,
    actionType: m.action_type,
    deliveryStatus: m.delivery_status,
    metadata: parseJson(m.metadata_json, {}),
    createdAt: m.created_at,
  }));

  return {
    conversation: {
      id: conv.id,
      orgId: conv.org_id,
      candidateId: conv.candidate_id,
      candidateName: conv.candidate_name,
      phone: conv.phone,
      email: conv.email,
      currentRoleId: conv.current_role_id,
      channel: conv.channel,
      status: conv.status,
      optedOut: Boolean(conv.opted_out),
      optedOutAt: conv.opted_out_at,
      optOutReason: conv.opt_out_reason,
      proofOfWorkHook: conv.proof_of_work_hook,
      companyName: conv.company_name,
      lastMessageAt: conv.last_message_at,
      createdAt: conv.created_at,
    },
    messages,
  };
}
