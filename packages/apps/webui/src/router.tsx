import { createRouter } from "@tanstack/react-router";
import { RootRoute } from "./routes/root";
import { LoginRoute } from "./routes/login";
import { AppRoute } from "./routes/app";
import { OverviewRoute } from "./routes/overview";
import { FilesRoute } from "./routes/files";
import { ReposRoute } from "./routes/repos";
import { TokensRoute, UsersRoute } from "./routes/admin";
import { LogsRoute } from "./routes/logs";
import { SettingsLayoutRoute } from "./routes/settings-layout";
import { SettingsRoute } from "./routes/settings";
import { WebhooksRoute } from "./routes/webhooks";
import { IntegrationsRoute } from "./routes/integrations";
import { RuntimeReleasesRoute } from "./routes/runtime-releases";
import { StorageRoute } from "./routes/storage";

const appTree = AppRoute.addChildren([
  OverviewRoute,
  FilesRoute,
  RuntimeReleasesRoute,
  StorageRoute,
  ReposRoute,
  SettingsLayoutRoute.addChildren([
    SettingsRoute,
    UsersRoute,
    TokensRoute,
    LogsRoute,
    WebhooksRoute,
    IntegrationsRoute,
  ]),
]);
const routeTree = RootRoute.addChildren([LoginRoute, appTree]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
