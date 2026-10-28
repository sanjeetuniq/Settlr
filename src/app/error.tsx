"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-shell">
      <div className="error-card">
        <span className="empty-illustration">✳</span>
        <div className="eyebrow">A SMALL DETOUR</div>
        <h1>We couldn’t load this right now.</h1>
        <p>Nothing was changed. Try again, and your group will be right here.</p>
        <button className="button button-primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
