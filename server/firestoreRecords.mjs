// Stored fields are editable data; only the document reference establishes
// identity. Keep this ordering shared by runtime authorization and migrations.
export function recordFromSnapshot(snapshot) {
  return { ...(snapshot.data() || {}), id: snapshot.id };
}
