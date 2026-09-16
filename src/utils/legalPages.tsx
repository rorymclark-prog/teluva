import { renderToStaticMarkup } from 'react-dom/server';
import { Privacy, Terms, UPDATED } from '../components/LegalContent';

export type PublicLegalPage = 'privacy' | 'terms';

const PAGE_META: Record<PublicLegalPage, { title: string; description: string }> = {
  privacy: {
    title: 'Privacy Policy',
    description: 'How Teluva collects, processes, stores and protects personal data.',
  },
  terms: {
    title: 'Terms of Service',
    description: 'The terms that apply when using Teluva.',
  },
};

const PAGE_CSS = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #2a2527; background: #f7f3ed; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f3ed; }
  a { color: #8f1724; text-underline-offset: 3px; }
  .site-header { background: #0b0b0d; color: #fff9f6; }
  .site-header-inner { width: min(100% - 32px, 780px); min-height: 72px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .brand { color: inherit; font-size: 20px; font-weight: 800; letter-spacing: -0.03em; text-decoration: none; }
  .home-link { color: #fff9f6; font-size: 14px; font-weight: 700; }
  main { width: min(100% - 32px, 780px); margin: clamp(24px, 6vw, 64px) auto; padding: clamp(24px, 6vw, 56px); background: #fffdf9; border: 1px solid #e6ded5; border-radius: 24px; box-shadow: 0 24px 70px rgba(42, 37, 39, 0.08); }
  .eyebrow { margin: 0 0 10px; color: #a52a35; font-size: 12px; font-weight: 850; letter-spacing: 0.13em; text-transform: uppercase; }
  h1 { margin: 0; color: #151316; font-size: clamp(34px, 9vw, 56px); line-height: 0.98; letter-spacing: -0.055em; }
  .summary { margin: 18px 0 30px; color: #665e61; font-size: 17px; line-height: 1.6; }
  article { color: #4e474a; font-size: 16px; line-height: 1.68; }
  article h3 { margin: 30px 0 8px; padding: 0; color: #211d1f; font-size: 21px; line-height: 1.25; letter-spacing: -0.025em; }
  article p { margin: 0 0 16px; }
  article ul { margin: 0 0 18px; padding-left: 24px; }
  article li { margin: 7px 0; }
  article b { color: #211d1f; }
  .page-footer { width: min(100% - 32px, 780px); margin: 0 auto 40px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 18px; color: #766e70; font-size: 14px; }
  .page-footer a { font-weight: 700; }
  @media (max-width: 480px) {
    .site-header-inner { width: min(100% - 24px, 780px); }
    main { width: calc(100% - 24px); margin: 12px auto 24px; padding: 24px 20px; border-radius: 20px; }
    h1 { font-size: 38px; }
    .summary { font-size: 16px; }
    article { font-size: 15.5px; line-height: 1.65; }
    article h3 { font-size: 19px; }
  }
`;

function LegalPage({ page }: { page: PublicLegalPage }) {
  const meta = PAGE_META[page];
  const otherPage = page === 'privacy' ? 'terms' : 'privacy';
  const otherLabel = PAGE_META[otherPage].title;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={meta.description} />
        <meta name="robots" content="index, follow" />
        <title>{`${meta.title} · Teluva`}</title>
        <style>{PAGE_CSS}</style>
      </head>
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="brand" href="/">Teluva</a>
            <a className="home-link" href="/">Application home</a>
          </div>
        </header>
        <main>
          <p className="eyebrow">Teluva · Last updated {UPDATED}</p>
          <h1>{meta.title}</h1>
          <p className="summary">{meta.description}</p>
          <article>{page === 'privacy' ? <Privacy /> : <Terms />}</article>
        </main>
        <footer className="page-footer">
          <span>© {new Date().getUTCFullYear()} Teluva</span>
          <a href={`/${otherPage}`}>{otherLabel}</a>
          <a href="mailto:rorymclark@gmail.com">Contact</a>
        </footer>
      </body>
    </html>
  );
}

export function renderLegalPage(page: PublicLegalPage): string {
  return '<!doctype html>' + renderToStaticMarkup(<LegalPage page={page} />) + '\n';
}
