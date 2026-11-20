// AI Studio house prompt: rules added to EVERY generation prompt, plus view rules chosen by code from
// what the vision model saw in each photo (front / back / side ...). The model identifies; code decides,
// so the right instruction is always present (e.g. a back-facing pose with a front-only garment photo).

export const VIEWS = ['front', 'back', 'side', 'three-quarter', 'flat-lay', 'unknown'];
export const ROLES = ['model', 'garment', 'shoes', 'accessory', 'background', 'other'];

/** Always added: realism, identity and garment fidelity. Kept short so the specific prompt stays in charge. */
export const HOUSE_RULES =
  'Studio rules: photorealistic fashion photograph with natural skin, hands and fabric. Keep the person’s face, body and skin tone ' +
  'exactly as in their photo. Reproduce every garment exactly: colour, fabric, print scale, embroidery, borders and fit. ' +
  'Garments must sit naturally on the body with realistic folds and drape. Do not add items, text, logos or people that were not asked for.';

const list = (nums) => (nums.length === 1 ? `image ${nums[0]}` : `images ${nums.slice(0, -1).join(', ')} and ${nums.at(-1)}`);

/**
 * @param {object} p
 * @param {string} p.prompt        the assistant's own prompt for this look
 * @param {Array<{photo:number, role:string, view:string}>} p.notes  what the vision model saw, by session photo number
 * @param {number[]} p.usePhotos   session photo numbers sent to the engine, in order
 * @param {boolean} p.usePrevious  true when the previous result is sent first (as image 1)
 * @param {string} p.outputView    the view of the final image: front | back | side | three-quarter
 * @returns {string} the full prompt sent to the image engine
 */
export function buildPrompt({ prompt, notes = [], usePhotos = [], usePrevious = false, outputView = 'front' }) {
  // session photo number -> engine image number
  const imageOf = (photo) => {
    const i = usePhotos.indexOf(photo);
    return i < 0 ? null : i + 1 + (usePrevious ? 1 : 0);
  };
  const used = notes.map((n) => ({ ...n, image: imageOf(n.photo) })).filter((n) => n.image);
  const garments = used.filter((n) => n.role === 'garment');
  const fronts = garments.filter((g) => g.view === 'front' || g.view === 'flat-lay' || g.view === 'unknown').map((g) => g.image);
  const backs = garments.filter((g) => g.view === 'back').map((g) => g.image);
  const angled = outputView === 'back' || outputView === 'side' || outputView === 'three-quarter';

  const rules = [];
  if (garments.length) {
    if (backs.length && fronts.length) {
      rules.push(`${list(backs)} ${backs.length === 1 ? 'shows' : 'show'} the back of the garment in ${list(fronts)}: use ${backs.length === 1 ? 'it' : 'them'} for the back details only, not as a separate item.`);
    }
    if (angled && !backs.length) {
      rules.push(
        `The pose shows the ${outputView === 'back' ? 'back' : `${outputView} view`} of the person, but the garment photos (${list(fronts)}) show only the front. ` +
          'Keep the person’s pose and work out the unseen back of the garment from how this kind of garment is made: the same fabric, colour, print scale and borders continue around the body ' +
          '(for example a saree pallu drapes over the shoulder and falls down the back, a blouse or shirt has a plain back panel or yoke). ' +
          'Do not copy front-only details to the back: no buttons, plackets, pockets, logos, front prints or text on the back.'
      );
    }
    if (!angled && backs.length && !fronts.length) {
      rules.push(
        `The garment photos (${list(backs)}) show only the back, but the final image is front-facing. Work out the front from how this kind of garment is made, ` +
          'keeping the same fabric, colour, print and borders, and do not invent front details such as logos or text.'
      );
    }
  }
  if (angled) rules.push(`Final framing: ${outputView === 'back' ? 'back view' : `${outputView} view`}, matching the pose.`);

  // ---- whatever else the user sent: each kind of input gets its own instruction ----
  const of = (role) => used.filter((n) => n.role === role).map((n) => n.image);
  const models = used.filter((n) => n.role === 'model');
  const worn = garments.filter((g) => g.worn).map((g) => g.image);
  const flat = garments.filter((g) => g.view === 'flat-lay').map((g) => g.image);

  if (garments.length && !models.length && !usePrevious) {
    rules.push('No model photo was given: create one realistic model who suits these garments (fit, size and style), shown full body in a natural pose.');
  }
  if (worn.length) {
    rules.push(`${list(worn)} ${worn.length === 1 ? 'shows the garment' : 'show garments'} worn by someone else: copy only the garment, never that person’s face, body, pose or background.`);
  }
  if (flat.length) rules.push(`${list(flat)} ${flat.length === 1 ? 'is a garment' : 'are garments'} laid flat: put ${flat.length === 1 ? 'it' : 'them'} on the body with a natural fit, drape and folds.`);
  if (models.some((m) => m.framing === 'partial') && garments.some((g) => g.length === 'full')) {
    rules.push('The model photo is cropped, but the garment is full length: show the whole outfit, extending the figure naturally with the same face and body proportions.');
  }
  if (of('background').length) {
    rules.push(`Place the person in the setting from ${list(of('background'))}: match its light direction, colour and perspective, and keep the person and the outfit unchanged.`);
  }
  if (of('shoes').length) rules.push(`Replace the footwear with the shoes from ${list(of('shoes'))}, exactly as shown.`);
  if (of('accessory').length) rules.push(`Add the accessory from ${list(of('accessory'))} exactly as shown, worn or held naturally.`);

  return [String(prompt ?? '').trim(), rules.join(' '), HOUSE_RULES].filter(Boolean).join('\n\n').slice(0, 10000);
}

/** Cleans the vision model's notes: known roles / views only, valid photo numbers only, one note per photo. */
export function normalizeNotes(raw, photoCount) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const n of raw) {
    const photo = Number(n?.photo);
    if (!Number.isInteger(photo) || photo < 1 || photo > photoCount || seen.has(photo)) continue;
    seen.add(photo);
    const note = {
      photo,
      role: ROLES.includes(n.role) ? n.role : 'other',
      view: VIEWS.includes(n.view) ? n.view : 'unknown',
    };
    // optional details, only kept where they mean something
    if (note.role === 'garment' && n.worn === true) note.worn = true;
    if (note.role === 'garment' && ['upper', 'lower', 'full'].includes(n.length)) note.length = n.length;
    if (note.role === 'model' && ['full', 'partial'].includes(n.framing)) note.framing = n.framing;
    out.push(note);
  }
  return out;
}

export const normalizeView = (v) => (['front', 'back', 'side', 'three-quarter'].includes(v) ? v : 'front');
