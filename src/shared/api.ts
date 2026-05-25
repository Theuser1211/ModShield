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
  Ban: "/api/ban",
  Timeout: "/api/timeout",
  Logs: "/api/logs",
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
  contentType: "post" | "comment" | "unknown";
  subredditName: string;
  timestamp: string;
  action: "report" | "reset" | "mute" | "alert" | "ban" | "timeout";
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

export interface BanRequest {
  username: string;
  reason?: string;
  note?: string;
}

export interface BanResponse {
  type: "ban";
  success: boolean;
  username: string;
}

export interface TimeoutRequest {
  username: string;
  durationDays: number;
  reason?: string;
  note?: string;
}

export interface TimeoutResponse {
  type: "timeout";
  success: boolean;
  username: string;
  durationDays: number;
}

export interface LogsData {
  type: "logs";
  entries: ActivityEntry[];
  total: number;
}

export interface ErrorResponse {
  error: string;
  status: number;
}
