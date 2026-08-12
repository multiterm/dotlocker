import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button, ThemeProvider } from "@dotlocker/ui";
import { DotlockerBrand, ModeToggle } from "@dotlocker/ui-shared";
import "./styles.css";

const features = [
  ["01", "Runtime scoped", "Keep development, preview, and production files isolated by organization, repository, and runtime."],
  ["02", "Agent ready", "Resolve, pull, and push encrypted files over a small HTTP API designed for automation."],
  ["03", "Policy first", "Layer repository and runtime grants with short-lived, narrowly scoped machine tokens."],
  ["04", "Fully audited", "Track reads, writes, deletes, denials, and identity activity without exposing file contents."],
];

function App() {
  const consoleUrl = import.meta.env.VITE_DOTLOCKER_CONSOLE_URL ?? "/login";
  return (
    <div className="min-h-screen overflow-hidden">
      <header className="mx-auto flex h-18 max-w-[1240px] items-center justify-between border-x border-[var(--pl-line)] px-5 md:px-8">
        <DotlockerBrand />
        <nav className="flex items-center gap-3"><a className="hidden text-sm text-[var(--pl-muted)] md:block" href="#platform">Platform</a><ModeToggle /><Button size="sm" onClick={() => location.assign(consoleUrl)}>Open console</Button></nav>
      </header>
      <main>
        <section className="relative mx-auto grid min-h-[680px] max-w-[1240px] place-items-center border border-[var(--pl-line)] px-6 py-24 text-center">
          <div className="hero-grid absolute inset-0 opacity-60" />
          <div className="relative max-w-[900px]">
            <p className="mb-6 text-xs font-bold uppercase tracking-[.18em] text-[var(--pl-primary)]">Secure file infrastructure</p>
            <h1 className="m-0 font-[var(--pl-font-display)] text-[clamp(3.4rem,9vw,7.5rem)] font-black leading-[.88] tracking-[-.085em]">Files for every<br />runtime.</h1>
            <p className="mx-auto mt-8 max-w-[640px] text-lg leading-8 text-[var(--pl-muted)]">dot.locker gives teams and agents one encrypted, scoped, auditable home for the files that make software run.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3"><Button size="lg" onClick={() => location.assign(consoleUrl)}>Continue with Keyname →</Button><a className="inline-flex min-h-11 items-center rounded-[var(--pl-radius-xs)] border border-[var(--pl-line)] bg-[var(--pl-surface)] px-5 text-sm font-semibold" href="#platform">Explore dot.locker</a></div>
            <p className="mt-5 text-xs text-[var(--pl-subtle)]">Authentication and identity secured by keyname.dev</p>
          </div>
        </section>
        <section id="platform" className="mx-auto max-w-[1240px] border-x border-[var(--pl-line)]">
          <div className="grid md:grid-cols-2">
            {features.map(([number, title, body]) => <article key={number} className="min-h-64 border-b border-[var(--pl-line)] p-8 md:border-r"><span className="font-[var(--pl-font-mono)] text-xs text-[var(--pl-subtle)]">+ {number}</span><h2 className="mt-14 text-2xl font-semibold tracking-tight">{title}</h2><p className="max-w-md leading-7 text-[var(--pl-muted)]">{body}</p></article>)}
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-[1240px] items-center justify-between border border-[var(--pl-line)] p-6 text-xs text-[var(--pl-subtle)]"><DotlockerBrand className="text-sm" /><span>Identity by Keyname · Data by dot.locker</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><App /></ThemeProvider></StrictMode>);
