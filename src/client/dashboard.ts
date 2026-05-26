/**
 * ModShield — Dashboard client
 *
 * Fetches flagged users, stats, and activity from the server API,
 * renders them in the command-center dashboard, and supports per-user
 * actions: Ban, Timeout (temp ban), and Reset with auto-refresh.
 */

import type { DashboardData, ActivityEntry } from "../shared/api.ts";
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

function severityInfo(count: number, threshold: number): { label: string; cls: string } {
  if (count >= threshold * 3) return { label: "CRITICAL", cls: "severity-critical" };
  if (count >= threshold * 2) return { label: "HIGH", cls: "severity-high" };
  if (count >= threshold) return { label: "MEDIUM", cls: "severity-medium" };
  return { label: "LOW", cls: "severity-low" };
}

function violationClass(count: number, threshold: number): string {
  if (count >= threshold * 2) return "violation-high";
  if (count >= threshold) return "violation-medium";
  return "violation-low";
}

function activityDetail(a: ActivityEntry): string {
  switch (a.action) {
    case "report":
      return `reported ${a.contentType} in r/${a.subredditName}`;
    case "reset":
      return "violations reset";
    case "mute":
      return `auto-muted in r/${a.subredditName}`;
    case "ban":
      return `permanently banned from r/${a.subredditName}`;
    case "timeout":
      return `timed out in r/${a.subredditName}`;
    case "alert":
      return `threshold alert sent to r/${a.subredditName}`;
    default:
      return a.action;
  }
}

function showToast(message: string, type: "success" | "error" = "success"): void {
  $toast.textContent = message;
  $toast.className = `toast show ${type}`;
  setTimeout(() => { $toast.className = "toast"; }, 2400);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Confirm modal (replaces window.confirm which is blocked in iframes) ───

let confirmModal: HTMLElement | null = null;

function closeConfirmModal(): void {
  if (confirmModal) {
    confirmModal.remove();
    confirmModal = null;
  }
}

function showConfirmModal(title: string, message: string, confirmLabel: string, dangerColor: string): Promise<boolean> {
  return new Promise((resolve) => {
    closeConfirmModal();

    const modal = document.createElement("div");
    modal.className = "confirm-modal";
    modal.innerHTML = `
      <div class="confirm-modal-backdrop"></div>
      <div class="confirm-modal-box">
        <h4 class="confirm-modal-title">${escapeHtml(title)}</h4>
        <p class="confirm-modal-message">${escapeHtml(message)}</p>
        <div class="confirm-modal-actions">
          <button class="btn-confirm-cancel">Cancel</button>
          <button class="btn-confirm-ok" style="background:${dangerColor}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    confirmModal = modal;

    const okBtn = modal.querySelector(".btn-confirm-ok") as HTMLButtonElement;
    const cancelBtn = modal.querySelector(".btn-confirm-cancel") as HTMLButtonElement;
    const backdrop = modal.querySelector(".confirm-modal-backdrop") as HTMLElement;

    function cleanup(result: boolean): void {
      closeConfirmModal();
      resolve(result);
    }

    okBtn.addEventListener("click", () => cleanup(true));
    cancelBtn.addEventListener("click", () => cleanup(false));
    backdrop.addEventListener("click", () => cleanup(false));
  });
}

// ── Render ────────────────────────────────────────────────────────────────

function render(data: DashboardData): void {

  // Stats
  $flagged.textContent = String(data.totalFlagged);
  $violations.textContent = String(data.totalViolations);
  $threshold.textContent = String(data.threshold);

  // Bar animations
  const flaggedBar = document.querySelector(".stat-bar-fill.flagged") as HTMLElement;
  const violationsBar = document.querySelector(".stat-bar-fill.violations") as HTMLElement;
  if (flaggedBar) flaggedBar.style.width = `${Math.min(100, data.totalFlagged * 2)}%`;
  if (violationsBar) violationsBar.style.width = `${Math.min(100, data.totalViolations)}%`;

  // Status badges
  if (data.enabled) {
    $badgeEnabled.textContent = "ENABLED";
    $badgeEnabled.className = "status-dot enabled";
    $badgeEnabled.innerHTML = '<span class="dot"></span> ENABLED';
  } else {
    $badgeEnabled.textContent = "DISABLED";
    $badgeEnabled.className = "status-dot disabled";
    $badgeEnabled.innerHTML = '<span class="dot"></span> DISABLED';
  }
  $badgeThreshold.textContent = `T: ${data.threshold}`;
  if ($badgeTest) {
    $badgeTest.className = data.testMode ? "status-dot test-mode" : "status-dot test-mode hidden";
    $badgeTest.innerHTML = '<span class="dot"></span> TEST';
  }

  // Flagged users table
  if (data.users.length === 0) {
    $emptyState.classList.remove("hidden");
    $tbody.innerHTML = "";
  } else {
    $emptyState.classList.add("hidden");
    $tbody.innerHTML = data.users
      .map((u) => {
        const sev = severityInfo(u.violationCount, data.threshold);
        return `<tr>
          <td><a class="user-link" href="https://reddit.com/u/${escapeHtml(u.username)}" target="_blank">u/${escapeHtml(u.username)}</a></td>
          <td class="cell-count"><span class="violation-badge ${violationClass(u.violationCount, data.threshold)}">${u.violationCount}</span></td>
          <td><span class="severity-pill ${sev.cls}">${sev.label}</span></td>
          <td><span class="time-text">${timeAgo(u.lastReport)}</span></td>
          <td><span class="content-type-tag">${u.contentType}</span></td>
          <td>
            <div class="actions-cell">
              <button class="btn-actions" data-username="${escapeHtml(u.username)}" title="Actions">&#8943;</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  // Count badges
  $userCount.textContent = String(data.users.length);
  $activityCount.textContent = String(data.activity.length);

  // Activity feed
  if (data.activity.length === 0) {
    $activityEmpty.classList.remove("hidden");
    $activityContainer.innerHTML = "";
  } else {
    $activityEmpty.classList.add("hidden");
    $activityContainer.innerHTML = data.activity
      .map(
        (a) => `<div class="activity-row">
          <span class="activity-type ${a.action}">${a.action}</span>
          <span class="activity-user">u/${escapeHtml(a.username)}</span>
          <span class="activity-detail">${escapeHtml(activityDetail(a))}</span>
          <span class="activity-time">${timeAgo(a.timestamp)}</span>
        </div>`
      )
      .join("");
  }

  // Footer timestamp
  $lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Data fetch ────────────────────────────────────────────────────────────

async function fetchDashboard(): Promise<void> {
  try {
    const res = await fetch(ApiEndpoint.Dashboard);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DashboardData;
    render(data);
    $loading.classList.add("hidden");
  } catch (err) {
    console.error("[ModShield] Dashboard fetch failed:", err);
    $loading.classList.add("hidden");
  }
}

// ── Actions dropdown ──────────────────────────────────────────────────────

let openDropdown: HTMLElement | null = null;

function closeDropdown(): void {
  if (openDropdown) {
    openDropdown.remove();
    openDropdown = null;
  }
}

function openActionsDropdown(btn: HTMLElement, username: string): void {
  closeDropdown();
  closeTimeoutModal();
  closeConfirmModal();

  const rect = btn.getBoundingClientRect();
  const dropdown = document.createElement("div");
  dropdown.className = "actions-dropdown";
  dropdown.innerHTML = `
    <button class="dropdown-item ban" data-action="ban" data-username="${escapeHtml(username)}">
      <span class="icon">&#9940;</span> Ban Permanent
    </button>
    <button class="dropdown-item timeout" data-action="timeout" data-username="${escapeHtml(username)}">
      <span class="icon">&#9203;</span> Timeout
    </button>
    <button class="dropdown-item reset" data-action="reset" data-username="${escapeHtml(username)}">
      <span class="icon">&#8634;</span> Reset Violations
    </button>
  `;

  // Position fixed below the button, aligned to right edge
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(dropdown);
  openDropdown = dropdown;
}

// ── Timeout modal ─────────────────────────────────────────────────────────

let openModal: HTMLElement | null = null;
let selectedDuration = 7;

function closeTimeoutModal(): void {
  if (openModal) {
    openModal.remove();
    openModal = null;
  }
}

function openTimeoutModal(btn: HTMLElement, username: string): void {
  closeDropdown();
  closeTimeoutModal();
  closeConfirmModal();

  selectedDuration = 7;

  const rect = btn.getBoundingClientRect();
  const modal = document.createElement("div");
  modal.className = "timeout-modal";
  modal.innerHTML = `
    <h4>Timeout u/${escapeHtml(username)}</h4>
    <div class="duration-chips">
      <button class="duration-chip" data-days="3">3d</button>
      <button class="duration-chip selected" data-days="7">7d</button>
      <button class="duration-chip" data-days="14">14d</button>
      <button class="duration-chip" data-days="30">30d</button>
      <button class="duration-chip" data-days="90">90d</button>
    </div>
    <div class="timeout-inputs">
      <label>Custom days (1-999)</label>
      <input type="number" class="timeout-days-input" min="1" max="999" value="7" placeholder="Days" />
      <label>Reason (optional)</label>
      <input type="text" class="timeout-reason-input" placeholder="Rule violation..." />
    </div>
    <div class="timeout-actions">
      <button class="btn-timeout-confirm" data-username="${escapeHtml(username)}">Confirm Timeout</button>
      <button class="btn-timeout-cancel">Cancel</button>
    </div>
  `;

  // Position fixed below the button, aligned to right edge
  modal.style.top = `${rect.bottom + 4}px`;
  modal.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(modal);
  openModal = modal;

  // Chip selection
  const chips = modal.querySelectorAll(".duration-chip");
  const daysInput = modal.querySelector(".timeout-days-input") as HTMLInputElement;
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      selectedDuration = Number((chip as HTMLElement).dataset.days);
      daysInput.value = String(selectedDuration);
    });
  });

  // Custom days input syncs with chips
  daysInput.addEventListener("input", () => {
    const val = Number(daysInput.value);
    chips.forEach((c) => c.classList.remove("selected"));
    const matchingChip = modal.querySelector(`.duration-chip[data-days="${val}"]`);
    if (matchingChip) matchingChip.classList.add("selected");
    selectedDuration = val;
  });
}

// ── Action handlers ───────────────────────────────────────────────────────

async function banUser(username: string): Promise<void> {
  closeDropdown();
  const ok = await showConfirmModal(
    "Ban User",
    `Permanently ban u/${username}? They will be removed from the subreddit and all tracking data cleared.`,
    "Ban Permanently",
    "#f85149"
  );
  if (!ok) return;

  showToast("Banning...", "success");
  try {
    const res = await fetch(ApiEndpoint.Ban, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`u/${username} permanently banned`, "success");
    await fetchDashboard();
  } catch (err) {
    console.error(`[ModShield] Ban failed for u/${username}:`, err);
    showToast(`Ban failed: ${err instanceof Error ? err.message : "unknown"}`, "error");
  }
}

async function timeoutUser(username: string, durationDays: number, reason: string, btn: HTMLElement): Promise<void> {
  btn.setAttribute("disabled", "true");
  (btn as HTMLButtonElement).textContent = "...";
  try {
    const res = await fetch(ApiEndpoint.Timeout, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, durationDays, reason: reason || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`u/${username} timed out for ${durationDays}d`, "success");
    closeTimeoutModal();
    await fetchDashboard();
  } catch (err) {
    console.error(`[ModShield] Timeout failed for u/${username}:`, err);
    showToast(`Timeout failed: ${err instanceof Error ? err.message : "unknown"}`, "error");
    btn.removeAttribute("disabled");
    (btn as HTMLButtonElement).textContent = "Confirm Timeout";
  }
}

async function resetUser(username: string): Promise<void> {
  closeDropdown();
  const ok = await showConfirmModal(
    "Reset Violations",
    `Clear all violation records for u/${username}? This removes them from the flagged users list.`,
    "Reset",
    "#3fb950"
  );
  if (!ok) return;

  showToast("Resetting...", "success");
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
  }
}

// ── Event delegation (document-level — dropdown/modal are appended to body) ──

document.addEventListener("click", (e: Event) => {
  const target = e.target as HTMLElement;

  // Confirm modal OK/Cancel — handled by its own listeners, skip
  if (target.closest(".confirm-modal")) return;

  // Kebab button — toggle dropdown
  if (target.classList.contains("btn-actions") && target.dataset.username) {
    if (openDropdown && openDropdown.dataset.for === target.dataset.username) {
      closeDropdown();
    } else {
      openActionsDropdown(target, target.dataset.username);
      if (openDropdown) openDropdown.dataset.for = target.dataset.username;
    }
    return;
  }

  // Dropdown action item
  const dropdownItem = target.closest(".dropdown-item") as HTMLElement;
  if (dropdownItem) {
    const action = dropdownItem.dataset.action;
    const username = dropdownItem.dataset.username;
    if (!action || !username) return;

    if (action === "ban") {
      banUser(username);
    } else if (action === "reset") {
      resetUser(username);
    } else if (action === "timeout") {
      const triggerBtn = document.querySelector(`.btn-actions[data-username="${CSS.escape(username)}"]`) as HTMLElement;
      openTimeoutModal(triggerBtn ?? dropdownItem, username);
    }
    return;
  }

  // Timeout confirm button
  const confirmBtn = target.closest(".btn-timeout-confirm") as HTMLElement;
  if (confirmBtn) {
    const username = confirmBtn.dataset.username;
    if (!username) return;
    const modal = confirmBtn.closest(".timeout-modal");
    const daysInput = modal?.querySelector(".timeout-days-input") as HTMLInputElement;
    const reasonInput = modal?.querySelector(".timeout-reason-input") as HTMLInputElement;
    const days = Number(daysInput?.value) || selectedDuration;
    const reason = reasonInput?.value ?? "";
    if (days < 1 || days > 999) {
      showToast("Duration must be 1-999 days", "error");
      return;
    }
    timeoutUser(username, days, reason, confirmBtn);
    return;
  }

  // Timeout cancel button
  const cancelBtn = target.closest(".btn-timeout-cancel");
  if (cancelBtn) {
    closeTimeoutModal();
    return;
  }

  // Outside click — close dropdown and modal
  if (!target.closest(".actions-dropdown") && !target.closest(".timeout-modal")) {
    closeDropdown();
    closeTimeoutModal();
  }
});

// ── Refresh button ────────────────────────────────────────────────────────

$refreshBtn.addEventListener("click", async () => {
  $refreshBtn.disabled = true;
  await fetchDashboard();
  showToast("Dashboard refreshed", "success");
  $refreshBtn.disabled = false;
});

// ── Clear Logs button ───────────────────────────────────────────────────

const $clearLogsBtn = document.getElementById("btn-clear-logs");
if ($clearLogsBtn) {
  $clearLogsBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    const ok = await showConfirmModal(
      "Clear Logs",
      "Delete all activity log entries? This cannot be undone.",
      "Clear All",
      "var(--red)"
    );
    if (!ok) return;
    try {
      const res = await fetch(ApiEndpoint.ClearLogs, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Activity logs cleared", "success");
      await fetchDashboard();
    } catch (err) {
      console.error("[ModShield] Clear logs failed:", err);
      showToast("Failed to clear logs", "error");
    }
  });
}

// ── Auto-refresh every 30s ────────────────────────────────────────────────

setInterval(fetchDashboard, 30_000);

// ── Init ──────────────────────────────────────────────────────────────────

fetchDashboard();
