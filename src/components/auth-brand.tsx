import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export function AuthBrand() {
  return (
    <div className="auth-branding">
      <Link aria-label="Settlr home" className="auth-brand" href="/">
        <BrandLogo className="auth-brand-image" priority sizes="116px" />
      </Link>
      <div className="auth-tagline">
        <span>SHARED PLANS, LESS MATH</span>
        <strong>
          SETTLES SETTLEMENTS IN STYLE <span aria-hidden="true">😉</span>
        </strong>
      </div>
    </div>
  );
}
