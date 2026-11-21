// Re-export the shared prompt-building logic from src/.
// studioPrompt.js has no browser-specific code, so it runs fine in Node.js.
export { HOUSE_RULES, VIEWS, ROLES, buildPrompt, normalizeNotes, normalizeView, normalizeStyling } from '../../src/agents/studioPrompt.js';
