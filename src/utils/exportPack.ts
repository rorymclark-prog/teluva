import {
  CalendarEvent, FamilyMember, HealthcareProvider, VaultDocument,
} from '../types';
import { memberAppointments } from './memberAppointments';

// Building a folder of whatever the user just asked for.
//
// THE ASK
// -------
// "With all the medical reports etc we should be able to export any
// information and files all at once — go to the chatbot, prepare a folder to
// export all medical reports, results etc for Sophie. It must take everything,
// and then export or email even if a large amount." Then, immediately after:
// "not just medical but any tailored folder of files via chat", and "or share
// it with other apps like AI".
//
// So: not a Medical Export button. A general "gather these topics, for these
// people, into one folder" that the assistant can aim at anything — a new
// paediatrician, a school enrolment, an insurance claim, a visa application,
// or an AI you want to ask about a result.
//
// THE ARCHITECTURE, AND WHY IT IS THIS WAY
// ----------------------------------------
// The assistant does NOT assemble the folder. It only produces a REQUEST — a
// list of topics and a list of people. This module then runs that request
// against the live vault.
//
// That split is the whole safety design. A model that assembles an export can
// omit a result it did not notice, hallucinate a document that does not exist,
// or paraphrase a lab value into the summary. A model that only picks topics
// can be wrong about the SELECTION — which the user sees and corrects on the
// confirm screen before anything leaves the device — but it can never be wrong
// about the CONTENTS, because it never touches them.
//
// TWO RULES THAT ARE NOT NEGOTIABLE
// ---------------------------------
// 1. No Firebase Storage download URLs go into the written summary. Such a URL
//    carries a permanent bearer token that bypasses storage.rules, so a summary
//    forwarded to an insurer would hand them live, world-readable links to
//    every file it named. The bytes travel in the zip; the link adds nothing.
//    (Same reasoning as the full-account backup — see Dashboard's
//    handleExportAllData.)
// 2. Nothing is silently dropped. An empty topic, a record with no file
//    attached, a topic that was asked for and does not apply — all of it is
//    reported, so "everything" is a claim the user can check rather than one
//    they have to trust.

export type PackTopic =
  | 'medical'        // blood group, allergies, medication, conditions, surgery
  | 'vaccinations'
  | 'referrals'      // referral letters, imaging, lab results, specialist letters
  | 'appointments'   // booked and past, from the shared calendar
  | 'checkups'       // recurring care schedule
  | 'growth'         // height/weight history
  | 'providers'      // doctors and specialists
  | 'identity'       // passports, visas/permits, national ID numbers
  | 'education'      // school/qualification details
  | 'travel'         // travel info and transit passes
  | 'financial'      // financial accounts
  | 'legal'          // legal documents
  | 'contact'        // address, phone, email, emergency contact
  | 'documents';     // every filed document for the person, whatever the category

export const ALL_TOPICS: PackTopic[] = [
  'contact', 'medical', 'vaccinations', 'referrals', 'appointments', 'checkups',
  'growth', 'providers', 'identity', 'education', 'travel', 'financial', 'legal',
  'documents',
];

/** What the user sees on the confirm screen, and what the assistant is told it can ask for. */
export const TOPIC_LABELS: Record<PackTopic, string> = {
  contact: 'Contact and emergency details',
  medical: 'Medical record',
  vaccinations: 'Vaccinations',
  referrals: 'Referrals, imaging and results',
  appointments: 'Appointments',
  checkups: 'Recurring check-ups',
  growth: 'Height and weight',
  providers: 'Doctors and specialists',
  identity: 'Passports, visas and ID numbers',
  education: 'Education',
  travel: 'Travel and transit passes',
  financial: 'Financial accounts',
  legal: 'Legal documents',
  documents: 'Filed documents and scans',
};

// Named bundles, so "everything medical for Sophie" does not depend on the
// model remembering all seven medical topics. The assistant names a preset or
// lists topics; both arrive here as a plain topic list.
export const TOPIC_PRESETS: Record<string, PackTopic[]> = {
  medical: ['contact', 'medical', 'vaccinations', 'referrals', 'appointments', 'checkups', 'growth', 'providers'],
  // Note what these do NOT include: the catch-all 'documents' topic. Each
  // topic already pulls the document categories that belong to it, and a test
  // caught the alternative putting an MRI scan in a school-enrolment folder.
  // 'documents' means "every filed document regardless of subject", and it
  // only ever goes in when it is asked for by name.
  identity: ['contact', 'identity'],
  school: ['contact', 'education'],
  travel: ['contact', 'identity', 'travel'],
  everything: ALL_TOPICS,
};

/** What the assistant produces, and what the confirm screen edits. Never file contents. */
export interface PackRequest {
  /** "Sophie's medical records" — becomes the folder name. */
  title?: string;
  /** Member ids. Empty means the whole household. */
  memberIds: string[];
  topics: PackTopic[];
}

export interface PackFile {
  /** Where the bytes are: an https download URL or a base64 data URL. */
  src: string;
  /** Path inside the archive, folders included. Leaf names are already safe. */
  name: string;
  /** Bytes, where the record happened to know. Used only for the size estimate. */
  size?: number;
  /** Used to spot the same file arriving down two different routes. */
  hash?: string;
}

export interface PackSection {
  topic: PackTopic;
  label: string;
  /** Records found. Zero is shown, not hidden — an empty topic is information. */
  count: number;
}

export interface Pack {
  folderName: string;
  files: PackFile[];
  /** Human- and machine-readable. Markdown, so an AI app can read it as-is. */
  summaryMarkdown: string;
  sections: PackSection[];
  /** Rough total of the file sizes we know. Records with no size are excluded. */
  approxBytes: number;
  /** Records in the summary that have no file to send with them. */
  recordsWithoutFiles: number;
}

/** Strip anything unsafe in a zip entry on any OS — including '/', which would silently create folders. */
function safeLeaf(s: string, fallback = 'file'): string {
  const cleaned = (s || '').replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

/** "2026-07-29" from a Date, in local time — the day the user thinks it is. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A markdown table, or a plain note when there is nothing to put in one. */
function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_Nothing recorded._\n';
  const esc = (c: string) => (c || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() || '—';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n') + '\n';
}

/** `- **Label:** value` lines for whatever is actually filled in. */
function facts(pairs: [string, string | undefined | boolean][]): string {
  const lines = pairs
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `- **${k}:** ${typeof v === 'boolean' ? 'Yes' : v}`);
  return lines.length ? lines.join('\n') + '\n' : '_Nothing recorded._\n';
}

const fileExt = (fileName?: string) =>
  fileName && fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';

// Which vault categories a topic pulls documents from. 'documents' takes the
// lot; the others take only their own, so "prepare her school folder" does not
// quietly include a medical result.
const TOPIC_VAULT_CATEGORIES: Partial<Record<PackTopic, string[]>> = {
  medical: ['Medical'],
  referrals: ['Medical'],
  identity: ['Identity'],
  education: ['Education'],
  travel: ['Travel'],
  financial: ['Financial'],
  legal: ['Legal'],
  documents: ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'],
};

// The same, for documents filed on the person rather than in the shared vault.
// FamilyDocument uses an older, shorter category list than VaultDocument.
const TOPIC_MEMBER_DOC_CATEGORIES: Partial<Record<PackTopic, string[]>> = {
  medical: ['Health'],
  referrals: ['Health'],
  identity: ['ID'],
  education: ['Education'],
  travel: ['Travel'],
  documents: ['ID', 'Health', 'Education', 'Travel', 'Other'],
};

export interface PackData {
  members: readonly FamilyMember[];
  events?: readonly CalendarEvent[];
  vaultDocuments?: readonly VaultDocument[];
  providers?: readonly HealthcareProvider[];
  /** Name of the space, for the summary header. */
  spaceName?: string;
  /** Injectable so the output is reproducible in a test. */
  now?: Date;
}

/**
 * Build the folder.
 *
 * Returns descriptors only — nothing is fetched, zipped or written here, which
 * is what makes the whole thing testable without a network and reviewable
 * before a single byte leaves the device.
 */
export function buildPack(request: PackRequest, data: PackData): Pack {
  const { members, events = [], vaultDocuments = [], providers = [], spaceName, now = new Date() } = data;
  const today = isoDay(now);

  // An empty member list means the household. Unknown ids are dropped rather
  // than guessed at — the confirm screen shows who was actually included.
  const targets = request.memberIds.length
    ? members.filter((m) => request.memberIds.includes(m.id))
    : [...members];

  const topics = ALL_TOPICS.filter((t) => request.topics.includes(t));
  const multi = targets.length > 1;

  const files: PackFile[] = [];
  const counts = new Map<PackTopic, number>();
  let recordsWithoutFiles = 0;

  const bump = (t: PackTopic, n: number) => counts.set(t, (counts.get(t) || 0) + n);

  // The same physical file can be filed as a referral AND sit in the vault.
  // Content hash where we have one, name+size otherwise — the same rule the
  // rest of the app uses for duplicate detection.
  const seen = new Set<string>();
  const addFile = (f: PackFile): boolean => {
    if (!f.src) return false;
    const key = f.hash || `${f.name.split('/').pop()}|${f.size ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    files.push(f);
    return true;
  };

  const has = (t: PackTopic) => topics.includes(t);
  const parts: string[] = [];

  for (const member of targets) {
    const med = member.medical || {};
    const idr = member.identity || {};
    const first = member.name.split(' ')[0];
    // One person's folder is flat; several people each get their own.
    const dir = multi ? `${safeLeaf(member.name, 'member')}/` : '';
    const body: string[] = [];

    if (has('contact')) {
      body.push(`### Contact and emergency details\n\n${facts([
        ['Name', member.name],
        ['Date of birth', member.birthdate],
        ['Gender', member.gender],
        ['Nationality', member.nationality],
        ['Phone', member.phone],
        ['Email', member.email],
        ['Address', member.address],
        ['Emergency contact', member.emergencyContactName
          ? `${member.emergencyContactName}${member.emergencyContactPhone ? ` — ${member.emergencyContactPhone}` : ''}`
          : undefined],
      ])}`);
      bump('contact', 1);
    }

    if (has('medical')) {
      const anyCore = !!(med.bloodGroup || med.allergies || med.medications || med.conditions
        || med.surgeries || med.emergencyMedication || med.familyHistory || med.notes);
      body.push(`### Medical record\n\n${facts([
        ['Blood group', med.bloodGroup],
        ['Allergies', med.allergies],
        ['Current medication', med.medications],
        ['Emergency medication', med.emergencyMedication],
        ['Ongoing conditions', med.conditions],
        ['Past surgery', med.surgeries],
        ['Family history', med.familyHistory],
        ['Organ donor', med.organDonor],
        ['Preferred pharmacy', med.preferredPharmacy],
        ['Notes', med.notes],
      ])}
${facts([
        // Health-system identifiers live under `identity`, not `medical` — an
        // e-card number is an identity document that happens to be the thing a
        // clinic asks for first, so it belongs in a medical handover.
        ['e-card number', idr.eCardNumber],
        ['Social insurance (SV) number', idr.svNumber],
      ])}`);
      bump('medical', anyCore ? 1 : 0);
    }

    if (has('vaccinations')) {
      const vs = med.vaccinations || [];
      body.push(`### Vaccinations\n\n${table(
        ['Vaccination', 'Date', 'Notes'],
        vs.map((v) => [v.name, v.date || '', v.notes || '']),
      )}`);
      bump('vaccinations', vs.length);
    }

    if (has('referrals')) {
      const rs = [...(member.referrals || [])].sort(
        (a, b) => (b.date || b.addedAt || '').localeCompare(a.date || a.addedAt || ''),
      );
      rs.forEach((r) => {
        const label = safeLeaf(
          [r.date, r.kind, r.reason || r.providerName].filter(Boolean).join(' — ') || r.fileName,
          'referral',
        );
        if (r.downloadUrl) {
          addFile({
            src: r.downloadUrl,
            name: `${dir}Referrals and results/${label}${fileExt(r.fileName)}`,
            size: r.fileSize,
            hash: r.contentHash,
          });
        } else {
          recordsWithoutFiles++;
        }
      });
      body.push(`### Referrals, imaging and results\n\n${
        rs.length ? 'The file for each row is in the "Referrals and results" folder.\n\n' : ''
      }${table(
        ['Date', 'Kind', 'Reason', 'Doctor / practice', 'Status', 'Notes'],
        rs.map((r) => [
          r.date || '', String(r.kind || ''), r.reason || '',
          r.providerName || '', r.status || 'open', r.notes || '',
        ]),
      )}`);
      bump('referrals', rs.length);
    }

    if (has('appointments')) {
      // Both directions: what is booked, and what already happened. A new
      // doctor asking "when was the last one?" is answered by the past list.
      const { upcoming, past } = memberAppointments(events, member.id, today, members);
      body.push(`### Appointments\n\n**Booked**\n\n${
        table(['Date', 'Time', 'What'], upcoming.map((e) => [e.date, e.time || '', e.title]))
      }\n**Already happened**\n\n${
        table(['Date', 'Time', 'What'], past.slice(0, 50).map((e) => [e.date, e.time || '', e.title]))
      }${past.length > 50 ? `\n_The 50 most recent of ${past.length} are listed._\n` : ''}`);
      bump('appointments', upcoming.length + past.length);
    }

    if (has('checkups')) {
      const care = member.careSchedule || [];
      body.push(`### Recurring check-ups\n\n${table(
        ['Check-up', 'Provider', 'Every', 'Last visit', 'Next due'],
        care.map((c) => [
          String(c.kind || ''), c.provider || '',
          c.intervalMonths ? `${c.intervalMonths} months` : '', c.lastVisit || '', c.nextDue || '',
        ]),
      )}`);
      bump('checkups', care.length);
    }

    if (has('growth')) {
      const g = [...(member.growthHistory || [])].sort((a, b) => b.date.localeCompare(a.date));
      body.push(`### Height and weight\n\n${table(
        ['Date', 'Height (cm)', 'Weight (kg)', 'Notes'],
        g.map((r) => [r.date, String(r.heightCm ?? ''), String(r.weightKg ?? ''), r.notes || '']),
      )}`);
      bump('growth', g.length);
    }

    if (has('providers')) {
      // Both the ones named as this person's, and the household-wide ones — a
      // family GP has no forMember set but is still their GP.
      const theirs = providers.filter(
        (p) => !p.forMember || p.forMember.trim().toLowerCase() === member.name.trim().toLowerCase(),
      );
      body.push(`### Doctors and specialists\n\n${table(
        ['Name', 'Type', 'Specialty', 'Practice', 'Phone', 'Address'],
        theirs.map((p) => [
          p.name, String(p.type || ''), p.specialty || '',
          p.practiceName || '', p.phone || '', p.address || '',
        ]),
      )}`);
      bump('providers', theirs.length);
    }

    if (has('identity')) {
      const passports = member.passports || [];
      const visas = member.travel?.visas || [];
      body.push(`### Passports, visas and ID numbers\n\n${table(
        ['Country', 'Number', 'Issued', 'Expires'],
        passports.map((p) => [p.country, p.number, p.issueDate || '', p.expiryDate || '']),
      )}\n${table(
        ['Valid in', 'Type', 'Number', 'Expires', 'Status'],
        visas.map((v) => [v.country, v.permitType || '', v.number || '', v.expiryDate || '', v.status || '']),
      )}\n${facts([
        ['e-card number', idr.eCardNumber],
        ['Social insurance (SV) number', idr.svNumber],
        ['Tax number', idr.taxNumber || member.taxNumber],
      ])}`);
      bump('identity', passports.length + visas.length);
    }

    if (has('education')) {
      const ed = member.education;
      body.push(`### Education\n\n${facts([
        ['School', ed?.schoolName],
        ['Year / grade', ed?.grade],
        ['Class teacher', ed?.teacherName],
        ['Teacher contact', ed?.teacherContact],
        ['Room', ed?.roomNumber],
        ['Schedule notes', ed?.scheduleNotes],
      ])}`);
      bump('education', ed?.schoolName ? 1 : 0);
    }

    if (has('travel')) {
      const passes = member.travel?.transitPasses || [];
      body.push(`### Travel and transit passes\n\n${facts([
        ['Frequent flyer', member.travel?.frequentFlyer],
        ['Travel insurance number', member.travel?.travelInsuranceNumber],
        ['ESTA / ETIAS status', member.travel?.etiasStatus],
        ['Emergency contact while travelling', member.travel?.emergencyTravelContact],
      ])}\n${table(
        ['Pass', 'Operator', 'Number', 'Valid from', 'Valid until'],
        passes.map((p) => [p.name, p.operator || '', p.cardNumber || '', p.validFrom || '', p.validUntil || '']),
      )}`);
      bump('travel', passes.length);
    }

    if (has('financial')) {
      const accts = member.financialAccounts || [];
      body.push(`### Financial accounts\n\n${table(
        ['Bank', 'Type', 'Account number', 'Notes'],
        accts.map((a) => [a.bankName, a.accountType, a.accountNumber, a.notes || '']),
      )}`);
      bump('financial', accts.length);
    }

    // --- files: documents filed on the person, and in the shared vault ------
    const memberDocCats = new Set(
      topics.flatMap((t) => TOPIC_MEMBER_DOC_CATEGORIES[t] || []),
    );
    const personalDocs = (member.documents || []).filter((d) => memberDocCats.has(d.category));
    personalDocs.forEach((d) => {
      if (d.fileData) {
        addFile({
          src: d.fileData,
          name: `${dir}Documents/${safeLeaf(d.name || d.fileName, 'document')}${fileExt(d.fileName)}`,
          size: d.fileSize,
          hash: d.contentHash,
        });
      } else {
        recordsWithoutFiles++;
      }
    });

    const vaultCats = new Set(topics.flatMap((t) => TOPIC_VAULT_CATEGORIES[t] || []));
    const theirVaultDocs = vaultDocuments.filter(
      (d) => d.memberId === member.id && vaultCats.has(d.category),
    );
    theirVaultDocs.forEach((d) => {
      if (d.downloadUrl) {
        addFile({
          src: d.downloadUrl,
          name: `${dir}Documents/${safeLeaf(d.name || d.fileName, 'document')}${fileExt(d.fileName)}`,
          size: d.fileSize,
          hash: d.contentHash,
        });
      } else {
        recordsWithoutFiles++;
      }
    });

    if (personalDocs.length + theirVaultDocs.length > 0 || has('documents')) {
      body.push(`### Filed documents and scans\n\n${table(
        ['Document', 'Category', 'Filed'],
        [
          ...personalDocs.map((d) => [d.name || d.fileName, d.category, d.uploadedAt || '']),
          ...theirVaultDocs.map((d) => [d.name || d.fileName, d.category, d.uploadedAt || '']),
        ],
      )}`);
    }
    bump('documents', personalDocs.length + theirVaultDocs.length);

    parts.push(multi ? `## ${member.name}\n\n${body.join('\n')}` : body.join('\n'));
  }

  const who = targets.length === 0
    ? 'nobody'
    : targets.length === 1
      ? targets[0].name
      : `${targets.length} people`;
  const title = (request.title || '').trim() || `${who} — records`;

  const summaryMarkdown = `# ${title}

Prepared ${today}${spaceName ? ` from ${spaceName}` : ''} using Teluva.

Covering ${targets.map((m) => m.name).join(', ') || 'nobody — no matching people were found'}.
Includes: ${topics.map((t) => TOPIC_LABELS[t]).join(', ') || 'nothing'}.
${files.length} file${files.length === 1 ? '' : 's'} ${files.length === 1 ? 'is' : 'are'} attached alongside this summary.

> This is a copy of records as they were entered. It is not a medical, legal or
> financial opinion, and nothing in it has been checked or interpreted by Teluva.

${parts.join('\n\n')}${recordsWithoutFiles > 0 ? `

---

**${recordsWithoutFiles} record${recordsWithoutFiles === 1 ? ' is' : 's are'} listed above with no file attached** — the details
were entered by hand, or the original was never scanned in.
` : ''}`;

  const sections: PackSection[] = topics.map((t) => ({
    topic: t, label: TOPIC_LABELS[t], count: counts.get(t) || 0,
  }));

  return {
    folderName: `${safeLeaf(title, 'export')} (${today})`,
    files,
    summaryMarkdown,
    sections,
    approxBytes: files.reduce((n, f) => n + (f.size || 0), 0),
    recordsWithoutFiles,
  };
}

/** Turn a preset name, a topic list, or both into the topic list to build with. */
export function resolveTopics(preset?: string, topics?: string[]): PackTopic[] {
  const fromPreset = preset ? TOPIC_PRESETS[preset.trim().toLowerCase()] || [] : [];
  const fromList = (topics || []).filter((t): t is PackTopic => ALL_TOPICS.includes(t as PackTopic));
  const merged = new Set<PackTopic>([...fromPreset, ...fromList]);
  // Contact details are always worth having: a folder handed to a clinic or a
  // school with no name, date of birth or phone number on it is a folder they
  // have to ring you about.
  if (merged.size > 0) merged.add('contact');
  return ALL_TOPICS.filter((t) => merged.has(t));
}

/** "3.4 MB" — for telling the user before they try to email it. */
export function formatBytes(n: number): string {
  if (n <= 0) return 'unknown size';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Gmail, Outlook and most corporate mail servers reject an attachment over
// roughly 25 MB. The export screen warns above this rather than letting the
// user find out from a bounce an hour later.
export const EMAIL_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
