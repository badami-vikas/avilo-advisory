import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@avilo/api/src/router.js";

/**
 * Same-origin: Vite proxies /trpc to the local API, so the browser makes no
 * cross-origin request and the application has no notion of a remote host.
 */
export const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })],
});

export type { AppRouter };
