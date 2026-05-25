/**
 * ModShield — Shared API contract
 *
 * Endpoint URLs and request/response types shared between
 * the server (server.ts) and client (dashboard.ts / preview.ts).
 */

// ─────────────────────────────────────────────
// Endpoint registry
// ─────────────────────────────────────────────

export const ApiEndpoint = {
  Dashboard: "/api/dashboard",
  Reset: "/api/reset",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];

// ─────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────

export interface FlaggedUser {
  username: string;
  violationCount: number;
  lastReport: string;
  firstSeen: string;
  contentType: "post" | "comment" | "unknown";
}

export interface ActivityEntry {
  username: string;
  contentType: "post" | "comment";
  subredditName: string;
  timestamp: string;
  action: "report" | "reset" | "mute";
}

// ─────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────

export interface DashboardData {
  type: "dashboard";
  users: FlaggedUser[];
  totalFlagged: number;
  totalViolations: number;
  threshold: number;
  testMode: boolean;
  enabled: boolean;
  activity: ActivityEntry[];
}

export interface ResetRequest {
  username: string;
}

export interface ResetResponse {
  type: "reset";
  success: boolean;
  username: string;
}

export interface ErrorResponse {
  error: string;
  status: number;
}
