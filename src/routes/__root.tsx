import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AuthProvider } from "@/platform/auth/provider";
import { PreviewHostBridge } from "@/shared/components/preview-host-bridge";
import { AppProviders } from "@/shared/components/providers";
import { AppErrorComponent } from "@/platform/error-component";
import { THEME_BOOT_SCRIPT, THEME_DARK } from "@/platform/theme";
import appCss from "../styles.css?url";

const APP_NAME = "Vetta";

const fetchSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("@/platform/auth/verify.server");
  const u = await getSessionUser();
  return u ? { id: u.id, email: u.email } : null;
});

export const Route = createRootRoute({
  beforeLoad: async () => ({ sessionUser: await fetchSessionUser() }),
  errorComponent: AppErrorComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "AI-native recruiting for Seed to Series B teams in India. Every function — resume in, ranked slate out, with human approval on everything client-facing.",
      },
      { name: "theme-color", content: THEME_DARK },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      // The three type families used to arrive from fonts.googleapis.com here.
      // They are self-hosted now, as `@import` lines inside `src/styles.css`,
      // which this same `appCss` link already carries: the `@font-face` rules
      // stay in the server-rendered head instead of riding in with a later
      // script, and no page in the app waits on a third party to paint.
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" className="dark antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          <AppProviders>
            <Outlet />
          </AppProviders>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
