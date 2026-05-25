/**
 * ModShield — Compact Preview Client
 *
 * Fetches summary stats and renders a teaser card.
 * "Open Dashboard" button transitions to expanded mode.
 */

import { ApiEndpoint, type DashboardData } from "../shared/api.ts";
import { requestExpandedMode } from "@devvit/web/client";

// ── DOM References ────────────────────────────────────────────────────────

const statFlagged = document.getElementById("stat-flagged")!;
const statViolations = document.getElementById("stat-violations")!;
const btnOpen = document.getElementById("btn-open")!;

// ── Fetch summary stats ───────────────────────────────────────────────────

async function fetchStats(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.Dashboard);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DashboardData;

    statFlagged.textContent = String(data.totalFlagged);
    statViolations.textContent = String(data.totalViolations);
  } catch (err) {
    console.error("[ModShield] Preview fetch failed:", err);
    statFlagged.textContent = "?";
    statViolations.textContent = "?";
  }
}

// ── Expand to full dashboard ──────────────────────────────────────────────

btnOpen.addEventListener("click", (e) => {
  requestExpandedMode(e, "dashboard");
});

// ── Init ──────────────────────────────────────────────────────────────────

fetchStats();
