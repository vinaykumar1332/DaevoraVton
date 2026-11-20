// Vercel Function: POST /api/job/agent
// Starts a FASHN agent job server-side (key never reaches the browser).
// Returns { jobId }. The client then polls /fashn/v1/agent/status/:jobId.
import { agentJobHandler } from '../../backend/handlers/job.js';

export default agentJobHandler;
