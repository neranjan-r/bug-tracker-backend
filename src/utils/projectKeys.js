const Project = require("../models/Project");

const PROJECT_KEY_REGEX = /^[A-Z]{2,5}$/;
const TICKET_KEY_REGEX = /^[A-Z]{2,5}-\d+$/;

/**
 * Derive a 2-5 uppercase letter key from a project title.
 */
function suggestProjectKey(title = "") {
  const words = String(title)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const wordLetters = words
    .map((w) => w.replace(/[^A-Z]/g, ""))
    .filter(Boolean);

  let candidate = "";
  if (wordLetters.length >= 2) {
    candidate = wordLetters
      .map((w) => w[0])
      .join("")
      .slice(0, 5);
  } else if (wordLetters.length === 1) {
    candidate = wordLetters[0].slice(0, 4);
  }

  if (candidate.length < 2) {
    const fallbackLetters = String(title)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    candidate = (candidate + fallbackLetters + "PRJ").slice(0, 3);
  }

  return candidate.slice(0, 5);
}

/**
 * Return a unique 2-5 letter key not currently used by another Project.
 */
async function generateUniqueProjectKey(title) {
  const base = suggestProjectKey(title);
  if (!(await Project.exists({ key: base }))) {
    return base;
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const prefix = base.slice(0, 4);
  for (const ch of alphabet) {
    const next = `${prefix}${ch}`.slice(0, 5);
    if (next.length >= 2 && !(await Project.exists({ key: next }))) {
      return next;
    }
  }

  // Fallback sweep across 3-letter combinations if needed
  for (let i = 0; i < alphabet.length; i += 1) {
    for (let j = 0; j < alphabet.length; j += 1) {
      const next = `${base.slice(0, 1)}${alphabet[i]}${alphabet[j]}`;
      if (!(await Project.exists({ key: next }))) {
        return next;
      }
    }
  }

  throw new Error("Could not generate a unique project key");
}

module.exports = {
  PROJECT_KEY_REGEX,
  TICKET_KEY_REGEX,
  suggestProjectKey,
  generateUniqueProjectKey,
};
