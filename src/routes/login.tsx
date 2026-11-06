import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SOCIAL_PROVIDERS, authClient, authEnabled, signIn } from "@/platform/auth/client";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { VettaMark } from "@/components/vetta-mark";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isPending && user) {
    return <Navigate to="/app" />;
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "up") {
        const { error: err } = await authClient.signUp.email({
          email,
          password,
          name: name.trim() || email.split("@")[0] || "Recruiter",
          callbackURL: "/app",
        });
        if (err) throw new Error(err.message ?? "Could not create account");
      } else {
        const { error: err } = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/app",
        });
        if (err) throw new Error(err.message ?? "Could not sign in");
      }
      window.location.assign("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden flex-col justify-between bg-surface px-12 py-10 lg:flex">
        <Link to="/" className="inline-flex items-center gap-2 text-fg">
          <VettaMark className="size-6" />
          <span className="font-display text-xl">Vetta</span>
        </Link>
        <div className="max-w-md">
          <p className="font-display text-4xl leading-tight tracking-tight">
            Nothing reaches a hiring manager without a human yes.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Ranked slates for Seed to Series B teams in India — engineering, product, GTM, people,
            finance. AI evaluates and ranks candidates against calibrated rubrics. You still own the
            send.
          </p>
        </div>
        <p className="text-xs text-subtle">
          Seed–Series B recruiting · every function · human-gated
        </p>
      </section>

      <section className="relative flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <Link to="/" className="mb-10 inline-flex items-center gap-2 lg:hidden">
          <VettaMark className="size-5" />
          <span className="font-display text-lg">Vetta</span>
        </Link>
        <h1 className="font-display text-3xl tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Your workspace is private. Candidates never see this side.
        </p>

        {authEnabled ? (
          <div className="mt-8 flex max-w-sm flex-col gap-3">
            {SOCIAL_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                onClick={() => signIn(p.providerId, { callbackURL: "/app" })}
              >
                Continue with {p.label}
              </Button>
            ))}

            <div className="relative my-2 text-center text-xs text-subtle">
              <span className="relative z-10 bg-bg px-2">or email</span>
              <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            </div>

            <form className="flex flex-col gap-3" onSubmit={onEmail}>
              {mode === "up" ? (
                <label className="flex flex-col gap-1.5">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <Label>Work email</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                />
              </label>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy}>
                {busy ? "Working…" : mode === "up" ? "Create account" : "Sign in with email"}
              </Button>
            </form>
            <button
              type="button"
              className="text-left text-sm text-muted hover:text-fg"
              onClick={() => setMode((m) => (m === "in" ? "up" : "in"))}
            >
              {mode === "in" ? "Need an account? Create one" : "Already have an account? Sign in"}
            </button>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">Sign-in is disabled.</p>
        )}
      </section>
    </main>
  );
}
