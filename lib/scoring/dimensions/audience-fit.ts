// ============================================================
// AUDIENCE FIT SCORING (40% default weight)
// Scores 0-100 based on how well a show's demographics
// match the brand's target audience from their campaign brief.
// ============================================================

import type { PodscanDemographics } from "@/lib/podscan/types";
import type { CampaignBrief } from "@/lib/data/types";

/**
 * Score a show's audience fit against a brand's target demographics.
 * Returns 0-100. Returns null if no demographics data available.
 *
 * Scoring factors:
 * - Age distribution overlap with target age range (35 points)
 * - Gender match (20 points)
 * - Purchasing power alignment (20 points)
 * - Professional industry relevance via keyword matching (25 points)
 */
export function scoreAudienceFit(
  demographics: PodscanDemographics | null,
  brief: CampaignBrief
): number | null {
  if (!demographics) return null;

  let score = 0;

  // --- Age match (35 points) ---
  score += scoreAge(demographics, brief.target_age_range);

  // --- Gender match (20 points) ---
  score += scoreGender(demographics, brief.target_gender);

  // --- Purchasing power (20 points) ---
  score += scorePurchasingPower(demographics);

  // --- Professional industry relevance (25 points) ---
  score += scoreIndustryRelevance(demographics, brief);

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ---- Age scoring ----

const AGE_BRACKETS = ["0-18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

/**
 * Parse a target age range like "25-44" into constituent brackets.
 * Supports ranges ("25-44"), single brackets ("35-44"), and descriptors
 * ("18-34", "25+", "all").
 */
function parseTargetAgeBrackets(targetRange?: string): string[] {
  if (!targetRange || targetRange === "all") return AGE_BRACKETS;

  // Handle "25+" style
  if (targetRange.endsWith("+")) {
    const minAge = parseInt(targetRange, 10);
    return AGE_BRACKETS.filter((b) => {
      const bracketMin = parseInt(b, 10);
      return bracketMin >= minAge;
    });
  }

  const parts = targetRange.split("-").map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return AGE_BRACKETS;

  const [minAge, maxAge] = parts;
  return AGE_BRACKETS.filter((b) => {
    const bracketMin = parseInt(b, 10);
    const bracketMax = b === "65+" ? 100 : parseInt(b.split("-")[1], 10);
    // Bracket overlaps with target range
    return bracketMax >= minAge && bracketMin <= maxAge;
  });
}

function scoreAge(demo: PodscanDemographics, targetRange?: string): number {
  if (!demo.age_distribution || demo.age_distribution.length === 0) return 17; // neutral

  const targetBrackets = parseTargetAgeBrackets(targetRange);
  if (targetBrackets.length === AGE_BRACKETS.length) return 17; // no target = neutral

  // Sum the percentage of audience in target age brackets
  let targetPct = 0;
  for (const entry of demo.age_distribution) {
    if (targetBrackets.includes(entry.age)) {
      targetPct += entry.percentage;
    }
  }

  // 50%+ in target = full points, 20% = half, <10% = minimal
  if (targetPct >= 50) return 35;
  if (targetPct >= 40) return 30;
  if (targetPct >= 30) return 25;
  if (targetPct >= 20) return 18;
  if (targetPct >= 10) return 10;
  return 5;
}

// ---- Gender scoring ----

function scoreGender(demo: PodscanDemographics, targetGender?: string): number {
  if (!targetGender || targetGender === "all" || !demo.gender_skew) return 10; // neutral

  const skew = demo.gender_skew.toLowerCase();
  const target = targetGender.toLowerCase();

  if (target === "male" || target === "men") {
    if (skew.includes("heavily_male") || skew.includes("mostly_male")) return 20;
    if (skew.includes("leaning_male")) return 16;
    if (skew === "balanced" || skew === "mixed") return 12;
    return 5; // female-skewed audience for male target
  }

  if (target === "female" || target === "women") {
    if (skew.includes("heavily_female") || skew.includes("mostly_female")) return 20;
    if (skew.includes("leaning_female")) return 16;
    if (skew === "balanced" || skew === "mixed") return 12;
    return 5;
  }

  return 10; // "balanced" or unknown target
}

// ---- Purchasing power ----

function scorePurchasingPower(demo: PodscanDemographics): number {
  if (!demo.purchasing_power) return 10; // neutral

  // Higher purchasing power = more valuable for advertisers
  switch (demo.purchasing_power) {
    case "high": return 20;
    case "medium": return 14;
    case "low": return 8;
    default: return 10;
  }
}

// ---- Industry relevance ----

function scoreIndustryRelevance(
  demo: PodscanDemographics,
  brief: CampaignBrief
): number {
  if (!demo.professional_industry || demo.professional_industry.length === 0) return 12;

  // Build keyword set from brief interests + keywords
  const keywords = [
    ...brief.target_interests.map((i) => i.toLowerCase()),
    ...brief.keywords.map((k) => k.toLowerCase()),
  ];

  if (keywords.length === 0) return 12; // no targeting info

  // Check how many industry entries match brief keywords
  let matchedPct = 0;
  for (const entry of demo.professional_industry) {
    const industry = entry.industry.toLowerCase();
    const matches = keywords.some(
      (kw) => industry.includes(kw) || kw.includes(industry.split("/")[0].trim())
    );
    if (matches) {
      matchedPct += entry.percentage;
    }
  }

  // 15%+ relevant industry = full points
  if (matchedPct >= 15) return 25;
  if (matchedPct >= 10) return 20;
  if (matchedPct >= 5) return 15;
  if (matchedPct > 0) return 10;
  return 5;
}
