export default function Loading() {
  return (
    <main aria-live="polite" className="route-loading" role="status">
      <span aria-hidden="true" className="processing-spinner" />
      <span>Loading your space…</span>
    </main>
  );
}
