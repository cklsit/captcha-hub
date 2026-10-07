import type { ExtractedCode, Source } from '../shared/types';

/**
 * Verification-code extraction engine.
 *
 * Deliberately implemented as PURE functions (no IO, deterministic when a
 * `now` value is supplied) so it can be exhaustively unit tested.
 *
 * Strategy:
 *   1. Locate multi-language keyword anchors (验证码 / verification code ...).
 *   2. Collect candidate tokens: 4-8 digit runs (optionally `G-XXXXXX`) and
 *      5-8 char alphanumeric tokens containing both letters and digits.
 *   3. Score every candidate by proximity to a keyword, length heuristics and
 *      expiry hints, and subtract penalties for obvious distractors such as
 *      currency amounts, years or long order numbers.
 *   4. Return the best-scoring candidate (or null when nothing looks like a code).
 */

const ZH_KEYWORDS = [
  '验证码',
  '校验码',
  '动态码',
  '一次性密码',
  '验证码为',
  '校验码为',
  '动态密码',
  '口令码',
];

const EN_KEYWORDS = [
  'verification code',
  'verify code',
  'security code',
  'one-time password',
  'one time password',
  'one-time code',
  'authentication code',
  'confirmation code',
  'login code',
  'passcode',
  'code is',
  'your code',
  'otp',
];

interface KeywordHit {
  keyword: string;
  index: number;
}

interface Candidate {
  value: string;
  index: number;
  length: number;
  pureDigits: boolean;
}

export interface ExtractInput {
  subject?: string;
  text?: string;
  from?: string;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

function collectKeywordHits(lowerHaystack: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const keyword of [...ZH_KEYWORDS, ...EN_KEYWORDS]) {
    let from = 0;
    for (;;) {
      const index = lowerHaystack.indexOf(keyword, from);
      if (index === -1) break;
      hits.push({ keyword, index });
      from = index + keyword.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Character index of a matched group inside the original string. */
function groupIndex(match: RegExpExecArray, group: number): number {
  const prefix = match[0].slice(0, match[0].indexOf(match[group]));
  return match.index + prefix.length;
}

function collectCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const push = (value: string, index: number): void => {
    const key = `${index}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      value,
      index,
      length: value.length,
      pureDigits: /^\d+$/.test(value),
    });
  };

  // Google-style `G-123456`.
  const gCode = /(?:^|[^A-Za-z0-9])G-([A-Za-z0-9]{4,8})(?![A-Za-z0-9])/g;
  for (let m = gCode.exec(text); m; m = gCode.exec(text)) {
    push(m[1], groupIndex(m, 1));
  }

  // 4-8 digit runs (lookbehind/lookahead ensure we never slice a longer number).
  const numeric = /(?<![0-9])(\d{4,8})(?![0-9])/g;
  for (let m = numeric.exec(text); m; m = numeric.exec(text)) {
    push(m[1], groupIndex(m, 1));
  }

  // 5-8 char alphanumeric tokens with at least one letter and one digit.
  const alnum = /(?<![A-Za-z0-9])([A-Za-z0-9]{5,8})(?![A-Za-z0-9])/g;
  for (let m = alnum.exec(text); m; m = alnum.exec(text)) {
    const value = m[1];
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) {
      push(value, groupIndex(m, 1));
    }
  }

  return candidates;
}

function detectExpiry(text: string, now: number, index: number): number | null {
  const windowText = text.slice(Math.max(0, index - 80), index + 120);
  const match = windowText.match(
    /(\d{1,3})\s*(分钟|分|min|mins|minute|minutes|秒|sec|secs|second|seconds)/i,
  );
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const isMinute = unit.includes('分') || unit.startsWith('min') || unit.startsWith('minute');
  const seconds = isMinute ? value * 60 : value;
  return now + seconds * 1000;
}

function distractorPenalty(text: string, index: number, length: number): number {
  let penalty = 0;
  const before = text.slice(Math.max(0, index - 3), index);
  const after = text.slice(index + length, index + length + 6);

  if (/[¥$￥€]/.test(before)) penalty += 0.7;
  if (/(元|美元|usd|cny|rmb|金额|余额|价格)/i.test(after)) penalty += 0.3;

  // Years like 2024 / 1999 read as dates rather than codes.
  const year = text.slice(index, index + 4);
  if (/^(19|20)\d{2}$/.test(year) && length === 4) penalty += 0.2;

  // Long digit runs (order ids) get penalised while still allowing matches.
  if (length >= 7 && /^\d+$/.test(text.slice(index, index + length))) penalty += 0.1;

  return penalty;
}

interface ScoredCandidate {
  code: string;
  keyword: string | null;
  score: number;
  index: number;
}

function scoreCandidate(
  candidate: Candidate,
  keywordHits: KeywordHit[],
  haystack: string,
): ScoredCandidate {
  let score = 0;
  let keyword: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;

  for (const hit of keywordHits) {
    const distance = Math.abs(hit.index - candidate.index);
    if (distance < nearest) {
      nearest = distance;
      keyword = hit.keyword;
    }
  }

  if (nearest <= 24) score += 0.7;
  else if (nearest <= 60) score += 0.45;
  else if (nearest <= 160) score += 0.2;
  else {
    score += 0.08;
    keyword = null;
  }

  if (candidate.length >= 4 && candidate.length <= 6) score += 0.12;
  if (detectExpiry(haystack, 0, candidate.index) !== null) score += 0.1;

  score -= distractorPenalty(haystack, candidate.index, candidate.length);

  return { code: candidate.value, keyword, score: clamp01(score), index: candidate.index };
}

/**
 * Extracts the most likely verification code from a mail.
 *
 * @param input subject / body / sender of the mail.
 * @param now   reference time used for the expiry hint (injectable for tests).
 */
export function extractCode(input: ExtractInput, now: number = Date.now()): ExtractedCode | null {
  const subject = (input.subject ?? '').trim();
  const text = (input.text ?? '').trim();
  const haystack = `${subject}\n${text}`;
  if (!haystack.trim()) return null;

  const lowerHaystack = haystack.toLowerCase();
  const keywordHits = collectKeywordHits(lowerHaystack);
  const candidates = collectCandidates(haystack);
  if (candidates.length === 0) return null;

  let best: ScoredCandidate | null = null;
  for (const candidate of candidates) {
    const scored = scoreCandidate(candidate, keywordHits, haystack);
    if (!best || scored.score > best.score) best = scored;
  }
  if (!best) return null;

  const expiresAtHint = detectExpiry(haystack, now, best.index);
  return {
    code: best.code,
    confidence: clamp01(best.score),
    matchedKeyword: best.keyword,
    expiresAtHint,
  };
}

export interface MailForAssign {
  subject: string;
  from: string;
  text: string;
}

/**
 * Resolves which source a mail belongs to.
 * Phone sources win when their forwarding rule matches the mail; otherwise the
 * mail stays attributed to the email source it was fetched from.
 */
export function resolveSourceForMail(
  mail: MailForAssign,
  emailSourceId: string,
  allSources: Source[],
): { source: Source; matchedByRule: boolean } | null {
  const phoneSources = allSources.filter(
    (source) =>
      source.kind === 'phone' &&
      source.phone !== null &&
      source.phone.rule.emailSourceId === emailSourceId,
  );

  for (const phoneSource of phoneSources) {
    const rule = phoneSource.phone?.rule;
    if (!rule || !rule.matchKeyword) continue;
    const field =
      rule.matchField === 'subject'
        ? mail.subject
        : rule.matchField === 'from'
          ? mail.from
          : mail.text;
    if (field.toLowerCase().includes(rule.matchKeyword.toLowerCase())) {
      return { source: phoneSource, matchedByRule: true };
    }
  }

  const emailSource = allSources.find((source) => source.id === emailSourceId);
  if (emailSource) return { source: emailSource, matchedByRule: false };
  return null;
}
