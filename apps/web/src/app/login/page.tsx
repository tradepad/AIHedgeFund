import { DEV_USERS, authMode } from "@/lib/session";
import { signIn } from "./actions";

export const metadata = { title: "Sign in · ARF-OS" };

export default function LoginPage() {
  if (authMode() !== "dev") {
    return (
      <main className="login">
        <h1>ARF-OS</h1>
        <p>Clerk sign-in is configured on the API. The web sign-in flow for Clerk is not part of this release.</p>
      </main>
    );
  }
  return (
    <main className="login">
      <h1>ARF-OS</h1>
      <p className="muted">Development sign-in. These seeded identities exist only in development and test databases.</p>
      <div className="login-grid">
        {DEV_USERS.map((u) => (
          <form key={u.subject} action={signIn}>
            <input type="hidden" name="subject" value={u.subject} />
            <button type="submit" className="login-card" data-testid={`login-${u.subject.slice(4)}`}>
              <strong>{u.label}</strong>
              <span className="muted">{u.roles}</span>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
