import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

async function isValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET ?? ""));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // API routes do their own auth and must return JSON (not redirects).
  if (pathname.startsWith("/api")) return NextResponse.next();

  const authed = await isValid(req.cookies.get("hub_session")?.value);

  if (pathname === "/login") {
    return authed ? NextResponse.redirect(new URL("/production", req.url)) : NextResponse.next();
  }
  if (!authed) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|mov)$).*)",
  ],
};
