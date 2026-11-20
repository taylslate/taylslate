import { DEFAULT_PODSCAN_BUDGET } from "./rate-limit";

export interface ImportArgs {
  commit: boolean;
  dryRunExplicit: boolean;
  fresh: boolean;
  partial: boolean;
  floorSponsored: boolean;
  noEnrich: boolean;
  floor: number | null;
  confirm: number | null;
  sample: number | null;
  maxPodscanCalls: number;
  activeDays: number;
  language: string;
  region: string | null;
}

export function parseArgs(argv: readonly string[]): ImportArgs {
  const args: ImportArgs = {
    commit: false,
    dryRunExplicit: false,
    fresh: false,
    partial: false,
    floorSponsored: false,
    noEnrich: false,
    floor: null,
    confirm: null,
    sample: null,
    maxPodscanCalls: DEFAULT_PODSCAN_BUDGET,
    activeDays: 365,
    language: "en",
    region: null,
  };
  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;
    if (token === "--") continue;
    if (token === "--dry-run") {
      args.dryRunExplicit = true;
      continue;
    }
    if (token === "--commit") {
      args.commit = true;
      continue;
    }
    if (token === "--fresh") {
      args.fresh = true;
      continue;
    }
    if (token === "--partial") {
      args.partial = true;
      continue;
    }
    if (token === "--floor-sponsored") {
      args.floorSponsored = true;
      continue;
    }
    if (token === "--no-enrich") {
      args.noEnrich = true;
      continue;
    }
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? null : token.slice(eq + 1);
    const value = inline == null || inline === "" ? rest.shift() : inline;
    if (value == null || value.startsWith("--")) {
      throw new Error("Missing a flag value.");
    }
    if (flag === "--floor") args.floor = parseWhole(value);
    else if (flag === "--confirm") args.confirm = parseWhole(value);
    else if (flag === "--sample") args.sample = parseWhole(value);
    else if (flag === "--max-podscan-calls") args.maxPodscanCalls = parseWhole(value);
    else if (flag === "--active-days") args.activeDays = parseWhole(value);
    else if (flag === "--language") args.language = value;
    else if (flag === "--region") args.region = value;
    else throw new Error("Unknown flag.");
  }
  return args;
}

function parseWhole(value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error("Bad number.");
  return Number(value);
}
