import { useState, type ReactNode } from 'react';
import { X, Shield, FileText } from 'lucide-react';

/**
 * Privacy Policy + Terms, shown in a modal from the sign-in footer (pre-auth) and
 * from Settings. This is a DRAFT scaffold covering the GDPR essentials for a family
 * vault (personal + children's + health data, Google/Firebase/Gemini processors).
 * It is NOT legal advice — the {{PLACEHOLDERS}} and the whole document must be
 * reviewed and completed by a qualified lawyer before publishing.
 */

export type LegalTab = 'privacy' | 'terms';

const UPDATED = '18 July 2026';

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
          <div className="text-[12px] rounded-xl bg-honey-50 border border-honey-100 text-honey-900 px-3 py-2">
            ⚠️ <b>Draft — not yet legal advice.</b> Complete the <code>{'{{…}}'}</code> fields and have this
            reviewed by a lawyer before publishing (it covers children&apos;s and health data in the EU).
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
        This policy explains what personal data Family Vault collects, why, and your rights under the EU
        General Data Protection Regulation (GDPR).
      </p>

      <H>Who is responsible for your data</H>
      <p>
        The data controller is <b>{'{{legal name / business}}'}</b>, contactable at{' '}
        <b>{'{{contact email}}'}</b>. We decide how and why your data is processed.
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
        Family Vault is used by adults to keep records about their family, including children. If you add a
        child&apos;s data you confirm you have the right (as a parent or guardian) to do so. We do not
        knowingly let children create their own accounts.
      </p>

      <H>Who processes your data (sub-processors)</H>
      <p>We use Google Cloud services to run the app. Your data is processed by:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><b>Google Firebase</b> (Authentication, Firestore database, Cloud Storage) — stores your data, hosted in the EU (europe-west2).</li>
        <li><b>Google Cloud Run</b> — runs the application server (EU, europe-west2).</li>
        <li><b>Google Gemini API</b> — when you use the AI assistant or scan a document, the text and image you send are processed by Google&apos;s AI to extract information. Do not send anything you are not comfortable processing this way.</li>
      </ul>
      <p>Google acts as our processor under its data-processing terms. We do not sell your data or use it for advertising.</p>

      <H>Where your data is stored</H>
      <p>Primarily in the EU (Google europe-west2). Some processing (e.g. AI) may occur on Google infrastructure per their terms.</p>

      <H>How long we keep it</H>
      <p>Until you delete it or close your account. You can export or delete your family&apos;s data from within the app at any time.</p>

      <H>Your rights</H>
      <p>Under the GDPR you may request: access, correction, erasure, restriction, portability, and to object to processing. To exercise these, use the in-app export/delete tools or contact <b>{'{{contact email}}'}</b>. You may also complain to your local data-protection authority (in Austria, the <i>Datenschutzbehörde</i>).</p>

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
      <p>Family Vault is a private tool for organising your family&apos;s information. You need a Google account to sign in.</p>

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
      <p>Questions about these terms: <b>{'{{contact email}}'}</b>. Governed by the laws of <b>{'{{jurisdiction, e.g. Austria}}'}</b>.</p>
    </>
  );
}
