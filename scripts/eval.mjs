// Evaluation runner.
//   npm run eval          offline: checks each case's prompt against the rules it should contain (no API calls)
//   npm run eval -- --live  runs analysis-free chat turns on the photos in eval/images (uses OpenAI credits)
// Generation (FASHN) is not run here. Adding it needs an explicit approval, because it spends credits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'eval/cases/cases.json'), 'utf8')).cases;

const { buildPrompt } = await import(pathToFileURL(path.join(root, 'src/agents/studioPrompt.js')).href);

function validate(c) {
  const missing = ['id', 'title', 'inputs', 'userText', 'usePhotos', 'assumed', 'expect'].filter((k) => c[k] === undefined);
  if (missing.length) throw new Error(`case ${c.id ?? '?'} is missing ${missing.join(', ')}`);
}

function checkRules(prompt, expected) {
  return expected.map((pattern) => ({ pattern, ok: prompt.includes(pattern) }));
}

async function offline(c) {
  const prompt = buildPrompt({
    prompt: c.prompt,
    notes: c.assumed,
    usePhotos: c.usePhotos,
    usePrevious: c.usePrevious,
    outputView: c.outputView,
    styling: c.styling,
  });
  return checkRules(prompt, c.expect.rules);
}

async function liveRun(c) {
  const { chatTurn } = await import(pathToFileURL(path.join(root, 'backend/agents/chat.js')).href);
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const photos = c.inputs.map((input, i) => {
    const file = path.join(root, input.file);
    if (!fs.existsSync(file)) throw new Error(`missing image ${input.file}`);
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return { id: `p${i + 1}`, src: `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}` };
  });
  const turn = await chatTurn({ history: [], userText: c.userText, photos, newCount: photos.length, hasPrevious: c.usePrevious, openaiKey: key });
  const roleOk = turn.photo_notes.length > 0;
  return { turn, checks: [{ pattern: 'photo roles returned', ok: roleOk }, ...checkRules(turn.enginePrompt || '', c.expect.rules)] };
}

let failed = 0;
for (const c of cases) {
  validate(c);
  try {
    const checks = live ? (await liveRun(c)).checks : await offline(c);
    const bad = checks.filter((x) => !x.ok);
    failed += bad.length ? 1 : 0;
    console.log(`${bad.length ? 'FAIL' : 'pass'}  ${c.id}  ${c.title}`);
    for (const b of bad) console.log(`        missing: ${b.pattern}`);
  } catch (err) {
    failed += 1;
    console.log(`SKIP  ${c.id}  ${err.message}`);
  }
}
console.log(`\n${cases.length - failed} of ${cases.length} cases passed${live ? ' (live)' : ' (offline)'}.`);
process.exitCode = failed ? 1 : 0;
