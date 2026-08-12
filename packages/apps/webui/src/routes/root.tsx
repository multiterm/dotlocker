import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SessionProvider } from "~webui/lib/session";
import "~webui/styles/app.css";

export const RootRoute = createRootRoute({
  component: () => (
    <SessionProvider>
      <Outlet />
    </SessionProvider>
  ),
});
