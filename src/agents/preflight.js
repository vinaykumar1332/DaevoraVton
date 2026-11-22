// Checks a generation plan before the engine is called.
// Returns { ok: true, notice? } or { ok: false, question }. A question is shown to the user instead of generating.

const isRoleKnown = (fact) => !!fact && !!fact.role && fact.role !== 'other';

/**
 * plan: { usePrevious, usePhotos, outputView, styling }
 * facts: merged photo facts (photoFacts.js)
 */
export function preflight(plan, facts = []) {
  const { usePrevious = false, usePhotos = [], outputView = 'front', styling = {} } = plan;
  const factOf = (photo) => facts.find((f) => f.photo === photo);
  const used = usePhotos.map((photo) => ({ photo, fact: factOf(photo) }));

  const unknown = used.find((u) => !isRoleKnown(u.fact));
  if (unknown) {
    return { ok: false, question: `I can't tell what photo ${unknown.photo} shows. Is it the model, a garment, shoes, or something else?` };
  }

  const hasGarment = used.some((u) => u.fact.role === 'garment');
  if (!usePrevious && !hasGarment) {
    return { ok: false, question: 'Which garment should I use? Please send a photo of the garment.' };
  }

  if (styling.model === 'change') {
    const models = used.filter((u) => u.fact.role === 'model');
    if (models.length < 2) {
      return { ok: false, question: 'Which person should I put in the look? Please send their photo.' };
    }
  }

  const garmentBack = used.some((u) => u.fact.role === 'garment' && u.fact.view === 'back');
  const garmentUnclear = used.some((u) => u.fact.role === 'garment' && !!u.fact.unclear);
  if (outputView === 'back' && hasGarment && !garmentBack && garmentUnclear) {
    return { ok: true, notice: 'I will match the back to the fabric. A photo of the garment’s back gives exact details.' };
  }

  return { ok: true };
}
