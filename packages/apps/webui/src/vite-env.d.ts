/// <reference types="vite/client" />

declare module "*.css";

interface KeynameTokens {
  token: string;
  refreshToken: string;
  record: { userEmail: string; subject: string; expiresAt: number | null };
}

interface Window {
  Keyname: {
    ready: Promise<KeynameTokens | null>;
    signIn(options: { mode: "modal"; callbackUri: string }): Promise<KeynameTokens | null>;
    getAccessToken(): Promise<string | null>;
    signOut(): Promise<void>;
  };
}
