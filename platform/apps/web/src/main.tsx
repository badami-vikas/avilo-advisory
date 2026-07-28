import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useRouteError } from "react-router";

import "./styles/app.css";
import { Shell } from "./app/Shell.js";
import { ClientsPage } from "./app/pages/ClientsPage.js";
import { ClientDetailPage } from "./app/pages/ClientDetailPage.js";

/**
 * A render failure in one cell should not blank the application. The boundary reports
 * the error honestly rather than showing an empty screen.
 */
function RouteError() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : "Something went wrong rendering this page.";
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-[16px] font-semibold text-ink">This page failed to render</h1>
      <p className="mt-2 text-[13px] text-ink-muted">{message}</p>
      <p className="mt-4 text-[12.5px] text-ink-faint">
        Your data is unaffected — it lives in the local database, not in this page.
      </p>
      <button
        onClick={() => window.location.assign("/")}
        className="mt-5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white"
      >
        Back to clients
      </button>
    </div>
  );
}

// Every surface is a routable URL — deep linking is required by the platform's UI rules.
const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ClientsPage /> },
      { path: "client/:clientId", element: <ClientDetailPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
