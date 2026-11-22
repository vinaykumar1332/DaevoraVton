// Quality gate for a finished look. One config object holds the thresholds, so they are easy to change.

export const QUALITY_THRESHOLDS = { match: 85, face: 85, pose: 80, garment: 85 };

/** A look passes when the overall match and the face, pose and garment scores all reach their thresholds. */
export function passes(areas = {}, match = 0) {
  const t = QUALITY_THRESHOLDS;
  return match >= t.match && (areas.face ?? 0) >= t.face && (areas.pose ?? 0) >= t.pose && (areas.garment ?? 0) >= t.garment;
}

/** The line added to the engine prompt for the single automatic retry. */
export function retryInstruction(problems = []) {
  const details = problems
    .map((p) => p?.detail)
    .filter((d) => typeof d === 'string' && d.trim())
    .slice(0, 5)
    .join(' ');
  return details
    ? `Fix these problems from the previous attempt: ${details}`
    : 'Improve how closely the look follows the photos and the request from the previous attempt.';
}
