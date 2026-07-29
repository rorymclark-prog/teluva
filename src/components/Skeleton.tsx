/**
 * Loading placeholder — a soft sheen-sweep block roughly the shape of what's
 * about to render, instead of a spinner that tells you nothing and leaves the
 * whole layout to jump into place the moment data arrives.
 *
 * Usage: <Skeleton className="h-4 w-32" /> for a line, or compose a few into
 * a card-shaped loading state (see SkeletonRows below for the common case of
 * "a card header plus a handful of list rows").
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />;
}

/** A handful of list-row-shaped skeleton lines, for a list/table that's still loading. */
export function SkeletonRows({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A card-header-shaped skeleton (icon + title + subtitle), for the top of a panel that's still loading. */
export function SkeletonHeader({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} role="status" aria-label="Loading">
      <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}
