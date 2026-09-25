// lib/rankTiers.js
// Single source of truth for The Majorities rank ladder on the backend.
// Keep in sync with hair-frontend/src/utils/constants.js and the mobile app.

const RANK_TIERS = [
  {
    title: "Nice and Helpful",
    min: 75000000,
    description: "The ultimate beacon of goodwill in The Majorities ecosystem. Unmatched dedication to keeping the community radiant and supportive."
  },
  {
    title: "Servant of the People",
    min: 50000000,
    description: "A revered leader devoted entirely to serving the collective needs, routines, and wellness of the public."
  },
  {
    title: "Servant of the Majorities",
    min: 45000000,
    description: "A pillar of the community who puts the needs of the collective catalog above all personal interests."
  },
  {
    title: "Generalissimo ",
    min: 43000000,
    description: "Supreme tactical commander overseeing the distribution, strategy, and direction of The Majorities."
  },
  {
    title: "General Secretary of The Majorities",
    min: 40000000,
    description: "Holds the highest administrative power, shaping platform directives, cultural policies, and community standards."
  },
  {
    title: "Premier of The Majorities",
    min: 35000000,
    description: "Head of executive operations, ensuring every movement across the platform functions with absolute precision."
  },
  {
    title: "Chairman of the Standing Committee of the Majorities Duma",
    min: 30000000,
    description: "Presides over legislative proposals, community votes, and high-level platform policy within The Duma."
  },
  {
    title: "Chairman of the National Committee of the Majorities Political Consultative",
    min: 25000000,
    description: "Gathers consensus across all branches of the community to guide upcoming product directives and initiatives."
  },
  {
    title: "Director of the General Office of the Majorities",
    min: 20000000,
    description: "Manages day-to-day central operations, internal communication flows, and high-priority platform routines."
  },
  {
    title: "Secretary of the Central Commission for Discipline Inspection",
    min: 15000000,
    description: "Guards community integrity by ensuring guidelines, standards, and fair interaction are strictly upheld."
  },
  {
    title: "Politburo Member of The Majorities",
    min: 10000000,
    description: "Part of the elite core governing body making critical policy decisions for the entire ecosystem."
  },
  {
    title: "Secretary of Majorities Committees of Provinces",
    min: 7500000,
    description: "Regional leaders mobilizing local networks, discussions, and grassroots engagement for the brand."
  },
  {
    title: "Commissar of the The Majorities",
    min: 5000000,
    description: "Enforces ideological harmony and high morale across forums and community channels."
  },
  {
    title: "Champion of the The Majorities",
    min: 4500000,
    description: "A celebrated advocate whose contributions and active presence set the benchmark for everyone else."
  },
  {
    title: "Hero of the Majorities",
    min: 4000000,
    description: "Awarded to members who have demonstrated extraordinary loyalty and long-term commitment to the platform."
  },
  {
    title: "Order of The Majorities",
    min: 3500000,
    description: "Inducted into the highest prestige order for outstanding service to the community catalog."
  },
  {
    title: "Order of the October Revolution",
    min: 3000000,
    description: "Recognizes members who spearheaded massive structural improvements or major viral trends."
  },
  {
    title: "Order of the Red Banner of Labor",
    min: 2500000,
    description: "Honors relentless work ethic, high post volume, and consistent participation in site activities."
  },
  {
    title: "Order of Friendship of Peoples",
    min: 2000000,
    description: "Celebrates those who bridge communities, welcome new members, and foster cross-forum unity."
  },
  {
    title: "Order of the Badge of Honor",
    min: 1500000,
    description: "A mark of distinction granted for exemplary participation and reliable engagement."
  },
  {
    title: "The Salvation of the Drowning",
    min: 1000000,
    description: "Given to helpful members who step in with quick answers and support when others need guidance."
  },
  {
    title: "Supreme Lizard King",
    min: 900000,
    description: "Cold-blooded, unbannable, and operating at the absolute peak of the shadow hierarchy. Controls the entire forum timeline."
  },
  {
    title: "Illuminati CEO",
    min: 800000,
    description: "Running global cosmetic agendas from a standing desk. Approves all secret box formulas behind closed doors."
  },
  {
    title: "Freemason Intern",
    min: 700000,
    description: "Secret handshakes are mandatory. One promotion away from dictating top-secret shampoo formulations."
  },
  {
    title: "Area 51 Landlord",
    min: 600000,
    description: "Keeps the absolute weirdest forum posts and classified beauty hacks locked safely inside restricted sub-boards."
  },
  {
    title: "Rothschild’s Left Hand",
    min: 500000,
    description: "Quietly funding custom 6-product bundles and gifting premium subscriptions across the shadow network."
  },
  {
    title: "Simulation Programmer",
    min: 400000,
    description: "Alters platform themes, post algorithms, and personal care recommendations at a whim."
  },
  {
    title: "Shadow Cabinet Secretary",
    min: 300000,
    description: "Secretly organizing hidden group chats and orchestrating behind-the-scenes discussions within The Duma."
  },
  {
    title: "Redacted Entity",
    min: 200000,
    description: "Blank avatar, mysterious history. Nobody knows who they are, but they are constantly accumulating points."
  },
  {
    title: "Chem-Trail Coordinator",
    min: 100000,
    description: "Spreading spicy takes, aromatic facial toners, and hot debate across all public culture feeds."
  },
  {
    title: "Controlled Opposition",
    min: 50000,
    description: "Intentionally starts friendly product debates in comment threads just to keep engagement metrics soaring."
  },
  {
    title: "Hologram Technician",
    min: 25000,
    description: "Maintains the flawless projection that this community is just a normal, everyday personal care brand."
  },
  {
    title: "Crisis Management Intern",
    min: 10000,
    description: "Sweeping accidental duplicate posts and deleted forum screenshots quietly under the rug."
  },
  {
    title: "Deep State Operative",
    min: 5000,
    description: "Clocking in daily to keep points tallies ticking and product routines running smoothly."
  },
  {
    title: "Subliminal Messenger",
    min: 2500,
    description: "Master of dropping subtle skincare tips and inside jokes disguised as casual forum thoughts."
  },
  {
    title: "Glitch in the Matrix",
    min: 1500,
    description: "Occasionally posts cryptic 60-second voice notes or perspective posts, then disappears into the shadows."
  },
  {
    title: "Birds-Aren't-Real Observer",
    min: 1000,
    description: "Spends way too much time staring out the window waiting for their monthly subscription delivery box."
  },
  {
    title: "Microchipped Normie",
    min: 500,
    description: "Completely compliant. Buys the full 6-product custom set and follows their regimen to the letter."
  },
  {
    title: "Tin Foil Apprentice",
    min: 250,
    description: "Starting to ask questions about the secret algorithms behind tier updates and point rewards."
  },
  {
    title: "Crisis Actor",
    min: 100,
    description: "Only shows up in comment sections when the community needs to simulate drama or boost active user counts."
  },
  {
    title: "Industry Plant",
    min: 50,
    description: "Placed here directly by upper management. Confused by the lore, but happy to build a custom set."
  },
  {
    title: "Comrade",
    min: 1,
    description: "First step into the fold. Welcome to the collective journey."
  }
];

const MAX_RANK_SCORE = RANK_TIERS[0].min;          // 75,000,000 — score cap
const POLITBURO_MIN = 10000000;                    // "Politburo Member of The Majorities"
const DEFAULT_RANK_TITLE = "Comrade";

// Always derive the title from the score so stale stored titles never leak out.
const getRankTitle = (score) => {
  const numeric = Number(score) || 1;
  for (const tier of RANK_TIERS) {
    if (numeric >= tier.min) return tier.title;
  }
  return DEFAULT_RANK_TITLE;
};

const getRankTier = (title) => RANK_TIERS.find(t => t.title === title) || null;

// Human-readable point bracket for a title, e.g. "500 - 999"
const getRankRange = (title) => {
  const idx = RANK_TIERS.findIndex(t => t.title === title);
  if (idx === -1) return "1 - 49";
  const min = RANK_TIERS[idx].min;
  if (idx === 0) return `${min.toLocaleString()}+`;
  return `${min.toLocaleString()} - ${(RANK_TIERS[idx - 1].min - 1).toLocaleString()}`;
};

const isPolitburoOrHigher = (score) => (Number(score) || 0) >= POLITBURO_MIN;

module.exports = {
  RANK_TIERS,
  MAX_RANK_SCORE,
  POLITBURO_MIN,
  DEFAULT_RANK_TITLE,
  getRankTitle,
  getRankTier,
  getRankRange,
  isPolitburoOrHigher,
};
