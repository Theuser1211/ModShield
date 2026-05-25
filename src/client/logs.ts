/**
 * ModShield — Full Activity Log client
 *
 * Fetches ALL activity entries from the server API,
 * renders them in a filterable table with auto-refresh.
 */

import type { LogsData, ActivityEntry } from "../shared/api.ts";
import { ApiEndpoint } from "../shared/api.ts";
import { requestExpandedMode } from "@devvit/web/client";

// ── DOM refs ──────────────────────────────────────────────────────────────

const $totalEntries = document.getElementById("total-entries")!;
const $showingCount = document.getElementById("showing-count")!;
const $tbody = document.getElementById("logs-tbody")!;
const $emptyState = document.getElementById("logs-empty")!;
const $loading = document.getElementById("loading-overlay")!;
const $refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const $lastUpdated = document.getElementById("last-updated")!;
const $toast = document.getElementById("toast")!;
const $btnBack = document.getElementById("btn-back")!;
const $filterBar = document.querySelector(".filter-bar")!;

// ── State ─────────────────────────────────────────────────────────────────

let allEntries: ActivityEntry[] = [];
let activeFilter = "all";

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso || iso === "unknown") return "\u2014";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTimestamp(iso: string): string {
  if (!iso || iso === "unknown") return "\u2014";
  const d = new Date(iso);
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function activityDetail(a: ActivityEntry): string {
  switch (a.action) {
    case "report":
      return `Reported ${a.contentType} in r/${a.subredditName}`;
    case "reset":
      return "Violations reset";
    case "mute":
      return `Auto-muted in r/${a.subredditName}`;
    case "ban":
      return `Permanently banned from r/${a.subredditName}`;
    case "timeout":
      return `Timed out in r/${a.subredditName}`;
    case "alert":
      return `Threshold alert sent to r/${a.subredditName}`;
    default:
      return a.action;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(message: string, type: "success" | "error" = "success"): void {
  $toast.textContent = message;
  $toast.className = `toast show ${type}`;
  setTimeout(() => { $toast.className = "toast"; }, 2400);
}

// ── Render ────────────────────────────────────────────────────────────────

function render(entries: ActivityEntry[]): void {
  $totalEntries.textContent = String(allEntries.length);

  const filtered = activeFilter === "all"
    ? entries
    : entries.filter((e) => e.action === activeFilter);

  $showingCount.textContent = `Showing ${filtered.length} event${filtered.length !== 1 ? "s" : ""}`;

  if (filtered.length === 0) {
    $emptyState.classList.remove("hidden");
    $tbody.innerHTML = "";
  } else {
    $emptyState.classList.add("hidden");
    $tbody.innerHTML = filtered
      .map(
        (a) => `<tr>
          <td>
            <span class="ts-text">${formatTimestamp(a.timestamp)}</span>
            <span class="ts-ago">${timeAgo(a.timestamp)}</span>
          </td>
          <td><span class="action-badge ${a.action}">${a.action}</span></td>
          <td><a class="user-link" href="https://reddit.com/u/${escapeHtml(a.username)}" target="_blank">u/${escapeHtml(a.username)}</a></td>
          <td>${escapeHtml(activityDetail(a))}</td>
          <td>${a.subredditName ? `r/${escapeHtml(a.subredditName)}` : "\u2014"}</td>
        </tr>`
      )
      .join("");
  }

  $lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Data fetch ────────────────────────────────────────────────────────────

async function fetchLogs(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.Logs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as LogsData;
    allEntries = data.entries;
    render(allEntries);
    $loading.classList.add("hidden");
  } catch (err) {
    console.error("[ModShield] Logs fetch failed:", err);
    $loading.classList.add("hidden");
    showToast("Failed to load logs", "error");
  }
}

// ── Filters ──────────────────────────────────────────────────────────────

$filterBar.addEventListener("click", (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains("filter-chip")) return;

  $filterBar.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
  target.classList.add("active");
  activeFilter = target.dataset.filter ?? "all";
  render(allEntries);
});

// ── Back button ──────────────────────────────────────────────────────────

$btnBack.addEventListener("click", (e: MouseEvent) => {
  requestExpandedMode(e, "default");
});

// ── Refresh button ───────────────────────────────────────────────────────

$refreshBtn.addEventListener("click", async () => {
  $refreshBtn.disabled = true;
  await fetchLogs();
  showToast("Logs refreshed", "success");
  $refreshBtn.disabled = false;
});

// ── Auto-refresh every 30s ───────────────────────────────────────────────

setInterval(fetchLogs, 30_000);

// ── Init ─────────────────────────────────────────────────────────────────

fetchLogs();
