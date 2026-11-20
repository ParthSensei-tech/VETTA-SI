import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  generateFounderDailyBrief,
  type FounderDailyBriefing,
} from "../server/daily-briefing.server";

export const getFounderDailyBriefFn = createServerFn({ method: "GET" })
  .validator((orgId: unknown) => z.string().min(1).parse(orgId))
  .handler(async ({ data }): Promise<FounderDailyBriefing> => {
    return generateFounderDailyBrief(data);
  });
