"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { findUserByEmail } from "@/lib/repositories/user-repository";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export interface LoginResult {
  success: boolean;
  error?: string;
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  // React Server Actions with client wrapper prefix field names with index
  // Try prefixed names first (1_email, 1_password), fall back to plain names
  const emailRaw = formData.get("1_email") || formData.get("email") || "";
  const passwordRaw =
    formData.get("1_password") || formData.get("password") || "";
  // Ignore stray spaces in the login form. Emails never contain spaces, so
  // strip ALL whitespace from the email (handles a leading/trailing/middle
  // space from autofill, mobile keyboards, or copy-paste). Passwords are
  // trimmed of surrounding whitespace only — internal spaces are preserved so
  // we never silently reject a password that legitimately contains one.
  const rawData = {
    email: String(emailRaw).replace(/\s+/g, ""),
    password: String(passwordRaw).trim(),
  };

  const result = loginSchema.safeParse(rawData);
  if (!result.success) {
    const errors = result.error.errors.map((e) => e.message).join(", ");
    return { success: false, error: errors };
  }

  const { email, password } = result.data;

  const user = await findUserByEmail(email);
  if (!user) return { success: false, error: "Invalid email or password" };
  if (!user.isActive)
    return { success: false, error: "Account is deactivated" };

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) return { success: false, error: "Invalid email or password" };

  await createSession({ userId: user.id, role: user.role, email: user.email });

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
