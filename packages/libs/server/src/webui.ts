// #region -- Built-in Web UI -------------------------------

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function webUiHtml(): string {
  const built = builtWebUiHtml();
  if (built) return built;
  return `<!doctype html>
<html lang="en" data-theme="Mono" data-mode="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dotbase Console</title>
  <script src="https://api.keyname.dev/auth.js"></script>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#050505; color:#fafafa; }
    * { box-sizing:border-box; } body { min-height:100vh; margin:0; display:grid; place-items:center; padding:24px; }
    main { width:min(560px,100%); border:1px solid rgb(255 255 255/.14); background:#0c0c0c; padding:32px; }
    h1 { margin:0 0 12px; font-size:36px; letter-spacing:-.055em; } p { color:#a3a3a3; line-height:1.6; }
    button { width:100%; margin-top:18px; border:1px solid #f5f5f5; border-radius:8px; background:#f5f5f5; color:#050505; padding:12px 16px; font:inherit; font-size:14px; font-weight:700; cursor:pointer; }
    #status { min-height:20px; font-size:13px; }
  </style>
</head>
<body>
  <main>
    <strong>+ PLUTO</strong>
    <h1>Secure file console</h1>
    <p>The dashboard bundle is not installed. Sign in with Keyname, or build <code>@multiterm/pluto-webui</code> for the full console.</p>
    <button id="login">Continue with Keyname</button>
    <p id="status"></p>
  </main>
  <script>
    document.getElementById('login').onclick = async () => {
      const status = document.getElementById('status');
      try {
        await Keyname.ready;
        const result = await Keyname.signIn({ mode:'modal', callbackUri:location.origin + '/login' });
        if (!result) return;
        const token = await Keyname.getAccessToken();
        const response = await fetch('/v1/auth/keyname/session', { method:'POST', headers:{ authorization:'Bearer ' + token } });
        if (!response.ok) throw await response.json();
        location.reload();
      } catch (error) {
        status.textContent = error && (error.error || error.message) || 'Keyname sign-in failed.';
      }
    };
  </script>
</body>
</html>`;
}

export function webUiAssetPath(assetPath: string): string | null {
  const safe = assetPath.replace(/^\/+/, "");
  if (safe.includes("..")) return null;
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "webui");
  const full = join(root, safe);
  return existsSync(full) ? full : null;
}

function builtWebUiHtml(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  if (here.endsWith("/src/server")) return null;
  const file = join(here, "..", "webui", "index.html");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

// #endregion ------------------------------------------------
