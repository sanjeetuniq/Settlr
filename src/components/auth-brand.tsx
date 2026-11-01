import Image from "next/image";
import Link from "next/link";

export function AuthBrand() {
  return (
    <Link aria-label="Settlr home" className="auth-brand" href="/">
      <Image
        alt="Settlr"
        height={1254}
        priority
        sizes="82px"
        src="/settlr-logo.png"
        width={1254}
      />
    </Link>
  );
}
