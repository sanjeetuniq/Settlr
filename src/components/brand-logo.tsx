import Image from "next/image";
import brandLogo from "../../Images/Logo.png";

export function BrandLogo({
  className,
  sizes,
  priority = false,
}: {
  className?: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <Image
      alt="Settlr"
      className={className}
      priority={priority}
      sizes={sizes}
      src={brandLogo}
    />
  );
}
