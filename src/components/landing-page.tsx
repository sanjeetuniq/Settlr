import Link from "next/link";
import Image from "next/image";

export function LandingPage({
  inviteToken,
  configured,
}: {
  inviteToken?: string;
  configured: boolean;
}) {
  const returnTo = inviteToken ? `/?invite=${inviteToken}` : "/";
  const next = `?next=${encodeURIComponent(returnTo)}`;

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link className="brand" href="/">
          <span aria-hidden="true" className="brand-mark">S</span>
          SETTLR
        </Link>
        <nav>
          <Link className="nav-login" href={`/sign-in${next}`}>Sign in</Link>
          <Link className="button button-dark" href={`/sign-up${next}`}>
            Get started <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> GOOD COMPANY, NO GUESSWORK</div>
          <h1 className="landing-tagline">
            <strong>Split bills.</strong>
            <strong>Keep the bond.</strong>
          </h1>
          <p>
            From dinner with friends to weekend getaways, keep the math simple
            and the moments yours.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href={`/sign-up${next}`}>
              Start a group <span aria-hidden="true">↗</span>
            </Link>
            <span className="hero-footnote">Free to use · Your data stays yours</span>
          </div>
          {inviteToken && (
            <div className="invite-callout">
              <span className="invite-icon">↗</span>
              <span>You have a group invitation. Sign in or create an account to join.</span>
            </div>
          )}
          {!configured && (
            <div className="setup-notice landing-setup">
              <strong>Supabase setup needed.</strong> Add the project URL and public
              anon key to <code>.env.local</code>, then apply the included migration.
            </div>
          )}
        </div>

        <div className="hero-art">
          <div className="hero-photo-frame">
            <Image
              alt="Friends laughing and sharing a meal around a table"
              className="hero-photo"
              height={571}
              priority
              src="/friends-sharing-a-meal.png"
              width={641}
            />
            <div className="hero-photo-caption">
              <span aria-hidden="true">✦</span>
              <span>
                <strong>Good company, good times</strong>
                <small>Split the bill, not the moment.</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-benefits">
        <div><span className="benefit-number">01</span><b>One place for every group</b><small>Trips, housemates, dinner plans.</small></div>
        <div><span className="benefit-number">02</span><b>Clear from the first rupee</b><small>See who paid, who owes, and why.</small></div>
        <div><span className="benefit-number">03</span><b>Less chasing, fewer transfers</b><small>Simple settle-up suggestions.</small></div>
      </section>
      <footer className="landing-footer">
        <span>SETTLR © 2026</span><span>Good company. Clear balances.</span>
      </footer>
    </main>
  );
}
