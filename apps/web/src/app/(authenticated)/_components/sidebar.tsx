"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRegisterKeybind } from "../_lib/keybinds";
import { logoutAction } from "@/app/actions/auth";
import type { JWTPayload } from "@/lib/auth/jwt";
import { isTutorialScopedRole } from "@/lib/auth/rbac";

const NAV_ITEMS = [
  { href: "/production", label: "Tutorial Studio", icon: "smart_display" },
];

interface Props {
  session: JWTPayload;
}

export function AppSidebar({ session }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  useRegisterKeybind(
    { key: "g+d", description: "Go to Dashboard", category: "Navigation" },
    () => router.push("/dashboard"),
    [],
  );
  useRegisterKeybind(
    { key: "g+j", description: "Go to Jobs", category: "Navigation" },
    () => router.push("/jobs"),
    [],
  );
  useRegisterKeybind(
    { key: "g+f", description: "Go to Formats", category: "Navigation" },
    () => router.push("/formats"),
    [],
  );
  useRegisterKeybind(
    { key: "g+c", description: "Go to Channels", category: "Navigation" },
    () => router.push("/channels"),
    [],
  );
  useRegisterKeybind(
    { key: "g+a", description: "Go to Analytics", category: "Navigation" },
    () => router.push("/analytics"),
    [],
  );
  useRegisterKeybind(
    { key: "g+u", description: "Go to Upload Queue", category: "Navigation" },
    () => router.push("/uploading"),
    [],
  );
  useRegisterKeybind(
    {
      key: "g+p",
      description: "Go to Tutorial Studio",
      category: "Navigation",
    },
    () => router.push("/production"),
    [],
  );
  useRegisterKeybind(
    { key: "g+v", description: "Go to Video Stitcher", category: "Navigation" },
    () => router.push("/video-stitcher"),
    [],
  );
  useRegisterKeybind(
    { key: "g+k", description: "Go to Knowledge", category: "Navigation" },
    () => router.push("/knowledge"),
    [],
  );
  useRegisterKeybind(
    { key: "g+h", description: "Go to System Health", category: "Navigation" },
    () => router.push("/system-health"),
    [],
  );
  useRegisterKeybind(
    { key: "g+m", description: "Go to Team", category: "Navigation" },
    () => router.push("/team"),
    [],
  );
  useRegisterKeybind(
    { key: "n", description: "New Job", category: "Jobs" },
    () => router.push("/jobs/create"),
    [],
  );

  const userInitial = session.email[0].toUpperCase();
  // Tutorial VAs see the tool itself, the Video Stitcher (to stitch their
  // recorded clips), and the Knowledge base (which courses they actually see is
  // scoped per-course via allowed_roles) — hide every other nav entry.
  const tutorialScoped = isTutorialScopedRole(session.role);
  const TUTORIAL_VA_HREFS = new Set([
    "/production",
    "/video-stitcher",
    "/knowledge",
  ]);
  const visibleNav = tutorialScoped
    ? NAV_ITEMS.filter((item) => TUTORIAL_VA_HREFS.has(item.href))
    : NAV_ITEMS;

  return (
    <aside
      className="fixed left-0 top-0 h-full z-50 flex flex-col py-8"
      style={{
        width: 256,
        backgroundColor: "#000",
        borderRight: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
      }}
    >
      {/* Logo */}
      <div className="px-6 mb-10">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
              boxShadow: "0 0 15px rgba(var(--v2-accent-rgb), 0.4)",
            }}
          >
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
            >
              bolt
            </span>
          </div>
          <div>
            <h2
              style={{
                color: "#e5e2e1",
                fontSize: 17,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              Pulse Console
            </h2>
            <p
              style={{
                color: "rgba(var(--v2-accent-rgb), 0.6)",
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                marginTop: 3,
              }}
            >
              Simple Tutorial Tool
            </p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto min-h-0">
        {visibleNav.map(({ href, label, icon, external }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              className={`v2-nav-item flex items-center px-4 py-3${isActive ? " v2-nav-active" : ""}`}
              style={
                isActive
                  ? {
                      background:
                        "linear-gradient(to right, rgba(var(--v2-accent-rgb), 0.20), transparent)",
                      borderLeft: "4px solid var(--v2-accent)",
                      color: "var(--v2-accent)",
                      boxShadow: "0 0 15px rgba(var(--v2-accent-rgb), 0.15)",
                    }
                  : {
                      color: "rgba(229,226,225,0.4)",
                      borderLeft: "4px solid transparent",
                    }
              }
            >
              <span
                className="material-symbols-outlined mr-3"
                style={{
                  fontSize: 20,
                  color: isActive
                    ? "var(--v2-accent)"
                    : "rgba(229,226,225,0.4)",
                }}
              >
                {icon}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: isActive
                    ? "var(--v2-accent)"
                    : "rgba(229,226,225,0.4)",
                }}
              >
                {label}
              </span>
              {external && (
                <span
                  className="material-symbols-outlined ml-auto"
                  style={{ fontSize: 12, color: "rgba(229,226,225,0.3)" }}
                >
                  open_in_new
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: New Job CTA + user info */}
      <div className="px-6 mt-auto space-y-4">
        {!tutorialScoped && (
          <Link
            href="/jobs/create"
            className="v2-glow-primary w-full py-3 rounded-lg flex items-center justify-center gap-2 text-white text-xs font-bold uppercase tracking-widest"
            style={{
              background:
                "linear-gradient(to right, var(--v2-accent), var(--v2-accent-dim))",
              boxShadow: "0 4px 15px rgba(var(--v2-accent-rgb), 0.3)",
              display: "flex",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              add
            </span>
            New Job
          </Link>
        )}

        <div
          className="pt-4"
          style={{ borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.10)" }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
              }}
            >
              {userInitial}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  color: "#e5e2e1",
                  fontSize: 11,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {session.email}
              </div>
              <div
                style={{
                  color: "#cdc3d7",
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {session.role.replace(/_/g, " ")}
              </div>
            </div>
          </div>
          <form
            action={logoutAction as unknown as string}
            style={{ width: "100%" }}
          >
            <button
              type="submit"
              className="v2-btn"
              style={{
                width: "100%",
                justifyContent: "flex-start",
                padding: "7px 10px",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                logout
              </span>
              <span>Logout</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
