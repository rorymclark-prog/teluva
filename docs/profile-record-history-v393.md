# Previous phone numbers and memberships

Family profiles now have **Essentials → Past numbers** for previous phone/email
contacts, medical-aid memberships, health-insurance numbers and other insurance
references. This register is separate from current contact details and identity
fields. A source observation date is separate from the dates a number was used;
an old document does not establish that cover is still active or has ended.

Adult family writers can add/edit a record or review a bounded JSON file prepared
by a connected assistant. The assistant searches only separately authorised
sources (for example Gmail/Drive or selected exports). The Teluva connector does
not acquire email, Photos or whole-profile read access through this feature.
The existing connector's document-import tool is not a typed history-write tool:
its supported pending research report and this explicit profile-file review are
separate paths. There is no background account crawler or new OAuth grant.

Example import, using synthetic data:

```json
{
  "version": 1,
  "personName": "Jamie Example",
  "records": [{
    "kind": "medical-aid",
    "value": "SYNTHETIC-1234",
    "provider": "Example scheme",
    "status": "unknown",
    "observedDate": "2020-05-12",
    "sourceName": "Synthetic membership letter",
    "evidenceQuote": "Jamie Example — membership SYNTHETIC-1234",
    "notes": "The source records a membership; its end date is unknown."
  }]
}
```

Files are limited to 128 KB and 50 records. The name must match the open profile;
the file cannot choose IDs to replace existing entries. Each proposed number
needs a named source and an excerpt containing the number. Unknown dates stay
blank; invalid dates, reversed ranges and unsafe source URLs are rejected.
Approval appends only `recordHistory`, preserves existing entries and skips
format-equivalent duplicates in the same provider/usage period. Account, family,
role and profile changes unmount the intake and fence late file reads. Failed
cloud saves keep the review available for retry.

Numbers, quoted evidence and notes pass through the existing shared-vault
encrypt/reveal boundary before and after the normal three-way member merge.
Historical values are masked in the saved list; children do not receive the adult
history interface or decrypted shared history values. The entire history is
removed from general AI chat context. These protections reuse current family
membership, vault-purpose and revocation rules; no access rules are relaxed.
The register is explicitly excluded from linked-household profile sharing.

Verification includes actual React intake/save/retry/scope-change interactions,
source/name validation, date conflicts, append/deduplication, encrypt/reveal
round trips, child projections and AI-context redaction, plus the normal release
gates. Real-source ingestion is tracked separately in the ignored output folder.
