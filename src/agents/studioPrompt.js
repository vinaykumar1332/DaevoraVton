// AI Studio house prompt: rules added to EVERY generation prompt, plus view rules chosen by code from
// what the vision model saw in each photo (front / back / side ...). The model identifies; code decides,
// so the right instruction is always present (e.g. a back-facing pose with a front-only garment photo).

export const VIEWS = ['front', 'back', 'side', 'three-quarter', 'flat-lay', 'unknown'];
export const ROLES = ['model', 'garment', 'shoes', 'accessory', 'background', 'logo', 'pose', 'other'];

/** Always added: realism, identity, garment and logo fidelity, and adult-only content. */
export const HOUSE_RULES =
  'Studio rules: photorealistic fashion photograph with natural skin, hands and fabric. Keep the person’s face, body and skin tone ' +
  'exactly as in their photo. Reproduce every garment exactly: colour, fabric, print scale, embroidery, borders and fit. ' +
  'Reproduce logos, prints and text on garments exactly as in the photo, and never invent a brand or logo. ' +
  'Garments must sit naturally on the body with realistic folds and drape. Do not add items, text or people that were not asked for. ' +
  'Adults only, fully clothed, no nudity or sexual content. Only use people from the photos the user sent. ' +
  'Keep the face, expression and eye direction of the person unless asked. Keep the sharpness and detail of a print-quality photograph.';

/** Short descriptive fields the vision model fills per garment (kept short so prompts stay focused). */
const GARMENT_TEXT = [
  ['pattern', 120], // print or pattern, scale and arrangement
  ['colors', 80],
  ['fabric', 60],
  ['details', 160], // embroidery, borders, buttons, zips, stitching
  ['logo_text', 40], // exact visible text or logo name, if readable
  ['unclear', 160], // what cannot be seen in the photo
];

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) || null : null);

const TUCK = ['in', 'out'];
const SLEEVES = ['down', 'rolled'];
const FIT = ['loose', 'fitted'];
const POSE = ['keep', 'change', 'reference'];
const MODEL = ['keep', 'change'];

const cleanItems = (v) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x.replace(/[\r\n]+/g, ' ').trim().slice(0, 40) : ''))
    .filter(Boolean)
    .slice(0, 5);

/** Cleans the styling choices from the chat assistant. Unknown values become null or [] (no rule). */
export function normalizeStyling(raw = {}) {
  const pick = (v, allowed) => (allowed.includes(v) ? v : null);
  return {
    tuck: pick(raw?.tuck, TUCK),
    sleeves: pick(raw?.sleeves, SLEEVES),
    fit: pick(raw?.fit, FIT),
    pose: pick(raw?.pose, POSE),
    model: pick(raw?.model, MODEL),
    add: cleanItems(raw?.add),
    remove: cleanItems(raw?.remove),
  };
}

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
export function buildPrompt({ prompt, notes = [], usePhotos = [], usePrevious = false, outputView = 'front', styling = {} }) {
  const { tuck, sleeves, fit, pose, model, add, remove } = normalizeStyling(styling);
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

  // Tops are untucked unless the user asked for them tucked in (the source photo may show them tucked).
  const tops = garments.filter((g) => g.length === 'upper').map((g) => g.image);
  if (tuck === 'in') {
    rules.push('Tuck the top neatly into the trousers at the waistband, as the user asked.');
  } else if (tops.length) {
    rules.push(`${list(tops)} ${tops.length === 1 ? 'is a top' : 'are tops'}: wear it untucked, hanging over the waistband of the trousers, not inside them, even if the photo shows it tucked.`);
  }
  if (sleeves === 'rolled' && tops.length) rules.push('Roll the sleeves up neatly to the elbow.');
  if (sleeves === 'down' && tops.length) rules.push('Keep the sleeves fully down.');
  if (fit === 'loose' && garments.length) rules.push('Relaxed, loose fit that drapes naturally.');
  if (fit === 'fitted' && garments.length) rules.push('Close, tailored fit that follows the body.');

  // Logos and prints: keep the ones on the garment exactly; print a logo photo the user sent.
  const logoOnGarment = garments.filter((g) => g.logo).map((g) => g.image);
  if (logoOnGarment.length) {
    rules.push(`${list(logoOnGarment)} ${logoOnGarment.length === 1 ? 'has a logo or print' : 'have logos or prints'}: keep the same design, colours, size and position on the garment as in the photo.`);
  }

  // Per-garment details from the analysis: keep exactly what is visible, and say what is not.
  for (const g of garments) {
    const facts = [
      g.colors && `colours: ${g.colors}`,
      g.fabric && `fabric: ${g.fabric}`,
      g.pattern && `print or pattern: ${g.pattern}`,
      g.details && `details to keep: ${g.details}`,
      g.logo_text && `text or logo: ${g.logo_text}`,
    ].filter(Boolean);
    if (facts.length) rules.push(`Garment in image ${g.image} (${facts.join('; ')}): reproduce these exactly, at the same scale and placement.`);
  }
  const unclear = garments.filter((g) => g.unclear).map((g) => `image ${g.image}: ${g.unclear}.`);
  if (unclear.length) rules.push(`Parts not visible in the photos, so do not invent them: ${unclear.join(' ')}`);

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
  if (of('logo').length) {
    rules.push(
      `Print the logo from ${list(of('logo'))} onto the garment where the user asked (the chest if not stated): flat, at a realistic size, following the fabric folds, with clean edges and the logo’s original colours.`
    );
  }

  // Pose, model, objects, accessories and light: each only when asked, or when something is visible.
  const poseRefs = of('pose');
  if (pose === 'change') rules.push('Change the pose as the user asked, keeping the same person, proportions, face and clothing.');
  else if (pose === 'reference' && poseRefs.length) {
    rules.push(`Match the body pose of ${list(poseRefs)} (the pose reference), keeping the same person, face, proportions and clothing.`);
  }
  if (model === 'change' && models.length) {
    const newModel = models[models.length - 1].image;
    rules.push(`Replace the person with the one from image ${newModel}: their face, hair, body and skin tone. Keep the garments, pose, framing and background.`);
  }
  if (add.length) rules.push(`Add ${add.join(', ')} to the look, worn or placed naturally on the person, at a realistic scale, with matching light and shadow.`);
  if (remove.length) rules.push(`Remove ${remove.join(', ')} from the image and rebuild the area naturally.`);
  if (models.length) {
    rules.push('Keep any accessories visible on the person (a watch, jewellery, glasses, a bag) exactly as in the photo, unless the user asked to remove them.');
    if (!of('background').length) rules.push('Keep the original background and lighting of the model photo.');
  }
  if (garments.length || models.length || add.length) {
    rules.push('Keep colours true to the photos, with no colour shift or oversaturation. Light and shadow match the scene, with soft, realistic shadows under and around the garments.');
  }

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
    if (note.role === 'garment' && n.logo === true) note.logo = true;
    if (note.role === 'garment') {
      for (const [key, max] of GARMENT_TEXT) {
        const t = cleanText(n[key], max);
        if (t) note[key] = t;
      }
    }
    if (note.role === 'garment' && ['upper', 'lower', 'full'].includes(n.length)) note.length = n.length;
    if (note.role === 'model' && ['full', 'partial'].includes(n.framing)) note.framing = n.framing;
    out.push(note);
  }
  return out;
}

export const normalizeView = (v) => (['front', 'back', 'side', 'three-quarter'].includes(v) ? v : 'front');
