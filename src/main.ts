/**
 * ModShield — Reddit Devvit Hackathon (Grand-Prize Edition)
 *
 * This file handles Blocks SDK configuration only:
 *  - Devvit.configure() to enable API clients
 *  - Devvit.addSettings() for the App Settings page
 *
 * All trigger handling, menu items, and dashboard API are in server.ts
 * and devvit.json, using the Devvit Web pattern.
 */

import Devvit, { SettingScope } from "@devvit/public-api";

// ─────────────────────────────────────────────
// Enable required API clients
// ─────────────────────────────────────────────

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DEFAULT_VIOLATION_THRESHOLD = 3;

// Setting name constants.
const SETTING_ENABLED = "modshield_enabled";
const SETTING_THRESHOLD = "modshield_threshold";
const SETTING_TEST_MODE = "modshield_test_mode";

// ─────────────────────────────────────────────
// Settings Schema
// ─────────────────────────────────────────────

Devvit.addSettings([
  {
    name: SETTING_ENABLED,
    label: "Enable ModShield",
    helpText:
      "When enabled, ModShield tracks reported users and sends Modmail alerts " +
      "for repeat offenders. Disable to pause all activity without uninstalling.",
    type: "boolean",
    defaultValue: true,
    scope: SettingScope.Installation,
  },
  {
    name: SETTING_THRESHOLD,
    label: "Violation Threshold",
    helpText:
      "Number of reports a user must accumulate before a Modmail alert fires. " +
      "Defaults to 3. Minimum recommended value: 2.",
    type: "number",
    defaultValue: DEFAULT_VIOLATION_THRESHOLD,
    scope: SettingScope.Installation,
  },
  {
    name: SETTING_TEST_MODE,
    label: "Enable Test Mode (Dry Run)",
    helpText:
      "When active, ModShield still tracks violations and sends Modmail, but " +
      "subjects are tagged [TEST MODE - NO ACTION TAKEN]. Use this to verify " +
      "the setup before going live.",
    type: "boolean",
    defaultValue: false,
    scope: SettingScope.Installation,
  },
]);

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

export default Devvit;
