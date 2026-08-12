import { createRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@dotlocker/ui";
import { DotlockerBrand, ModeToggle, ThemeVariantSelect } from "@dotlocker/ui-shared";
import { useState } from "react";
import { RootRoute } from "./root";
import { useSession } from "~webui/lib/session";
import { errorMessage } from "~webui/lib/errors";

export const LoginRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/login",
  component: LoginPage,
});

const benefits = [
  ["Scoped", "Organization and runtime access"],
  ["Encrypted", "Files remain protected at rest"],
  ["Audited", "Every operation is recorded"],
] as const;

function KeynameMark() {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--pl-muted)]">
      <span className="grid h-5 w-5 place-items-center rounded-full border border-[var(--pl-line-strong)] text-[10px] font-black text-[var(--pl-text)]">
        +
      </span>
      Secured by Keyname
    </span>
  );
}

function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setError("");
    setLoading(true);
    try {
      await window.Keyname.ready;
      const tokens = await window.Keyname.signIn({
        mode: "modal",
        callbackUri: `${location.origin}/login`,
      });
      if (!tokens) return;
      const accessToken = await window.Keyname.getAccessToken();
      if (!accessToken) throw new Error("Keyname did not return an access token");
      const established = await session.api.establishKeynameSession(accessToken);
      session.setOrg(established.org);
      session.setMe(await session.api.me());
      await navigate({ to: "/" });
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[var(--pl-bg)] px-5 py-12 text-[var(--pl-text)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--pl-grid)_1px,transparent_1px),linear-gradient(90deg,var(--pl-grid)_1px,transparent_1px)] bg-[size:44px_44px] opacity-45 [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--pl-glow-1)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[var(--pl-glow-2)] blur-3xl" />

      <div className="absolute right-5 top-5 z-10 flex items-center gap-2">
        <ThemeVariantSelect />
        <ModeToggle />
      </div>

      <main className="relative z-[1] w-[min(440px,100%)] rounded-[var(--pl-radius-md)] border border-[var(--pl-line)] bg-[var(--pl-elevated)] px-7 py-8 shadow-[0_18px_55px_rgb(0_0_0/.12)] sm:px-9 sm:py-9">
        <div className="mb-7 text-center">
          <div className="mb-6 flex justify-center">
            <DotlockerBrand className="text-[var(--pl-text)]" />
          </div>
          <h1 className="m-0 text-xl font-semibold tracking-[-.025em]">Sign in to dot.locker</h1>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--pl-muted)]">
            Secure file infrastructure for teams, runtimes, and autonomous agents.
          </p>
        </div>

        <div className="mb-5 grid grid-cols-3 divide-x divide-[var(--pl-line)] rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] py-3">
          {benefits.map(([title, subtitle]) => (
            <div key={title} className="px-2 text-center">
              <div className="text-[11px] font-semibold text-[var(--pl-text)]">{title}</div>
              <div className="mt-0.5 hidden text-[9px] leading-3 text-[var(--pl-subtle)] sm:block">
                {subtitle}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div
            id="status"
            role="alert"
            className="mb-4 rounded-[var(--pl-radius-xs)] border border-[color-mix(in_srgb,var(--pl-danger)_40%,var(--pl-line))] bg-[color-mix(in_srgb,var(--pl-danger)_8%,var(--pl-surface))] px-3 py-2.5 text-xs text-[var(--pl-danger)]"
          >
            {error}
          </div>
        )}

        <Button className="w-full" size="lg" disabled={loading} onClick={() => void signIn()}>
          <span aria-hidden className="text-base">
            +
          </span>
          {loading ? "Opening Keyname…" : "Continue with Keyname"}
        </Button>

        <div className="mt-5 flex justify-center">
          <KeynameMark />
        </div>
        <p className="mt-5 border-t border-[var(--pl-line)] pt-4 text-center text-[11px] leading-4 text-[var(--pl-subtle)]">
          Keyname handles credentials, passkeys, providers, and MFA. dot.locker never receives your
          password.
        </p>
      </main>
    </div>
  );
}
