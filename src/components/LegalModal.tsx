import { useState, type ReactNode } from 'react';
import { X, Shield, FileText } from 'lucide-react';

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

export type LegalTab = 'privacy' | 'terms';

const UPDATED = '28 July 2026';

export default function LegalModal({ tab, onClose }: { tab: LegalTab; onClose: () => void }) {
  const [active, setActive] = useState<LegalTab>(tab);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-900/40 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-lift max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
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
          {active === 'privacy' ? <Privacy /> : <Terms />}
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
      <p>Data is encrypted in transit (HTTPS), isolated per family by server-side security rules, and access requires a verified Google sign-in. No system is perfectly secure; keep your Google account protected.</p>

      <H>Changes</H>
      <p>We may update this policy; material changes will be noted in the app. Continued use after an update means you accept the revised policy.</p>
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
