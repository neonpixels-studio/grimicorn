import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isMainModule } from "./is-main-module.mjs";

export const REMINDER_THRESHOLD_DAYS = 60;
export const SECURITY_TXT_PATH = "public/.well-known/security.txt";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRES_FIELD_PATTERN = /^expires:[ \t]*(.+?)[ \t\r]*$/im;
const RFC3339_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export class SecurityTxtExpiryError extends Error {}

export function parseExpires(content) {
  const match = content.match(EXPIRES_FIELD_PATTERN);
  if (!match) {
    throw new SecurityTxtExpiryError("security.txt has no Expires field.");
  }
  const value = match[1];
  const expires = new Date(value);
  if (!RFC3339_UTC_TIMESTAMP.test(value) || Number.isNaN(expires.getTime())) {
    throw new SecurityTxtExpiryError(
      `security.txt Expires is not an RFC 3339 UTC timestamp: ${value}`,
    );
  }
  return expires;
}

// Whole days, rounded down; negative once the file has already expired.
export function daysUntil(expires, now) {
  return Math.floor((expires.getTime() - now.getTime()) / MILLISECONDS_PER_DAY);
}

export function evaluateExpiry({
  content,
  now,
  thresholdDays = REMINDER_THRESHOLD_DAYS,
}) {
  const expires = parseExpires(content);
  const daysRemaining = daysUntil(expires, now);
  return {
    due: daysRemaining <= thresholdDays,
    daysRemaining,
    expires: expires.toISOString(),
  };
}

export function buildIssueBody({ daysRemaining, expires }) {
  const state =
    daysRemaining < 0
      ? `expired ${-daysRemaining} day(s) ago`
      : `expires in ${daysRemaining} day(s)`;
  return [
    `\`${SECURITY_TXT_PATH}\` ${state} (Expires: ${expires}).`,
    "",
    `RFC 9116 requires a current Expires date. Bump it to about 11 months out in \`${SECURITY_TXT_PATH}\`; the workflow closes this issue on its next run after the change.`,
    "",
    "Opened by `.github/workflows/security-txt-expiry.yml`.",
  ].join("\n");
}

export function main(
  environment = process.env,
  now = new Date(),
  securityTxtPath = SECURITY_TXT_PATH,
) {
  const content = readFileSync(securityTxtPath, "utf8");
  const result = evaluateExpiry({ content, now });
  console.log(
    `security.txt expires ${result.expires} (${result.daysRemaining} days); reminder ${result.due ? "due" : "not due"}.`,
  );
  if (environment.GITHUB_OUTPUT) {
    appendFileSync(
      environment.GITHUB_OUTPUT,
      `due=${result.due}\ndays_remaining=${result.daysRemaining}\n`,
    );
  }
  if (result.due && environment.ISSUE_BODY_FILE) {
    writeFileSync(environment.ISSUE_BODY_FILE, buildIssueBody(result));
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  main();
}
