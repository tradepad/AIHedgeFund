"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEV_USERS, SESSION_COOKIE, authMode, encodeSession } from "@/lib/session";

export async function signIn(formData: FormData): Promise<void> {
  if (authMode() !== "dev") throw new Error("development sign-in is disabled");
  const subject = formData.get("subject");
  const known = DEV_USERS.find((u) => u.subject === subject);
  if (!known) throw new Error("unknown development user");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession({ subject: known.subject, org: "arf-dev" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 3600,
  });
  redirect("/");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
