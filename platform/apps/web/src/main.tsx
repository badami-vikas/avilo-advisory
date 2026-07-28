import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import "./styles/app.css";
import { Shell } from "./app/Shell.js";
import { ClientsPage } from "./app/pages/ClientsPage.js";
import { ClientDetailPage } from "./app/pages/ClientDetailPage.js";

// Every surface is a routable URL — deep linking is required by the platform's UI rules.
const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
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
