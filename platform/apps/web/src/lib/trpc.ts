import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@avilo/api/src/router.js";

/**
 * Same-origin: Vite proxies /trpc to the local API in development, and the API serves
 * the bundle itself when hosted. Either way the browser makes no cross-origin request
 * and the application has no notion of a remote host.
 */
export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      fetch: async (input, init) => {
        // Carry the session cookie when there is one. Inert on loopback, where no gate
        // is configured and no cookie is ever set.
        const response = await fetch(input, { ...init, credentials: "same-origin" });

        // An expired session has to land on the login page. Left alone it would surface
        // as a JSON parse error somewhere deep in a component, which tells the user
        // nothing about the one thing they need to do.
        if (response.status === 401) {
          window.location.assign("/login");
          // Deliberately never settles: the navigation is already under way, and
          // resolving would let components render an error state for a page that is
          // being replaced.
          await new Promise(() => {});
        }
        return response;
      },
    }),
  ],
});

export type { AppRouter };
