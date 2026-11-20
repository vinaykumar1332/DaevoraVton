// Vercel Function: POST /api/chat/enhance
// Rewrites a short user request into a clear, specific fashion instruction.
// Returns { text }.
import { chatEnhanceHandler } from '../../backend/handlers/chat.js';

export default chatEnhanceHandler;
