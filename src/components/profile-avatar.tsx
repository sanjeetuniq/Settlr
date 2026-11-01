import Image from "next/image";

export function ProfileAvatar({
  className,
  imageUrl,
  initials,
}: {
  className: string;
  imageUrl: string | null;
  initials: string;
}) {
  return (
    <span aria-hidden="true" className={`avatar ${className}`}>
      {imageUrl ? (
        <Image
          alt=""
          className="profile-avatar-image"
          height={40}
          src={imageUrl}
          unoptimized
          width={40}
        />
      ) : (
        initials
      )}
    </span>
  );
}
