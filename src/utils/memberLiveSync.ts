/** Individual listeners keep an employee's readable HR records live without listing colleagues. */
export function watchReadableMembers<T>(options: {
  ids: readonly string[];
  watch: (id: string, value: (record: T | undefined) => void, error: (error: unknown) => void) => () => void;
  reveal: (record: T) => Promise<T>;
  canAdopt: () => boolean;
  publish: (records: T[]) => void;
  onRevoked: (id: string) => void;
  onError: (error: unknown) => void;
  onSaved?: (refresh: () => void) => () => void;
}): () => void {
  const ids = [...new Set(options.ids)];
  const settled = new Set<string>();
  const records = new Map<string, T>();
  let sequence = 0;
  let stopped = false;
  let connection = 0;
  let stops: (() => void)[] = [];
  const changed = async () => {
    const version = ++sequence;
    if (stopped || settled.size !== ids.length || !options.canAdopt()) return;
    const values = ids.flatMap(id => records.has(id) ? [records.get(id)!] : []);
    try {
      const revealed = await Promise.all(values.map(options.reveal));
      if (!stopped && version === sequence && options.canAdopt()) options.publish(revealed);
    } catch (error) { if (!stopped) options.onError(error); }
  };
  const connect = () => {
    const generation = ++connection;
    sequence++;
    stops.forEach(stop => stop());
    settled.clear();
    stops = ids.map(id => options.watch(id, record => {
      if (stopped || generation !== connection) return;
      settled.add(id);
      if (record === undefined) records.delete(id); else records.set(id, record);
      void changed();
    }, error => {
      if (stopped || generation !== connection) return;
      // Revoked ownership must remove the old HR record from the visible projection.
      if ((error as { code?: string })?.code === 'permission-denied') {
        settled.add(id);
        records.delete(id);
        options.onRevoked(id);
        void changed();
      } else options.onError(error);
    }));
    if (!ids.length) void changed();
  };
  connect();
  // A server echo can arrive while the local save is still marked pending.
  // Reconfirm it after the save settles rather than publishing an older held snapshot.
  const stopSaved = options.onSaved?.(() => { if (!stopped) connect(); });
  return () => { stopped = true; sequence++; stops.forEach(stop => stop()); stopSaved?.(); };
}
