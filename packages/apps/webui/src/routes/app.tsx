import { createRoute, Outlet } from "@tanstack/react-router";
import { RootRoute } from "./root";
import { AppShell } from "~webui/components/AppShell";

export const AppRoute = createRoute({
  getParentRoute: () => RootRoute,
  id: "app",
  component: AppShell,
});
