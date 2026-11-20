// Outfit Studio workflows ("modes"). Each mode decides which photo slots are shown, which
// photos are sent to the Agent (with what labels) and what the prompt writer is told.
// The form fields live in engines.js and show/hide themselves with `inMode(...)`.

export const MAX_AGENT_PHOTOS = 6;

/** Labelled front/back entries for one garment: [[label, value], [label, value]]. */
const pair = (label, front, back) => [
  [back ? `${label}, FRONT view` : label, front],
  [`same ${label}, BACK view`, back],
];

export const ETHNIC_TYPES = [
  { label: 'Saree', value: 'saree' },
  { label: 'Lehenga choli', value: 'lehenga choli' },
  { label: 'Anarkali / kurta set', value: 'anarkali or kurta set' },
  { label: 'Salwar kameez', value: 'salwar kameez' },
  { label: 'Sherwani / kurta pyjama (menswear)', value: 'sherwani or kurta pyjama' },
  { label: 'Dhoti / mundu set', value: 'dhoti or mundu set' },
];
export const WITH_DUPATTA = ['lehenga choli', 'anarkali or kurta set', 'salwar kameez'];

export const SAREE_DRAPES = [
  { label: 'Nivi (classic)', value: 'Nivi style, pleats tucked at the waist, pallu over the left shoulder' },
  { label: 'Bengali', value: 'Bengali style with wide box pleats and the pallu draped over the left shoulder' },
  { label: 'Gujarati (seedha pallu)', value: 'Gujarati seedha pallu, the pallu brought from the back to the front over the right shoulder to show the border' },
  { label: 'Maharashtrian (nauvari)', value: 'Maharashtrian nauvari, a nine-yard saree draped between the legs like a dhoti' },
  { label: 'Lehenga style', value: 'lehenga style, pleated like a skirt with the pallu worn as a dupatta' },
  { label: 'Open pallu', value: 'open pallu, the pallu spread out to show its design' },
];

export const DUPATTA_STYLES = [
  { label: 'Over one shoulder', value: 'draped over one shoulder' },
  { label: 'Across both shoulders', value: 'draped across both shoulders in a U shape' },
  { label: 'Over the head', value: 'worn over the head as a veil' },
  { label: 'Cross-draped', value: 'cross-draped across the front' },
  { label: 'Loose around the neck', value: 'worn loosely around the neck' },
];

export const ETHNIC_SETTINGS = [
  { label: 'Wedding mandap', value: 'a wedding mandap with floral decor' },
  { label: 'Festive (marigold and diyas)', value: 'a festive setting with marigold garlands and diyas' },
  { label: 'Heritage palace courtyard', value: 'a heritage palace courtyard' },
  { label: 'Plain light studio', value: 'a plain light studio backdrop' },
];

export const OUTFIT_MODES = [
  {
    id: 'product',
    label: 'Product to model',
    short: 'Hanger, mannequin or pack shots',
    icon: 'Tag',
    blurb: 'Upload product photos of the garments (top, bottom or dress, shoes, accessory). They are worn by your model, or by a model we create.',
    photos: ['model', 'top', 'topBack', 'bottom', 'bottomBack', 'dress', 'dressBack', 'shoes', 'accessory', 'background'],
    pairs: [
      ['top', 'topBack', 'top'],
      ['bottom', 'bottomBack', 'bottom'],
      ['dress', 'dressBack', 'dress'],
    ],
    pieces: ['top', 'bottom', 'dress', 'shoes', 'accessory'],
    slots: (v) => [
      ...pair('top', v.top, v.topBack),
      ...pair('bottom', v.bottom, v.bottomBack),
      ...pair('dress / one-piece', v.dress, v.dressBack),
      ['shoes', v.shoes],
      ['accessory', v.accessory],
    ],
    instruct: () => [
      'The garment photos are product shots (hanger, ghost mannequin or packshot). Show each item worn naturally by the model, exactly as shown (colour, print, fabric, fit).',
    ],
  },
  {
    id: 'flat',
    label: 'Flat lay to model',
    short: 'Clothes laid flat on a surface',
    icon: 'LayoutGrid',
    blurb: 'Upload photos of clothes laid flat (a full outfit in one photo, or one piece each). They are turned into a worn look with a natural fit and drape.',
    photos: ['model', 'flatA', 'flatABack', 'flatB', 'flatBBack', 'shoes', 'accessory', 'background'],
    pairs: [
      ['flatA', 'flatABack', 'flat lay 1'],
      ['flatB', 'flatBBack', 'flat lay 2'],
    ],
    pieces: ['flatA', 'flatB', 'shoes', 'accessory'],
    slots: (v) => [
      ...pair('flat lay 1 (clothes laid flat)', v.flatA, v.flatABack),
      ...pair('flat lay 2 (clothes laid flat)', v.flatB, v.flatBBack),
      ['shoes', v.shoes],
      ['accessory', v.accessory],
    ],
    instruct: () => [
      'The garment photos are FLAT LAY photographs (clothes laid flat). Turn every garment in them into clothing worn by the model, with a natural fit, drape and folds. Do not copy the flat-lay surface, props, hangers or shadows.',
      'Keep colour, print, embroidery and proportions exactly as in the photos.',
    ],
  },
  {
    id: 'indian',
    label: 'Indian traditional wear',
    short: 'Saree, lehenga, kurta, sherwani',
    icon: 'Star',
    blurb: 'Pick the outfit type and style, then upload the garment. Borders, zari, embroidery and pallu details are kept as photographed.',
    photos: ['model', 'ind', 'indBack', 'indTop', 'dupatta', 'shoes', 'accessory', 'background'],
    pairs: [['ind', 'indBack', 'main garment']],
    pieces: ['ind', 'indTop', 'dupatta'],
    slots: (v) => [
      ...pair(v.ethnicType || 'traditional outfit', v.ind, v.indBack),
      ['blouse / choli / kurta top piece', v.indTop],
      ['dupatta / stole', v.dupatta],
      ['footwear', v.shoes],
      ['jewellery / accessory', v.accessory],
    ],
    instruct: (v) => {
      const type = v.ethnicType || 'saree';
      const lines = [
        `Dress the model in a ${type} using the garment photos. Reproduce every traditional detail exactly: zari and embroidery work, borders, pallu, print, colour and fabric drape.`,
      ];
      if (type === 'saree' && v.drape) lines.push(`Drape: ${v.drape}.`);
      if (WITH_DUPATTA.includes(type) && v.dupattaStyle) lines.push(`Dupatta: ${v.dupattaStyle}.`);
      if (/sherwani|dhoti/.test(type)) lines.push('This is menswear: style it with the correct fit. If no model photo is given, create a male model.');
      if (v.accessory) lines.push('Style the look with the jewellery or accessory shown.');
      if (v.indSetting) lines.push(`Setting: ${v.indSetting}.`);
      return lines;
    },
  },
];

export const modeOf = (v) => OUTFIT_MODES.find((m) => m.id === v?.mode) ?? OUTFIT_MODES[0];
export const inMode =
  (...ids) =>
  (v) =>
    ids.includes(modeOf(v).id);

export const countPhotos = (v, keys) => keys.reduce((n, k) => n + (v[k]?.src ? 1 : 0), 0);

/** Problems that stop Generate, as short phrases for "Still needed: …". */
export function outfitProblems(v) {
  const m = modeOf(v);
  const problems = [];
  for (const [front, back, name] of m.pairs) {
    if (v[back] && !v[front]) problems.push(`front photo of the ${name}`);
  }
  const n = countPhotos(v, m.photos);
  if (n > MAX_AGENT_PHOTOS) problems.push(`fewer photos (${n} of ${MAX_AGENT_PHOTOS} allowed)`);
  return problems;
}
