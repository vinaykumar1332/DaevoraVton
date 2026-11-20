// User-facing wording. Technical details (codes, job ids, endpoints) stay out of the UI
// and go to the browser console instead.

const ERRORS = {
  UnauthorizedAccess: ['Setup needed', 'The service is not connected yet. Ask the admin to check the settings.'],
  RateLimitExceeded: ['Busy right now', 'Too many requests at once. Wait a moment and try again.'],
  ConcurrencyLimitExceeded: ['Busy right now', 'Several images are already being made. Wait for one to finish.'],
  RateLimit: ['Busy right now', 'Too many requests at once. Wait a moment and try again.'],
  OutOfCredits: ['Not enough credits', 'Top up your credits, then try again.'],
  BadRequest: ['Check your photos', 'The photos or settings were not accepted. Try different photos or a shorter prompt.'],
  NoImageGenerated: ['No image was made', 'Try different photos, or describe the look more clearly.'],
  ImageLoadError: ['A photo could not be read', 'Upload the photo again as a JPEG or PNG.'],
  InputValidationError: ['Check your photos', 'A photo has an unsupported size or format. Try a different one.'],
  ContentModerationError: ['Blocked by content rules', 'Change the photos or wording and try again.'],
  AgentTimeout: ['Took too long', 'Try again, or choose a faster quality setting.'],
  NotFound: ['No longer available', 'That result has expired. Create it again.'],
  PipelineError: ['Could not finish the image', 'Try again, or change the photos.'],
  PromptError: ['Could not write the prompt', 'Try again, or write the prompt yourself.'],
  Canceled: ['Cancelled', 'The image was cancelled.'],
  TooManyPhotos: ['Too many photos', 'Use up to 6 photos in one run, for example drop the accessory or the background photo.'],
};

export function friendlyError(e) {
  const code = e?.code || e?.name || '';
  let title;
  let detail;
  if (ERRORS[code]) [title, detail] = ERRORS[code];
  else if (e?.status === 401) [title, detail] = ['Setup needed', 'The AI service is not connected yet. Ask the admin to check the settings.'];
  else if (code.startsWith('OpenAI') || code.includes('openai')) [title, detail] = ['AI writer unavailable', 'Try again in a moment.'];
  else [title, detail] = ['Something went wrong', 'Please try again. If it keeps happening, check your photos and settings.'];

  // Developers can still see the real error here.
  console.warn('[studio] error', e);
  return { title, detail, code };
}

/** Friendly progress text for a FASHN job status. */
export function friendlyStatus(s) {
  return (
    {
      starting: 'Starting…',
      in_queue: 'Waiting in line…',
      processing: 'Creating your image…',
      completed: 'Finishing up…',
    }[s] ?? 'Working…'
  );
}
