/**
 * Words a leaderboard name may not contain (rules.ts nameProblem) — slurs, obscenities and hate
 * symbols in English, German, French and Italian (and a little Spanish). It is a filter, not a
 * moderator: it catches the usual words and their usual disguises (spacing, l33t, look-alike
 * letters, stretched letters), not everything. Written plainly, folded and shortened in rules.ts.
 *
 * Three kinds: words blocked anywhere in a name (even joined to others), words blocked only as a
 * whole word (they hide innocently inside ordinary ones), and number codes. ALLOWED_INSIDE lists
 * ordinary words that contain a blocked one, taken out before the check.
 */

export const BLOCKED_ANYWHERE: string[] = [
  // English
  "fuck", "shit", "cunt", "bitch", "whore", "slut", "nigger", "nigga", "tranny", "wetback", "rapist", "asshole", "pussy", "wank", "twat",
  "cocksucker", "porn", "penis", "vagina", "dildo", "jizz", "bastard", "paedophile", "pedophile",
  "hitler", "siegheil", "heilhitler", "whitepower", "whitepride",
  // German
  "fick", "fotze", "hurensohn", "wichser", "arschloch", "schlampe", "schwuchtel", "neger", "kanake", "zigeuner", "judensau",
  "untermensch", "missgeburt",
  // French
  "putain", "salope", "connard", "connasse", "encule", "bougnoule", "batard", "negre",
  // Italian
  "cazzo", "vaffanculo", "stronzo", "puttana", "frocio", "coglione", "minchia",
  // Spanish
  "maricon", "pendejo",
];

export const BLOCKED_WORDS: string[] = [
  // English
  "fuk", "fag", "fags", "faggot", "faggots", "retard", "retarded", "rape", "pedo", "paedo", "kike", "spic", "chink", "gook", "coon", "dyke", "beaner",
  "kys", "nazi", "nazis", "heil", "cum", "sex", "anal", "anus", "ass", "dick", "cock", "tits", "boobs",
  // German
  "hure", "arsch", "nutte", "spast", "spasti", "spacko", "mongo",
  // French
  "pute", "nique", "ntm", "pd", "tapette", "merde",
  // Italian
  "troia", "negro",
  // Spanish
  "puta",
  // Posing as the game's staff
  "admin", "administrator", "moderator",
];

export const BLOCKED_RAW: RegExp[] = [/kkk/, /1488/, /14w88/];

export const ALLOWED_INSIDE: string[] = [
  "scunthorpe", "shiitake", "shitake", "matsushita", "therapist", "penistone", "nigeria", "swank", "fickle", "pussycat",
];
