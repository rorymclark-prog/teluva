import { useState, type ReactNode } from 'react';
import { X, Shield, FileText, Lock } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import SheetGrabber from './SheetGrabber';

/**
 * Privacy Policy + Terms, shown in a modal from the sign-in footer (pre-auth) and
 * from Settings. Covers the GDPR essentials for a family vault (personal +
 * children's + health data; Google Firebase + Vertex AI EU processors). Every
 * factual claim below (what's collected, where it's processed, the
 * export/delete tools) is checked against what the app's code actually does —
 * see FamilySettings.tsx's Danger Zone (delete), Dashboard.tsx's export
 * button, and server.js's /api/delete-family for the mechanisms this text
 * describes. This is not a substitute for a lawyer's review of the app's
 * legal/contractual position — it is a description of current behaviour.
 */

export type LegalTab = 'privacy' | 'terms' | 'security';

const UPDATED = '28 July 2026';

export default function LegalModal({ tab, onClose }: { tab: LegalTab; onClose: () => void }) {
  // Parent (Dashboard.tsx) conditionally mounts this component (`{legalTab && <LegalModal .../>}`),
  // so the lock is unconditional for this component's whole lifetime.
  useBodyScrollLock(true);

  const [active, setActive] = useState<LegalTab>(tab);

  return (
    <div
      className="anim-fade fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-900/40 sm:p-4"
      onClick={onClose}
    >
      <div
        className="anim-sheet bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-lift max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <SheetGrabber onClose={onClose} className="pt-2" />
        {/* Header + tabs */}
        <div className="p-4 sm:p-5 border-b border-cream-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex bg-cream-200 p-1 rounded-2xl">
            <button
              onClick={() => setActive('privacy')}
              className={`tab-pill px-3.5 ${active === 'privacy' ? 'tab-pill-active' : ''}`}
            >
              <Shield className="w-4 h-4" /> Privacy
            </button>
            <button
              onClick={() => setActive('security')}
              className={`tab-pill px-3.5 ${active === 'security' ? 'tab-pill-active' : ''}`}
            >
              <Lock className="w-4 h-4" /> Security
            </button>
            <button
              onClick={() => setActive('terms')}
              className={`tab-pill px-3.5 ${active === 'terms' ? 'tab-pill-active' : ''}`}
            >
              <FileText className="w-4 h-4" /> Terms
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 sm:p-7 text-[14px] leading-relaxed text-ink-700 space-y-4">
          <div className="text-[12px] rounded-xl bg-cream-100 border border-cream-300 text-ink-500 px-3 py-2">
            This describes what Teluva actually does today, checked against the app itself. Questions
            about it — or anything here that looks out of date — go to <b>rorymclark@gmail.com</b>.
          </div>
          {active === 'privacy' ? <Privacy /> : active === 'security' ? <Security /> : <Terms />}
        </div>

        <div className="p-3 border-t border-cream-200 text-center shrink-0">
          <button onClick={onClose} className="btn-quiet text-sm px-6">Close</button>
        </div>
      </div>
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => (
  <h3 className="font-display text-lg font-bold text-ink-900 pt-2">{children}</h3>
);

function Privacy() {
  return (
    <>
      <p className="text-[12px] text-ink-400">Last updated: {UPDATED}</p>
      <p>
        This policy explains what personal data Teluva collects, why, and your rights under the EU
        General Data Protection Regulation (GDPR).
      </p>

      <H>Who is responsible for your data</H>
      <p>
        The data controller is <b>Rory Michael Clark</b> (Vienna, Austria), contactable at{' '}
        <b>rorymclark@gmail.com</b>. We decide how and why your data is processed.
      </p>

      <H>What we collect</H>
      <p>You choose what to add. It can include, for each family member:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Identity &amp; contact: names, nicknames, dates of birth, addresses, phone, email.</li>
        <li><b>Special-category data</b>: health &amp; medical notes, allergies, blood type.</li>
        <li>Identity documents: passport, ID, residence-permit numbers and their scanned images.</li>
        <li>Other records: clothing sizes, school info, wishlists, growth logs, documents you upload.</li>
        <li>Household &amp; account data, calendar events, family chat messages, and your conversations with the AI assistant.</li>
        <li>Technical: your Google account identifier (for sign-in) and basic device/local-storage cache.</li>
        <li>
          <b>Optional Google Drive &amp; Calendar sync.</b> If you connect Google Drive or Google
          Calendar (in the Drive Sync or Calendar screens), you grant Teluva read-only access to
          browse your Google Drive files and folders — so you can choose which ones to share with
          your family — and read/write access to events on your <i>primary</i> Google Calendar only,
          to import or export appointments. This does not let Teluva edit, delete, or upload
          anything in your Drive, and it cannot see or change any calendar other than your primary
          one. You can revoke this at any time from your Google Account&apos;s{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            connected apps &amp; sites
          </a>{' '}
          settings.
        </li>
      </ul>

      <H>Why we process it &amp; the legal basis</H>
      <p>
        To provide the family record-keeping service you asked for. The legal basis is your{' '}
        <b>consent</b> and our <b>legitimate interest</b> in operating the app. For special-category
        (health) data we rely on your <b>explicit consent</b>, which you can withdraw at any time by
        deleting the data or your account.
      </p>

      <H>Children&apos;s data</H>
      <p>
        Teluva is used by adults to keep records about their family, including children. If you add a
        child&apos;s data you confirm you have the right (as a parent or guardian) to do so. We do not
        knowingly let children create their own accounts.
      </p>

      <H>Who processes your data (sub-processors)</H>
      <p>We use Google Cloud services to run the app. Your data is processed by:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><b>Google Firebase / Firestore &amp; Cloud Storage</b> — stores your family&apos;s records, hosted in the United Kingdom (London, europe-west2). The UK has an EU adequacy decision, so transfers are permitted.</li>
        <li><b>Google Cloud Run</b> — runs the application server (United Kingdom, London, europe-west2).</li>
        <li><b>Firebase Authentication</b> — manages sign-in with your Google account; this may involve processing on Google infrastructure outside the UK/EU (including the United States) under Google&apos;s Standard Contractual Clauses.</li>
        <li><b>Google Vertex AI</b> (in the EU — Belgium, europe-west1) — when you use the AI assistant or scan a document, the text and image you send are processed by Google&apos;s AI in the EU to extract information, under Google Cloud&apos;s enterprise terms (your content is not used to train Google&apos;s models). Do not send anything you are not comfortable processing this way.</li>
      </ul>
      <p>Google acts as our processor under its data-processing terms. We do not sell your data or use it for advertising.</p>

      <H>Where your data is stored</H>
      <p>Your family&apos;s records are stored in the United Kingdom (London, europe-west2), which the EU recognises as providing adequate protection. AI processing runs in the EU (Belgium, europe-west1). Sign-in (Firebase Authentication) may involve processing in the United States under Standard Contractual Clauses.</p>

      <H>How long we keep it</H>
      <p>
        Until you delete it. You can download a full backup at any time (the export button in the app
        header — a zip file with your records and the actual document/photo files, not just links; your
        saved passwords are deliberately left out of it, since a plaintext copy of them in a downloads
        folder is its own risk). An admin can permanently delete the whole family or business — every
        member, document, photo, and record — from Settings → Danger zone. This cannot be undone.
      </p>

      <H>Your rights</H>
      <p>Under the GDPR you may request: access, correction, erasure, restriction, portability, and to object to processing. Use the in-app export/delete tools described above, or contact <b>rorymclark@gmail.com</b>. You may also complain to your local data-protection authority (in Austria, the <i>Datenschutzbehörde</i>).</p>

      <H>Security</H>
      <p>Data is encrypted in transit (HTTPS) and isolated per family by server-side security rules: reading your family&rsquo;s records requires signing in with an authorised Google account.</p>
      <p><b>One thing to know about files.</b> Documents and photos you upload are stored with a long, unguessable link. Anyone holding that exact link can open the file without signing in &mdash; which is what makes a shared or exported document work at all. Treat a backup file, or a link you copy out of the app, the way you would treat the document itself.</p>
      <p>No system is perfectly secure; keep your Google account protected.</p>

      <H>Changes</H>
      <p>We may update this policy; material changes will be noted in the app. Continued use after an update means you accept the revised policy.</p>
    </>
  );
}

/**
 * The plain answer to "can you see my stuff?".
 *
 * It exists because the honest answer is NO, we are not zero-knowledge, and
 * that has to be said in the app rather than only in a policy nobody opens.
 * Every claim below was checked against the code: server.js sends document
 * images to Vertex AI (europe-west1) to read them; protectSecrets/
 * revealSharedSecrets encrypt saved passwords AND (2026-07-30) government ID
 * numbers, household access codes, and bank IBAN/BIC with a key held in
 * Secret Manager, which is OUR key; Firestore and Storage sit in
 * europe-west2. The 2026-07-30 change does not alter the "not end-to-end,
 * we can technically still decrypt" fact below — only which fields get the
 * password-grade protective layer at all.
 *
 * Deliberately NOT reassuring. Zoom took a 20-year FTC consent order for
 * marketing "end-to-end encryption" while holding the keys. Saying less than
 * is true costs nothing; saying more than is true is the whole risk.
 */
function Security() {
  return (
    <>
      <p className="text-[12px] text-ink-400">Last updated: {UPDATED}</p>
      <p>
        Short version: <b>your records are encrypted, but Teluva is not end-to-end encrypted.</b> Our
        servers can read what you store. Here is exactly what that means, and why.
      </p>

      <H>What is protected</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><b>In transit</b> — everything between your device and us travels over HTTPS.</li>
        <li><b>At rest</b> — Google encrypts the stored database and files on disk.</li>
        <li><b>From other people</b> — each family or business is sealed off by server-side rules. Another family cannot read yours, and your role can only be changed by an admin, never by editing something in the browser.</li>
        <li><b>Saved passwords, government ID numbers, household access codes, and bank details</b> get an extra layer: each is encrypted before being written, with a key held separately from the database itself, so a raw copy of the database &mdash; a backup, a leak, a stray query &mdash; does not hand someone plaintext SV numbers, passport numbers, door codes, Wi&#8209;Fi passwords, or IBANs. If that encryption is unavailable the app refuses to save rather than quietly storing the value in plain text.</li>
      </ul>

      <H>What we can see</H>
      <p>
        We can read your records. Not as a loophole &mdash; it is how the app works. When you
        photograph a passport and the fields fill themselves in, something has to read that passport.
        The image goes to Google&rsquo;s AI in the EU (Belgium), which extracts the text and sends it
        back. That cannot happen on data we are unable to open.
      </p>
      <p>
        The extra layer above uses a key we hold, so it protects those values from anyone without
        access to our systems &mdash; but not from us. We would rather say that than imply otherwise.
        It is a real, meaningful barrier against a database being copied or leaked; it is not
        end-to-end encryption, and nothing here claims to be.
      </p>
      <p>
        In practice one person has that access: <b>Rory Michael Clark</b>, who built and runs Teluva.
        Not a support team, not a contractor.
      </p>

      <H>What we don&rsquo;t do</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>We don&rsquo;t sell your data, share it, or use it for advertising.</li>
        <li>We don&rsquo;t read your records for any purpose other than making the features work.</li>
        <li>Your content is <b>not</b> used to train Google&rsquo;s AI models &mdash; that is contractual under Google Cloud&rsquo;s enterprise terms.</li>
        <li>There is no analytics or tracking company embedded in the app.</li>
      </ul>

      <H>Where it lives</H>
      <p>
        Records and files: United Kingdom (London). AI processing: EU (Belgium). Sign-in is handled by
        Google and may touch the United States under Standard Contractual Clauses. We never see your
        Google password &mdash; Google handles sign-in and only tells us who you are.
      </p>

      <H>Two things worth knowing</H>
      <p>
        <b>Files have permanent links.</b> A document or photo you upload gets a long, unguessable web
        address. Anyone who has that exact address can open the file without signing in &mdash; which is
        what makes sharing and exporting work at all. Treat a copied link, or an exported backup, the
        way you would treat the document itself.
      </p>
      <p>
        <b>Your Google account is the front door.</b> Anyone who can get into it can get into your
        vault. Turn on two-factor authentication there; it does more for your security than anything
        we can do at this end.
      </p>

      <H>You can leave with everything</H>
      <p>
        Export any time from the app header: a zip with your records <i>and</i> the actual files, not
        links that die when we do. Saved passwords are deliberately excluded &mdash; a plain-text copy
        of them sitting in a downloads folder is its own risk. An admin can permanently delete an
        entire family or business from Settings &rarr; Danger zone.
      </p>

      <H>If this changes</H>
      <p>
        If we ever move to encryption we genuinely cannot open, we will say so here and in the app.
        Until you read that, assume everything above still applies.
      </p>
      <p className="text-[13px] text-ink-500">
        Found something wrong, or think we have overstated it? <b>rorymclark@gmail.com</b>.
      </p>
    </>
  );
}

function Terms() {
  return (
    <>
      <p className="text-[12px] text-ink-400">Last updated: {UPDATED}</p>

      <H>1. The service</H>
      <p>Teluva is a private tool for organising your family&apos;s information. You need a Google account to sign in.</p>

      <H>2. Your responsibilities</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Only add information about people you have the right to record (yourself, and family members you are responsible for).</li>
        <li>Keep your Google account secure — anyone with access to it can access your family data.</li>
        <li>Don&apos;t use the app for anything unlawful, or to store other people&apos;s data without their consent.</li>
      </ul>

      <H>3. The AI assistant</H>
      <p>The assistant can misread documents or make mistakes. Always check what it extracts before relying on it. It is a convenience, not a source of legal, medical, or financial advice.</p>

      <H>4. Availability &amp; your data</H>
      <p>We aim to keep the service running and your data safe, but we provide it <b>“as is”</b>, without warranties. Keep your own backups of anything critical (use the in-app export). We are not liable for loss of data or indirect damages to the extent permitted by law.</p>

      <H>5. Ending use</H>
      <p>You can stop using the app and delete your data at any time. We may suspend accounts that misuse the service.</p>

      <H>6. Contact</H>
      <p>Questions about these terms: <b>rorymclark@gmail.com</b>. Governed by the laws of <b>Austria</b>.</p>
    </>
  );
}
