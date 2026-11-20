import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  joinLaunchWaitlist,
  getWaitlistStatus,
  type WaitlistStatusResult,
} from "../server/waitlist.server";

const JoinWaitlistSchema = z.object({
  email: z.string().email(),
  founderName: z.string().optional(),
  companyName: z.string().optional(),
  roleTitle: z.string().optional(),
  referredByCode: z.string().optional(),
});

export const joinWaitlistFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => JoinWaitlistSchema.parse(d))
  .handler(async ({ data }): Promise<WaitlistStatusResult> => {
    return joinLaunchWaitlist(data);
  });

export const getWaitlistStatusFn = createServerFn({ method: "GET" })
  .validator((emailOrCode: unknown) => z.string().min(1).parse(emailOrCode))
  .handler(async ({ data }): Promise<WaitlistStatusResult | null> => {
    return getWaitlistStatus(data);
  });
