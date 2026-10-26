// Fixed US creator categories. Each phrase is one youtube_pull_queue
// row (kind category_query). The daily pull spends the budget and
// resumes the pending rows the next day.

export interface YoutubeCategorySet {
  id: string;
  phrases: string[];
}

export const YOUTUBE_CATEGORY_SETS: readonly YoutubeCategorySet[] = [
  {
    id: "health",
    phrases: ["health tips", "healthy living", "doctor explains", "preventive health", "chronic illness"],
  },
  {
    id: "fitness",
    phrases: ["home workout", "strength training", "fitness coach", "gym workout", "running training"],
  },
  {
    id: "nutrition",
    phrases: ["nutrition advice", "healthy recipes", "meal prep", "registered dietitian", "what I eat in a day"],
  },
  {
    id: "womens-health",
    phrases: ["womens health", "hormones women", "pregnancy health", "menopause", "cycle syncing"],
  },
  {
    id: "mental-health",
    phrases: ["mental health", "anxiety tips", "therapy explained", "mindfulness practice", "depression help"],
  },
  {
    id: "personal-finance",
    phrases: ["personal finance", "budgeting tips", "money habits", "debt free journey", "saving money"],
  },
  {
    id: "investing",
    phrases: ["investing for beginners", "stock market explained", "index funds", "retirement investing", "portfolio review"],
  },
  {
    id: "business",
    phrases: ["entrepreneurship", "small business tips", "startup founder story", "how I built my business", "business advice"],
  },
  {
    id: "tech",
    phrases: ["tech review", "consumer technology", "software tutorial", "AI tools explained", "gadget review"],
  },
  {
    id: "gaming",
    phrases: ["gaming commentary", "lets play", "game review", "esports highlights", "video game news"],
  },
  {
    id: "parenting",
    phrases: ["parenting advice", "mom life vlog", "family vlog", "raising kids", "new parents"],
  },
  {
    id: "food",
    phrases: ["cooking channel", "easy recipes", "home cooking", "baking recipes", "weeknight meals"],
  },
  {
    id: "beauty",
    phrases: ["makeup tutorial", "skincare routine", "beauty review", "hair tutorial", "clean beauty"],
  },
  {
    id: "outdoors",
    phrases: ["hiking trail", "camping gear", "outdoor adventure", "fishing tips", "backpacking trip"],
  },
  {
    id: "true-crime",
    phrases: ["true crime", "unsolved mystery", "crime documentary", "cold case", "forensic investigation"],
  },
  {
    id: "comedy",
    phrases: ["comedy commentary", "standup comedy", "funny stories", "sketch comedy", "reaction commentary"],
  },
  {
    id: "education",
    phrases: ["science explained", "education channel", "history explained", "space science", "how things work"],
  },
  {
    id: "home",
    phrases: ["home DIY", "home renovation", "woodworking projects", "interior design tips", "house projects"],
  },
  {
    id: "cars",
    phrases: ["car review", "auto repair", "car enthusiast", "electric vehicles", "used car buying"],
  },
  {
    id: "sports",
    phrases: ["sports commentary", "game analysis", "athlete training", "fantasy football", "sports highlights"],
  },
];

/** One queue value per phrase, in category order. */
export function categoryQueueValues(): string[] {
  return YOUTUBE_CATEGORY_SETS.flatMap((set) => set.phrases);
}
