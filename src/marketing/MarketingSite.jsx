import { useEffect } from 'react';
import { Check, Download, Shirt, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import './marketing.css';

const TITLES = { landing: 'Fitting Room: try any look on', pricing: 'Pricing and credits · Fitting Room', about: 'About and FAQ · Fitting Room' };

const FAQ = [
  ['What do I need to start?', 'A photo of the person and a photo of the garment. Clear, well-lit photos give the best result. You can also add a background, shoes or an accessory photo.'],
  ['How long are my results kept?', 'About 3 days. Download the looks you want to keep.'],
  ['Can I change the pose or the model?', 'Yes. Ask for a different pose or model in the chat, and the studio keeps the outfit the same.'],
  ['Can I edit a result after it is made?', 'Yes. Crop, flip, rotate and adjust colour, then download at 1K, 2K, 3K or 4K.'],
  ['Do I need an account?', 'Yes. Sign in with the account your administrator created for you.'],
];

function SiteHeader({ page }) {
  const link = (href, label, id) => (
    <a href={href} className="mk-nav-link" aria-current={page === id ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <header className="mk-header">
      <a href="/" className="mk-brand" aria-label="Fitting Room home">
        <span className="mk-mark" aria-hidden="true"><Shirt /></span>
        Fitting Room
      </a>
      <nav className="mk-nav" aria-label="Site">
        {link('/pricing', 'Pricing', 'pricing')}
        {link('/about', 'About & FAQ', 'about')}
        <Button asChild variant="secondary" size="sm">
          <a href="/ai-studio">Sign in</a>
        </Button>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mk-footer">
      <span>Fitting Room · AI virtual try-on studio</span>
      <nav aria-label="Footer">
        <a href="/pricing">Pricing</a>
        <a href="/about">About & FAQ</a>
        <a href="/ai-studio">Sign in</a>
      </nav>
    </footer>
  );
}

function Landing() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-hero-copy">
          <p className="mk-eyebrow">AI virtual try-on</p>
          <h1>Try any look on, before it exists.</h1>
          <p className="mk-lead">Upload your photos, describe the outfit, and see it on a model in one chat.</p>
          <div className="mk-actions">
            <Button asChild variant="primary" size="lg">
              <a href="/ai-studio">Start styling</a>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="/pricing">See credits</a>
            </Button>
          </div>
        </div>
        <div className="mk-hero-img">
          <img src="/Images/Login1.webp" alt="A model wearing a styled outfit" width="1200" height="1400" fetchPriority="high" />
        </div>
      </section>

      <section className="mk-section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="mk-steps">
          <li>
            <span className="mk-step-n">1</span>
            <h3>Add your photos</h3>
            <p>A model, a garment, and optionally a background, shoes or an accessory.</p>
          </li>
          <li>
            <span className="mk-step-n">2</span>
            <h3>Describe the look</h3>
            <p>Say what you want in plain words. The studio writes the detailed instruction for you.</p>
          </li>
          <li>
            <span className="mk-step-n">3</span>
            <h3>Edit and download</h3>
            <p>Crop, flip and adjust colour, then download at the resolution you need.</p>
          </li>
        </ol>
      </section>

      <section className="mk-section mk-band" aria-labelledby="why">
        <h2 id="why">Made for real clothes</h2>
        <ul className="mk-checks">
          {['Keep a top untucked, tucked, or with sleeves rolled', 'Keep logos and prints exactly as in the photo', 'Change the pose, the model or the background', 'Add or remove an object, like sunglasses or a belt'].map((t) => (
            <li key={t}>
              <Check aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="mk-cta" aria-labelledby="go">
        <h2 id="go">Ready to try a look?</h2>
        <Button asChild variant="primary" size="lg">
          <a href="/ai-studio">
            <Sparkles aria-hidden="true" />
            Open the studio
          </a>
        </Button>
      </section>
    </>
  );
}

function Pricing() {
  return (
    <section className="mk-page">
      <h1>Credits</h1>
      <p className="mk-lead">Every image you make uses credits. Your balance is always shown in the sidebar, so you can see what a look costs before you make it.</p>
      <div className="mk-cards">
        <article className="mk-card">
          <Download aria-hidden="true" />
          <h2>Pay for what you make</h2>
          <p>Generating a look uses credits. Editing, cropping and downloading a result you already made does not.</p>
        </article>
        <article className="mk-card">
          <Sparkles aria-hidden="true" />
          <h2>See your balance anytime</h2>
          <p>The credit count is shown at the bottom of the sidebar, next to your account.</p>
        </article>
      </div>
      <div className="mk-actions">
        <Button asChild variant="primary" size="lg">
          <a href="/ai-studio">Sign in to see your balance</a>
        </Button>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="mk-page">
      <h1>About Fitting Room</h1>
      <p className="mk-lead">Fitting Room is an AI studio for trying outfits on a model. It is built for people who style looks and need to see them quickly, before they buy or shoot a photo.</p>
      <h2 className="mk-faq-title">Frequently asked questions</h2>
      <div className="mk-faq">
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const PAGES = { landing: Landing, pricing: Pricing, about: About };

/** Public pages for visitors who are not signed in. */
export default function MarketingSite({ page = 'landing' }) {
  const Page = PAGES[page] ?? Landing;
  useEffect(() => {
    document.title = TITLES[page] ?? TITLES.landing;
  }, [page]);
  return (
    <div className="mk">
      <SiteHeader page={page} />
      <main className="mk-main">
        <Page />
      </main>
      <SiteFooter />
    </div>
  );
}
