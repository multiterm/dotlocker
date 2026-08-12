import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PlutoApi, type MeResponse } from "./api";

interface SessionState {
  server: string;
  org: string;
  me: MeResponse | null;
  api: PlutoApi;
  setServer(server: string): void;
  setOrg(org: string): void;
  setMe(me: MeResponse | null): void;
  logout(): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [server, setServerRaw] = useState(() => {
    localStorage.removeItem("dotlocker.server");
    return "";
  });
  const [org, setOrgRaw] = useState(() => localStorage.getItem("dotlocker.org") || "honeycluster");
  const [me, setMe] = useState<MeResponse | null>(null);
  const api = useMemo(() => new PlutoApi(server), [server]);
  const setServer = useCallback((value: string) => {
    localStorage.setItem("dotlocker.server", value);
    setServerRaw(value);
  }, []);
  const setOrg = useCallback((value: string) => {
    localStorage.setItem("dotlocker.org", value);
    setOrgRaw(value);
  }, []);
  const logout = useCallback(() => {
    localStorage.removeItem("dotlocker.token");
    setMe(null);
  }, []);
  const value = useMemo(
    () => ({ server, org, me, api, setServer, setOrg, setMe, logout }),
    [server, org, me, api, setServer, setOrg, logout],
  );
  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
