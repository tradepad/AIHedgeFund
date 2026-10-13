import type { ReactNode } from "react";
import Link from "next/link";
import { currentSession, userLabel } from "@/lib/session";
import { signOut } from "./login/actions";
import "./globals.css";

export const metadata = {
  title: "ARF-OS",
  description: "Research operating system for systematic strategies",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body>
        {session ? (
          <header className="topbar">
            <Link href="/" className="brand">
              ARF-OS
            </Link>
            <nav aria-label="Primary">
              <Link href="/">Command Centre</Link>
              <Link href="/campaigns">Campaigns</Link>
              <Link href="/strategies">Strategy Library</Link>
            </nav>
            <div className="who">
              <span data-testid="current-user">{userLabel(session.subject)}</span>
              <span className="muted">{session.org}</span>
              <form action={signOut}>
                <button type="submit" className="link">
                  Sign out
                </button>
              </form>
            </div>
          </header>
        ) : null}
        <div className="banner" role="note">
          Research platform. Results are historical simulations or paper evidence, never live
          performance or a guarantee.
        </div>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
