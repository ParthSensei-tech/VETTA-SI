import { createServerFn } from "@tanstack/react-start";
import type { PublicIndex } from "../domain/vetta-index";

export type { PublicIndex } from "../domain/vetta-index";

/**
 * The wire for the Vetta Index. GET with no validator and no auth, because this
 * is the one endpoint we are asking the world to call: an AI engine citing our
 * median and a founder checking it on `/data` must both get the same stored
 * snapshot, and neither of them has a session.
 *
 * It is deliberately the only public read that returns aggregate numbers. The
 * payload is decided in `public-index.server.ts`, where the floors live, so
 * there is no route that can render a statistic the gate refused.
 */
export const getPublicIndex = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicIndex> => {
    const { readPublicIndex } = await import("../server/public-index.server.ts");
    return readPublicIndex();
  },
);
