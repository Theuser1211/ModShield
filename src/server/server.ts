/**
 * ModShield — Server-side API + Trigger handler
 *
 * ALL logic runs here (Devvit Web pattern):
 *  - Dashboard API (GET /api/dashboard, POST /api/reset)
 *  - Trigger endpoints (PostReport, CommentReport, AppInstall)
 *  - Menu endpoint (create dashboard post)
 *
 * Triggers are registered in devvit.json and routed as HTTP POST endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { context, redis, reddit, settings } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import {
  ApiEndpoint,
  type ActivityEntry,
  type BanRequest,
  type BanResponse,
  type DashboardData,
  type ErrorResponse,
  type FlaggedUser,
  type LogsData,
  type ResetRequest,
  type ResetResponse,
  type TimeoutRequest,
  type TimeoutResponse,
} from "../shared/api.ts";
import { once } from "node:events";

// ── Redis key constants ───────────────────────────────────────────────────

const KV_VIOL_PREFIX = "modshield:viol:";
const SET_FLAGGED = "modshield:flagged";
const HASH_DETAIL_PREFIX = "modshield:detail:";
const SET_ACTIVITY = "modshield:activity";
const HASH_SETTINGS = "modshield:settings";

const SETTING_ENABLED = "modshield_enabled";
const SETTING_THRESHOLD = "modshield_threshold";
const SETTING_TEST_MODE = "modshield_test_mode";

const DEFAULT_VIOLATION_THRESHOLD = 3;
const DASHBOARD_USER_LIMIT = 50;
const ACTIVITY_LIMIT = 500;

// ── Internal endpoint paths ───────────────────────────────────────────────

const EP_POST_REPORT = "/internal/on-post-report";
const EP_COMMENT_REPORT = "/internal/on-comment-report";
const EP_APP_INSTALL = "/internal/on-app-install";
const EP_MENU_CREATE = "/internal/menu/post-create";

// ── Types ─────────────────────────────────────────────────────────────────

interface ResolvedSettings {
  isEnabled: boolean;
  threshold: number;
  isTestMode: boolean;
}

// ── Server entry point ────────────────────────────────────────────────────

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(`[ModShield] ${msg}`);
    writeJSON(500, { error: msg, status: 500 }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;

  if (!url || url === "/") {
    writeJSON(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  // ── Trigger + menu endpoints (POST from Devvit platform) ─────────────
  switch (url) {
    case EP_POST_REPORT: {
      console.log("[ModShield] === PostReport trigger fired ===");
      const postPayload = await readJSON<Record<string, unknown>>(req);
      console.log("[ModShield] PostReport payload keys:", Object.keys(postPayload));
      await handlePostReport(postPayload);
      writeJSON(200, {}, rsp);
      return;
    }
    case EP_COMMENT_REPORT: {
      console.log("[ModShield] === CommentReport trigger fired ===");
      const commentPayload = await readJSON<Record<string, unknown>>(req);
      console.log("[ModShield] CommentReport payload keys:", Object.keys(commentPayload));
      await handleCommentReport(commentPayload);
      writeJSON(200, {}, rsp);
      return;
    }
    case EP_APP_INSTALL: {
      console.log("[ModShield] === AppInstall trigger fired ===");
      await handleAppInstall();
      writeJSON(200, {}, rsp);
      return;
    }
    case EP_MENU_CREATE: {
      console.log("[ModShield] === Menu create fired ===");
      const menuResult = await handleMenuCreate();
      writeJSON(200, menuResult, rsp);
      return;
    }
  }

  // ── Dashboard API endpoints ──────────────────────────────────────────
  let body: DashboardData | ResetResponse | BanResponse | TimeoutResponse | LogsData | ErrorResponse;

  switch (url) {
    case ApiEndpoint.Dashboard:
      body = await onDashboard();
      break;
    case ApiEndpoint.Reset:
      body = await onReset(req);
      break;
    case ApiEndpoint.Ban:
      body = await onBan(req);
      break;
    case ApiEndpoint.Timeout:
      body = await onTimeout(req);
      break;
    case ApiEndpoint.Logs:
      body = await onLogs();
      break;
    default:
      writeJSON(
        404,
        { error: `not found: ${url}`, status: 404 },
        rsp
      );
      return;
  }

  const status = typeof body === "object" && body !== null && "status" in body ? (body as unknown as Record<string, unknown>).status as number : 200;
  writeJSON(status, body, rsp);
}

// ─────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────

async function resolveSettings(): Promise<ResolvedSettings> {
  const [rawEnabled, rawThreshold, rawTestMode] = await Promise.all([
    settings.get<boolean>(SETTING_ENABLED),
    settings.get<number>(SETTING_THRESHOLD),
    settings.get<boolean>(SETTING_TEST_MODE),
  ]);

  const result = {
    isEnabled: rawEnabled ?? true,
    threshold:
      typeof rawThreshold === "number" && rawThreshold >= 1
        ? rawThreshold
        : DEFAULT_VIOLATION_THRESHOLD,
    isTestMode: rawTestMode ?? false,
  };

  // Cache settings for the dashboard to read.
  try {
    await redis.hSet(HASH_SETTINGS, {
      enabled: String(result.isEnabled),
      threshold: String(result.threshold),
      testMode: String(result.isTestMode),
    });
  } catch {
    // non-fatal
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Activity log helper
// ─────────────────────────────────────────────────────────────────────────

async function appendActivity(entry: {
  username: string;
  contentType: "post" | "comment" | "unknown";
  subredditName: string;
  action: "report" | "reset" | "mute" | "ban" | "timeout";
}): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const json = JSON.stringify({ ...entry, timestamp });
    const score = Date.now();
    await redis.zAdd(SET_ACTIVITY, { member: json, score });

    const count = await redis.zCard(SET_ACTIVITY);
    if (count > ACTIVITY_LIMIT + 10) {
      await redis.zRemRangeByRank(SET_ACTIVITY, 0, count - ACTIVITY_LIMIT - 1);
    }
  } catch (err) {
    console.error("[ModShield] Failed to append activity log:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Username resolution
// ─────────────────────────────────────────────────────────────────────────

async function resolveUsername(
  authorIdOrName: string | undefined
): Promise<string | undefined> {
  if (!authorIdOrName) return undefined;

  if (authorIdOrName.startsWith("t2_")) {
    try {
      const user = await reddit.getUserById(authorIdOrName as `t2_${string}`);
      return user?.username;
    } catch (err) {
      console.error(`[ModShield] Failed to resolve user ID ${authorIdOrName}:`, err);
      return undefined;
    }
  }

  return authorIdOrName;
}

// ─────────────────────────────────────────────────────────────────────────
// Core violation handler
// ─────────────────────────────────────────────────────────────────────────

async function handleViolation(
  username: string,
  contentType: "post" | "comment",
  contentId: string,
  subredditName: string
): Promise<void> {
  console.log(
    `[ModShield] Processing report for u/${username} (${contentType} ${contentId}) in r/${subredditName}`
  );

  const cfg = await resolveSettings();

  if (!cfg.isEnabled) {
    console.log("[ModShield] App is disabled via settings — skipping.");
    return;
  }

  if (cfg.isTestMode) {
    console.log("[ModShield] TEST MODE active.");
  }

  // Update all Redis data structures.
  let violationCount: number;
  const now = new Date().toISOString();

  try {
    violationCount = await redis.incrBy(`${KV_VIOL_PREFIX}${username}`, 1);
    await redis.zIncrBy(SET_FLAGGED, username, 1);
    await redis.hSet(`${HASH_DETAIL_PREFIX}${username}`, {
      lastReport: now,
      contentType,
    });

    const existingFirstSeen = await redis.hGet(
      `${HASH_DETAIL_PREFIX}${username}`,
      "firstSeen"
    );
    if (!existingFirstSeen) {
      await redis.hSet(`${HASH_DETAIL_PREFIX}${username}`, { firstSeen: now });
    }

    console.log(
      `[ModShield] Redis updated for u/${username}: count=${violationCount}, threshold=${cfg.threshold}`
    );
  } catch (err) {
    console.error(`[ModShield] Redis write failed for u/${username}:`, err);
    return;
  }

  // Activity log.
  await appendActivity({
    username,
    contentType,
    subredditName,
    action: "report",
  });

  // Threshold — send Modmail notification (only on the exact threshold crossing).
  if (violationCount === cfg.threshold) {
    console.log(`[ModShield] THRESHOLD MET for u/${username} — sending Modmail notification.`);

    try {
      const testTag = cfg.isTestMode ? " [TEST MODE]" : "";
      const subject = `[ModShield] Repeat Offender: u/${username}${testTag}`;
      const profileUrl = `https://reddit.com/u/${username}`;

      const testBanner = cfg.isTestMode
        ? "> **TEST MODE ACTIVE** — No real mod actions have been taken.\n\n"
        : "";

      const bodyMarkdown =
        testBanner +
        `**ModShield has flagged a repeat offender in r/${subredditName}.**\n\n` +
        `| Field | Value |\n` +
        `|-------|-------|\n` +
        `| **User** | [u/${username}](${profileUrl}) |\n` +
        `| **Violation count** | ${violationCount} |\n` +
        `| **Threshold** | ${cfg.threshold} |\n` +
        `| **Trigger** | Reported ${contentType} |\n\n` +
        `**Recommended next steps:**\n` +
        `1. [Review the user's profile](${profileUrl})\n` +
        `2. Issue a warning via Modmail if appropriate\n` +
        `3. Consider a temporary posting restriction for repeat behaviour\n\n` +
        `*This message was generated automatically by ModShield.*` +
        (cfg.isTestMode ? " **(Test Mode — no real action was triggered.)**" : "");

      // Use createModNotification — appears in Modmail > Notifications tab.
      await reddit.modMail.createModNotification({
        subject: subject.substring(0, 100), // max 100 chars
        bodyMarkdown,
        subredditId: context.subredditId as `t5_${string}`,
      });

      console.log(`[ModShield] Modmail notification sent for u/${username} (${violationCount}/${cfg.threshold}).`);
    } catch (err) {
      console.error(`[ModShield] Failed to send Modmail for u/${username}:`, err);
    }
  }

  // Auto-mute at 2x threshold (only once — fire exactly at 2x threshold).
  const muteThreshold = cfg.threshold * 2;
  if (violationCount === muteThreshold && !cfg.isTestMode) {
    console.log(`[ModShield] AUTO-MUTE threshold reached for u/${username} (${violationCount} >= ${muteThreshold}).`);

    try {
      await reddit.muteUser({ subredditName, username });
      await appendActivity({ username, contentType, subredditName, action: "mute" });
      console.log(`[ModShield] u/${username} has been muted.`);

      try {
        const muteBody =
          `**ModShield has automatically muted u/${username} in r/${subredditName}.**\n\n` +
          `| Field | Value |\n` +
          `|-------|-------|\n` +
          `| **User** | [u/${username}](https://reddit.com/u/${username}) |\n` +
          `| **Violation count** | ${violationCount} |\n` +
          `| **Mute threshold** | ${muteThreshold} (2x report threshold) |\n\n` +
          `*This action was taken automatically by ModShield.*`;

        await reddit.modMail.createModNotification({
          subject: `[ModShield] Auto-Mute: u/${username}`.substring(0, 100),
          bodyMarkdown: muteBody,
          subredditId: context.subredditId as `t5_${string}`,
        });
      } catch (mailErr) {
        console.error(`[ModShield] Failed to send mute notification for u/${username}:`, mailErr);
      }
    } catch (err) {
      console.error(`[ModShield] Failed to mute u/${username}:`, err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Trigger handlers
// ─────────────────────────────────────────────────────────────────────────

async function handlePostReport(payload: Record<string, unknown>): Promise<void> {
  try {
    // The PostReport event payload has the shape:
    // { post: PostV2, subreddit: SubredditV2, reason: string }
    const post = payload.post as { id?: string; authorId?: string } | undefined;
    const subreddit = payload.subreddit as { name?: string } | undefined;

    const postId = post?.id;
    const authorId = post?.authorId;
    const subredditName = subreddit?.name ?? context.subredditName;

    console.log(
      `[ModShield] PostReport payload: postId=${postId ?? "?"}, authorId=${authorId ?? "?"}, ` +
      `subreddit=${subredditName ?? "?"}, reason=${JSON.stringify(payload.reason)}`
    );

    if (!postId || !subredditName) {
      console.warn("[ModShield] PostReport — missing postId or subredditName — skipping.");
      return;
    }

    const username = await resolveUsername(authorId);

    if (!username) {
      console.warn(`[ModShield] PostReport — could not resolve author for post ${postId} — skipping.`);
      return;
    }

    console.log(`[ModShield] PostReport — post author is u/${username}`);
    await handleViolation(username, "post", postId, subredditName);
  } catch (err) {
    console.error("[ModShield] Unhandled error in PostReport trigger:", err);
  }
}

async function handleCommentReport(payload: Record<string, unknown>): Promise<void> {
  try {
    // The CommentReport event payload has the shape:
    // { comment: CommentV2, subreddit: SubredditV2, reason: string }
    const comment = payload.comment as { id?: string; author?: string } | undefined;
    const subreddit = payload.subreddit as { name?: string } | undefined;

    const commentId = comment?.id;
    const authorIdOrName = comment?.author;
    const subredditName = subreddit?.name ?? context.subredditName;

    console.log(
      `[ModShield] CommentReport payload: commentId=${commentId ?? "?"}, author=${authorIdOrName ?? "?"}, ` +
      `subreddit=${subredditName ?? "?"}, reason=${JSON.stringify(payload.reason)}`
    );

    if (!commentId || !subredditName) {
      console.warn("[ModShield] CommentReport — missing commentId or subredditName — skipping.");
      return;
    }

    const author = await resolveUsername(authorIdOrName);

    if (!author) {
      console.warn(`[ModShield] CommentReport — could not resolve comment author — skipping.`);
      return;
    }

    console.log(`[ModShield] CommentReport — comment author is u/${author}`);
    await handleViolation(author, "comment", commentId, subredditName);
  } catch (err) {
    console.error("[ModShield] Unhandled error in CommentReport trigger:", err);
  }
}

async function handleAppInstall(): Promise<void> {
  try {
    console.log(`[ModShield] App installed in r/${context.subredditName ?? "unknown"}. Creating dashboard post...`);

    const post = await reddit.submitCustomPost({ title: "ModShield Dashboard" });
    console.log(`[ModShield] Dashboard post created on install: ${post.id}`);
  } catch (err) {
    console.error("[ModShield] Failed to create dashboard on install:", err);
  }
}

async function handleMenuCreate(): Promise<UiResponse> {
  try {
    const post = await reddit.submitCustomPost({ title: "ModShield Dashboard" });
    return {
      showToast: { text: "ModShield Dashboard created!", appearance: "success" },
      navigateTo: post.url,
    };
  } catch (err) {
    console.error("[ModShield] Failed to create dashboard post:", err);
    return {
      showToast: { text: "Failed to create dashboard — check logs.", appearance: "neutral" },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Dashboard data handler
// ─────────────────────────────────────────────────────────────────────────

async function onDashboard(): Promise<DashboardData> {
  const [zResults, totalFlaggedCount] = await Promise.all([
    redis.zRange(SET_FLAGGED, 0, DASHBOARD_USER_LIMIT - 1, {
      by: "rank",
      reverse: true,
    }),
    redis.zCard(SET_FLAGGED),
  ]);

  const users: FlaggedUser[] = [];
  let totalViolations = 0;

  for (const entry of zResults) {
    const username = entry.member;
    const violationCount = entry.score;
    totalViolations += violationCount;

    const detail = await redis.hGetAll(`${HASH_DETAIL_PREFIX}${username}`);

    users.push({
      username,
      violationCount,
      lastReport: (detail.lastReport as string) ?? "unknown",
      firstSeen: (detail.firstSeen as string) ?? "unknown",
      contentType: (detail.contentType as "post" | "comment" | "unknown") ?? "unknown",
    });
  }

  const rawActivity = await redis.zRange(SET_ACTIVITY, 0, ACTIVITY_LIMIT - 1, {
    by: "rank",
    reverse: true,
  });

  const activity: ActivityEntry[] = rawActivity
    .map((e) => {
      try {
        return JSON.parse(e.member) as ActivityEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ActivityEntry => e !== null);

  const settingsHash = await redis.hGetAll(HASH_SETTINGS);
  const enabled = settingsHash.enabled !== "false";
  const threshold =
    typeof settingsHash.threshold === "string" && Number(settingsHash.threshold) >= 1
      ? Number(settingsHash.threshold)
      : DEFAULT_VIOLATION_THRESHOLD;
  const testMode = settingsHash.testMode === "true";

  return {
    type: "dashboard",
    users,
    totalViolations,
    totalFlagged: totalFlaggedCount,
    threshold,
    testMode,
    enabled,
    activity,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Reset handler
// ─────────────────────────────────────────────────────────────────────────

async function onReset(req: IncomingMessage): Promise<ResetResponse | ErrorResponse> {
  const { username } = await readJSON<ResetRequest>(req);

  if (!username) {
    return { error: "username is required", status: 400 };
  }

  try {
    await redis.zRem(SET_FLAGGED, [username]);
    await redis.del(`${HASH_DETAIL_PREFIX}${username}`);
    await redis.del(`${KV_VIOL_PREFIX}${username}`);

    await appendActivity({
      username,
      contentType: "unknown",
      subredditName: "",
      action: "reset",
    });

    console.log(`[ModShield] Reset violations for u/${username}`);
    return { type: "reset", success: true, username };
  } catch (err) {
    console.error(`[ModShield] Failed to reset u/${username}:`, err);
    return { error: `Failed to reset u/${username}`, status: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Ban handler (permanent)
// ─────────────────────────────────────────────────────────────────────────

async function onBan(req: IncomingMessage): Promise<BanResponse | ErrorResponse> {
  const { username, reason, note } = await readJSON<BanRequest>(req);

  if (!username) {
    return { error: "username is required", status: 400 };
  }

  const subredditName = context.subredditName;
  if (!subredditName) {
    return { error: "subredditName not available in context", status: 500 };
  }

  try {
    await reddit.banUser({
      username,
      subredditName,
      reason: reason ?? "ModShield: repeat offender",
      note: note ?? "Banned via ModShield dashboard",
      duration: 0,
    });

    // Clean up tracking data.
    await redis.zRem(SET_FLAGGED, [username]);
    await redis.del(`${HASH_DETAIL_PREFIX}${username}`);
    await redis.del(`${KV_VIOL_PREFIX}${username}`);

    await appendActivity({
      username,
      contentType: "unknown",
      subredditName,
      action: "ban",
    });

    console.log(`[ModShield] Permanently banned u/${username} from r/${subredditName}`);
    return { type: "ban", success: true, username };
  } catch (err) {
    console.error(`[ModShield] Failed to ban u/${username}:`, err);
    return { error: `Failed to ban u/${username}: ${err instanceof Error ? err.message : String(err)}`, status: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Timeout handler (temporary ban)
// ─────────────────────────────────────────────────────────────────────────

async function onTimeout(req: IncomingMessage): Promise<TimeoutResponse | ErrorResponse> {
  const { username, durationDays, reason, note } = await readJSON<TimeoutRequest>(req);

  if (!username) {
    return { error: "username is required", status: 400 };
  }
  if (!durationDays || durationDays < 1 || durationDays > 999) {
    return { error: "durationDays must be between 1 and 999", status: 400 };
  }

  const subredditName = context.subredditName;
  if (!subredditName) {
    return { error: "subredditName not available in context", status: 500 };
  }

  try {
    await reddit.banUser({
      username,
      subredditName,
      duration: durationDays,
      reason: reason ?? `ModShield: ${durationDays}-day timeout`,
      note: note ?? `Timed out via ModShield dashboard for ${durationDays} days`,
    });

    // Clean up tracking data.
    await redis.zRem(SET_FLAGGED, [username]);
    await redis.del(`${HASH_DETAIL_PREFIX}${username}`);
    await redis.del(`${KV_VIOL_PREFIX}${username}`);

    await appendActivity({
      username,
      contentType: "unknown",
      subredditName,
      action: "timeout",
    });

    console.log(`[ModShield] Timed out u/${username} for ${durationDays} days in r/${subredditName}`);
    return { type: "timeout", success: true, username, durationDays };
  } catch (err) {
    console.error(`[ModShield] Failed to timeout u/${username}:`, err);
    return { error: `Failed to timeout u/${username}: ${err instanceof Error ? err.message : String(err)}`, status: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Full logs handler
// ─────────────────────────────────────────────────────────────────────────

async function onLogs(): Promise<LogsData> {
  const rawEntries = await redis.zRange(SET_ACTIVITY, 0, ACTIVITY_LIMIT - 1, {
    by: "rank",
    reverse: true,
  });

  const entries: ActivityEntry[] = rawEntries
    .map((e) => {
      try {
        return JSON.parse(e.member) as ActivityEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ActivityEntry => e !== null);

  return {
    type: "logs",
    entries,
    total: entries.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function writeJSON(
  status: number,
  json: unknown,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  return JSON.parse(`${Buffer.concat(chunks)}`);
}
