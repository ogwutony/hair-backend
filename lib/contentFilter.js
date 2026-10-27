// lib/contentFilter.js
// Objectionable-content filter (App Store Guideline 1.2: "a method for filtering objectionable content").
// Every piece of user-generated text (posts, comments, messages, profile names) is checked before it is
// saved. Matches are rejected with a friendly message so the member can rephrase.
//
// The list is intentionally conservative: slurs, explicit sexual terms, threats and common spam/scam
// phrases. Add more terms with the CONTENT_FILTER_EXTRA_TERMS env var (comma-separated).

const BASE_TERMS = [
  // slurs and hate speech (stems — matched as whole words, with common leetspeak normalised)
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'chink', 'spic', 'kike', 'wetback', 'tranny',
  'coon', 'gook', 'raghead', 'towelhead', 'beaner', 'dyke',
  // explicit sexual content
  'porn', 'porno', 'pornhub', 'xvideos', 'onlyfans', 'nudes', 'blowjob', 'handjob', 'cumshot', 'dick pic',
  'pussy', 'cock', 'whore', 'slut', 'rape', 'rapist', 'pedo', 'pedophile', 'child porn', 'cp link',
  // violence / threats
  'kill yourself', 'kys', 'i will kill you', 'shoot you', 'bomb threat', 'go die',
  // harassment
  'motherfucker', 'fuck you', 'cunt', 'bitch',
  // scams / spam
  'cash app me', 'send me bitcoin', 'crypto giveaway', 'double your money', 'telegram me for',
];

const EXTRA_TERMS = String(process.env.CONTENT_FILTER_EXTRA_TERMS || '')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

const normalise = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[013457@$!]/g, (ch) => LEET[ch] || ch)
    .replace(/(.)\1{2,}/g, '$1$1') // "fuuuuck" → "fuuck"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS = [...new Set([...BASE_TERMS, ...EXTRA_TERMS])].map((term) => ({
  term,
  // whole word / phrase; allow an optional plural "s" or "z"
  re: new RegExp(`(^|\\s)${escapeRe(normalise(term)).replace(/ /g, '\\s+')}(s|z|es)?(?=\\s|$)`),
}));

/** Returns the first objectionable term found in any of the given values, or null. */
const findObjectionable = (...values) => {
  for (const value of values) {
    if (value == null) continue;
    const list = Array.isArray(value) ? value : typeof value === 'object' ? Object.values(value) : [value];
    for (const v of list) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const text = normalise(v);
      for (const { term, re } of PATTERNS) {
        if (re.test(text)) return term;
      }
    }
  }
  return null;
};

const FILTER_MESSAGE =
  'This contains language that breaks our Community Guidelines (zero tolerance for objectionable or abusive content). Please edit it and try again.';

/**
 * Express helper: responds 422 and returns true when any value is objectionable.
 * Usage: if (rejectIfObjectionable(res, req.body.text)) return;
 */
const rejectIfObjectionable = (res, ...values) => {
  const term = findObjectionable(...values);
  if (!term) return false;
  res.status(422).json({ error: FILTER_MESSAGE, code: 'OBJECTIONABLE_CONTENT' });
  return true;
};

module.exports = { findObjectionable, rejectIfObjectionable, FILTER_MESSAGE, normalise };
