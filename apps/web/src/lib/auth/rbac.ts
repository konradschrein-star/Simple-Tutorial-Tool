import type { JWTPayload } from "./jwt";

/**
 * Single-admin access model. The one configured account can do everything, so
 * permissions are free-form strings and every check passes for a valid session.
 * Kept as functions so existing call sites work unchanged.
 */
export type Permission = string;

export function hasPermission(session: JWTPayload | null, _permission: Permission): boolean {
  return Boolean(session);
}
export function canAccessRoute(session: JWTPayload | null, _pathname: string): boolean {
  return Boolean(session);
}
export function isTutorialScopedRole(_role: string | undefined): boolean {
  return false;
}
export function isDramaScopedRole(_role: string | undefined): boolean {
  return false;
}
export function getRolePermissions(_role: string): Permission[] {
  return [];
}
