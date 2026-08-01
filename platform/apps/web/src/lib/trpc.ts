import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { HostRouter } from "@avilo/api/src/host.js";

/**
 * Same-origin, always. The desktop shell serves the bundle and the API from one loopback
 * origin; in development Vite proxies /trpc to the same place. Either way the browser
 * makes no cross-origin request and the application has no notion of a remote host.
 */
const client = createTRPCClient<HostRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      fetch: async (input, init) => {
        // Carry the session cookie when there is one. Inert on the desktop and on
        // loopback, where no gate is configured and no cookie is ever set.
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

/**
 * The Avilo module's slice of the host.
 *
 * The wire path is now `/trpc/avilo.clients.list` — the module id is part of every call,
 * because the host mounts modules by name. Narrowing to it here is what lets every
 * existing call site keep reading `api.clients.list`: the day a second module is
 * registered it gets its own export beside this one, rather than forcing a rename
 * through every component in the app.
 */
export const api = client.avilo;

export type { HostRouter };
