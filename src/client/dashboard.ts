/**
 * ModShield — Dashboard client
 *
 * Fetches flagged users, stats, and activity from the server API,
 * renders them in the command-center dashboard, and supports per-user
 * reset actions with auto-refresh every 30 seconds.
 */

import type { DashboardData, FlaggedUser, ActivityEntry } from "../shared/api.ts";
import { ApiEndpoint } from "../shared/api.ts";

// ── DOM refs ──────────────────────────────────────────────────────────────

const $flagged = document.getElementById("stat-flagged")!;
const $violations = document.getElementById("stat-violations")!;
const $threshold = document.getElementById("stat-threshold")!;
const $badgeEnabled = document.getElementById("badge-enabled")!;
const $badgeThreshold = document.getElementById("badge-threshold")!;
const $badgeTest = document.getElementById("badge-test") as HTMLElement;
const $tbody = document.getElementById("users-tbody")!;
const $emptyState = document.getElementById("empty-state")!;
const $activityContainer = document.getElementById("activity-container")!;
const $activityEmpty = document.getElementById("activity-empty")!;
const $loading = document.getElementById("loading-overlay")!;
const $refreshBtn = document.getElementById("refresh-btn") as HTMLButtonElement;
const $userCount = document.getElementById("user-count")!;
const $activityCount = document.getElementById("activity-count")!;
const $lastUpdated = document.getElementById("last-updated")!;
const $toast = document.getElementById("toast")!;

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

function violationClass(count: number, threshold: number): string {
  if (count >= threshold * 2) return "violation-high";
  if (count >= threshold) return "violation-medium";
  return "violation-low";
}

function severityInfo(count: number, threshold: number): { label: string; cls: string } {
  if (count >= threshold * 3) return { label: "CRITICAL", cls: "severity-critical" };
  if (count >= threshold * 2) return { label: "HIGH", cls: "severity-high" };
  if (count >= threshold) return { label: "MEDIUM", cls: "severity-medium" };
  return { label: "LOW", cls: "severity-low" };
}

function activityDetail(a: ActivityEntry): string {
  switch (a.action) {
    case "report": return `reported (${a.contentType}) in r/${a.subredditName}`;
    case "reset":  return "violations reset";
    case "alert":  return "modmail alert sent";
    case "mute":   return `auto-muted in r/${a.subredditName}`;
    default:       return a.action;
  }
}

function showToast(message: string, type: "success" | "error" = "success") {
  $toast.textContent = message;
  $toast.className = `toast ${type} show`;
  setTimeout(() => { $toast.className = "toast"; }, 2500);
}

// ── Render ────────────────────────────────────────────────────────────────

function render(data: DashboardData): void {
  // Stats
  $flagged.textContent = data.totalFlagged.toString();
  $violations.textContent = data.totalViolations.toString();
  $threshold.textContent = data.threshold.toString();

  // Badges
  $badgeEnabled.textContent = "";
  $badgeEnabled.className = `status-dot ${data.enabled ? "enabled" : "disabled"}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  $badgeEnabled.appendChild(dot);
  $badgeEnabled.appendChild(document.createTextNode(data.enabled ? " ENABLED" : " DISABLED"));

  $badgeThreshold.textContent = `THRESHOLD: ${data.threshold}`;

  if (data.testMode) {
    $badgeTest.classList.remove("hidden");
  } else {
    $badgeTest.classList.add("hidden");
  }

  // User count
  $userCount.textContent = data.totalFlagged.toString();

  // Users table
  const table = document.getElementById("users-table")!;
  const thead = table.querySelector("thead")!;

  if (data.users.length === 0) {
    $tbody.innerHTML = "";
    thead.style.display = "none";
    $emptyState.style.display = "";
  } else {
    $emptyState.style.display = "none";
    thead.style.display = "";
    $tbody.innerHTML = data.users
      .map((u: FlaggedUser) => {
        const sev = severityInfo(u.violationCount, data.threshold);
        return `<tr>
          <td><a class="user-link" href="https://reddit.com/u/${u.username}" target="_blank">u/${u.username}</a></td>
          <td class="cell-count"><span class="violation-badge ${violationClass(u.violationCount, data.threshold)}">${u.violationCount}</span></td>
          <td><span class="severity-pill ${sev.cls}">${sev.label}</span></td>
          <td><span class="time-text" title="${u.lastReport}">${timeAgo(u.lastReport)}</span></td>
          <td><span class="content-type-tag">${u.contentType}</span></td>
          <td><button class="btn-reset" data-username="${u.username}">Reset</button></td>
        </tr>`;
      })
      .join("");
  }

  // Activity count
  $activityCount.textContent = data.activity.length.toString();

  // Activity feed
  if (data.activity.length === 0) {
    $activityContainer.innerHTML = "";
    $activityEmpty.style.display = "";
  } else {
    $activityEmpty.style.display = "none";
    $activityContainer.innerHTML = data.activity
      .map((a: ActivityEntry) =>
        `<div class="activity-row">
          <span class="activity-type ${a.action}">${a.action}</span>
          <span class="activity-user">u/${a.username}</span>
          <span class="activity-detail">${activityDetail(a)}</span>
          <span class="activity-time">${timeAgo(a.timestamp)}</span>
        </div>`)
      .join("");
  }

  // Stat bar widths — animate proportional to data
  const maxViolations = Math.max(data.totalViolations, 1);
  const flaggedBar = document.querySelector(".stat-bar-fill.flagged") as HTMLElement | null;
  const violationsBar = document.querySelector(".stat-bar-fill.violations") as HTMLElement | null;
  if (flaggedBar) flaggedBar.style.width = `${Math.min(100, (data.totalFlagged / 10) * 100)}%`;
  if (violationsBar) violationsBar.style.width = `${Math.min(100, (data.totalViolations / maxViolations) * 100)}%`;

  // Last updated
  $lastUpdated.textContent = new Date().toLocaleTimeString();
}

// ── Data fetching ─────────────────────────────────────────────────────────

async function fetchDashboard(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.Dashboard);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DashboardData;
    render(data);
  } catch (err) {
    console.error("[ModShield Dashboard] Failed to fetch:", err);
  }
}

// ── Reset handler ─────────────────────────────────────────────────────────

async function resetUser(username: string, btn: HTMLButtonElement): Promise<void> {
  if (!confirm(`Reset all violations for u/${username}?`)) return;

  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await fetch(ApiEndpoint.Reset, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast(`u/${username} reset`, "success");
    await fetchDashboard();
  } catch (err) {
    console.error(`[ModShield] Reset failed for u/${username}:`, err);
    showToast(`Reset failed for u/${username}`, "error");
    btn.disabled = false;
    btn.textContent = "Reset";
  }
}

// ── Event delegation ──────────────────────────────────────────────────────

$tbody.addEventListener("click", (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains("btn-reset") && target.dataset.username) {
    resetUser(target.dataset.username, target as HTMLButtonElement);
  }
});

$refreshBtn.addEventListener("click", () => {
  $refreshBtn.textContent = "Loading...";
  fetchDashboard().then(() => {
    $refreshBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.5 7A5.5 5.5 0 1 1 7 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 0.5L9.5 1.5L7 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Refresh`;
    showToast("Refreshed", "success");
  });
});

// ── Init ──────────────────────────────────────────────────────────────────

fetchDashboard().then(() => {
  $loading.classList.add("hidden");
});

// Auto-refresh every 30 seconds.
setInterval(fetchDashboard, 30_000);
