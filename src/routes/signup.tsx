import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SOCIAL_PROVIDERS, authClient, authEnabled, signIn } from "@/platform/auth/client";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { VettaMark } from "@/shared/components/vetta-mark";
import { TermsOfServiceLink, DpaLink } from "@/features/compliance/ui/legal-terms-dialog";

export const Route = createFileRoute("/signup")({ component: Signup });

function Signup() {
  const { user, isPending } = useCurrentUserState();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isPending && user) {
    return <Navigate to="/app" />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await authClient.signUp.email({
        email,
        password,
        name: name.trim() || email.split("@")[0] || "Founder",
        callbackURL: "/app/setup",
      });
      if (err) throw new Error(err.message ?? "Could not create account");
      window.location.assign("/app/setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
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
            The founders who hire like operators start here.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Paste your open role, get an evidence-traced shortlist — not a keyword search with a
            nicer font. Every verdict cites the line in the resume that earned it.
          </p>
        </div>
        <p className="text-xs text-subtle">Free for one role · no card · verdicts in minutes</p>
      </section>

      <section className="relative flex flex-col justify-center px-6 py-12 sm:px-12">
        <Link to="/" className="mb-10 inline-flex items-center gap-2 lg:hidden">
          <VettaMark className="size-5" />
          <span className="font-display text-lg">Vetta</span>
        </Link>
        <h1 className="font-display text-3xl tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-muted">
          Then name your workspace and paste your first role — about a minute. Candidates never see
          this side.
        </p>

        {authEnabled ? (
          <div className="mt-8 flex max-w-sm flex-col gap-3">
            {SOCIAL_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                onClick={() => signIn(p.providerId, { callbackURL: "/app/setup" })}
              >
                Continue with {p.label}
              </Button>
            ))}

            <div className="relative my-2 text-center text-xs text-subtle">
              <span className="relative z-10 bg-bg px-2">or email</span>
              <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            </div>

            <form className="flex flex-col gap-3" onSubmit={onSubmit}>
              <label className="flex flex-col gap-1.5">
                <Label>Your name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Asha Rao"
                />
              </label>
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
                  autoComplete="new-password"
                />
              </label>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </Button>
            </form>
            <p className="text-sm text-muted">
              Already have an account?{" "}
              <Link to="/login" className="text-fg underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>

            <div className="pt-2 border-t border-border/50 text-[11px] text-muted leading-relaxed">
              By continuing, you agree to Vetta's{" "}
              <TermsOfServiceLink className="font-semibold text-blue-600 dark:text-blue-400" /> and
              the statutory{" "}
              <DpaLink className="font-semibold text-blue-600 dark:text-blue-400" /> under the DPDP
              Act 2023.
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">Sign-up is disabled.</p>
        )}
      </section>
    </main>
  );
}
