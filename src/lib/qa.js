// Result quality check: the target, the colour for each score, and plain labels for the UI.
export const QA_TARGET = 90;

/** 'ok' at or above the target, 'warn' for 75-89, 'bad' below 75. */
export function qaTone(match) {
  if (match >= QA_TARGET) return 'ok';
  if (match >= 75) return 'warn';
  return 'bad';
}

export const QA_AREA_LABEL = {
  pose: 'Pose',
  garment: 'Garment',
  face: 'Face',
  colour: 'Colour',
  background: 'Background',
  accessories: 'Accessories',
};

export const QA_SOURCE_LABEL = {
  output: 'From the result',
  analysis: 'From reading the photos',
  request: 'From the request',
};
