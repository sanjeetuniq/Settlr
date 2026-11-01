import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { friendshipQuotes } from "@/lib/friendship-quotes";

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<{ quote?: string }>;
}) {
  const { quote } = await searchParams;
  const quoteIndex = Number(quote);
  const selectedQuote =
    Number.isInteger(quoteIndex) &&
    quoteIndex >= 0 &&
    quoteIndex < friendshipQuotes.length
      ? friendshipQuotes[quoteIndex]
      : friendshipQuotes[0];

  return (
    <main className="signed-out-page">
      <Link aria-label="Settlr home" className="signed-out-brand" href="/sign-in">
        <BrandLogo priority sizes="82px" />
      </Link>
      <section className="signed-out-card">
        <div className="signed-out-art">
          <Image
            alt="Friends enjoying a sunny trip together and sharing a meal"
            className="signed-out-image"
            height={1024}
            priority
            sizes="(max-width: 700px) 100vw, 58vw"
            src="/settlr-logout.png"
            width={1536}
          />
        </div>
        <div className="signed-out-copy">
          <div className="eyebrow">UNTIL THE NEXT GET-TOGETHER</div>
          <h1>Signed out, until next time.</h1>
          <blockquote>“{selectedQuote}”</blockquote>
          <p>
            Your next shared expense is always easier with everyone in the
            loop. Come back when the next plan begins.
          </p>
          <Link className="button button-primary signed-out-action" href="/sign-in">
            Sign back in to Settlr <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
      <p className="signed-out-footnote">SETTLES SETTLEMENTS IN STYLE 😉</p>
    </main>
  );
}
