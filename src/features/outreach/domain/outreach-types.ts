export type OutreachChannel = "whatsapp" | "sms" | "email";

export type OutreachStatus = "active" | "opted_out" | "responded" | "screened" | "expired";

export type OutreachMessageDirection = "outbound" | "inbound";

export type OutreachActionType =
  | "proof_of_work_hook"
  | "objection_reply"
  | "screening_prompt"
  | "opt_out_confirm"
  | "sms_fallback"
  | "manual";

export interface OutreachConversation {
  id: string;
  orgId: string;
  candidateId: string;
  candidateName: string;
  phone: string;
  email: string;
  currentRoleId: string;
  channel: OutreachChannel;
  status: OutreachStatus;
  optedOut: boolean;
  optedOutAt: string | null;
  optOutReason: string | null;
  proofOfWorkHook: string;
  companyName: string;
  lastMessageAt: string;
  createdAt: string;
}

export type JsonPrimitive = string | number | boolean | null | undefined;
export type JsonSerializable = JsonPrimitive | string[] | number[];

export interface OutreachMessage {
  id: string;
  conversationId: string;
  direction: OutreachMessageDirection;
  channel: OutreachChannel;
  content: string;
  actionType: OutreachActionType | null;
  deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed";
  metadata: Record<string, JsonSerializable>;
  createdAt: string;
}
