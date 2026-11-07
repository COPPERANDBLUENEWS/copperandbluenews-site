// Usernames for AirHockey accounts. Email is not collected yet.
// The normalized key is what uniqueness, profanity, and impersonation checks use.
const RESERVED = ["admin", "administrator", "moderator", "copperandblue", "copperandbluenews", "oilers", "nhl", "official", "webmaster", "sysadmin", "staff", "support"];
const PROFANITY = ["fuck", "fock", "fuk", "fvck", "phuck", "shit", "shyt", "bitch", "biatch", "cunt", "dick", "cock", "pussy", "asshole", "bastard", "slut", "whore", "nigger", "nigga", "faggot", "fagot", "retard", "porn", "nazi", "rapist"];

export function normalizeName(name) {
  return String(name).toLowerCase()
    .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
    .replace(/[^a-z]/g, "");
}

export function validateUsername(raw) {
  if (typeof raw !== "string") return {error: "Use 3–16 letters, numbers, or underscores."};
  const username = raw.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return {error: "Use 3–16 letters, numbers, or underscores."};
  const key = normalizeName(username);
  if (key.length < 3) return {error: "Use 3–16 letters, numbers, or underscores."};
  if (RESERVED.some(word => key.includes(word)) || PROFANITY.some(word => key.includes(word))) return {error: "Pick a different username."};
  return {username, key};
}
