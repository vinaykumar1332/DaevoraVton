// Vercel Function: POST /api/chat/turn
// Runs one chat turn: OpenAI reads photos + history, decides what to do,
// builds the full engine prompt (with house rules + view rules) server-side.
// Returns the standard chatTurn shape plus enginePrompt.
import { chatTurnHandler } from '../../backend/handlers/chat.js';

export default chatTurnHandler;
