export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

type AvatarType = {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
};

const avatarTypes: AvatarType[] = [
  { contentType: "image/png", extension: "png" },
  { contentType: "image/jpeg", extension: "jpg" },
  { contentType: "image/webp", extension: "webp" },
];

export function validateAvatar(
  bytes: Uint8Array,
  declaredType: string,
): { valid: true; contentType: AvatarType["contentType"]; extension: AvatarType["extension"] } | {
  valid: false;
  message: string;
} {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
    return { valid: false, message: "Choose an image up to 2 MB." };
  }

  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  const detectedType = isPng
    ? avatarTypes[0]
    : isJpeg
      ? avatarTypes[1]
      : isWebp
        ? avatarTypes[2]
        : null;

  if (!detectedType || detectedType.contentType !== declaredType) {
    return {
      valid: false,
      message: "Profile photos must be valid PNG, JPEG, or WebP images.",
    };
  }
  return { valid: true, ...detectedType };
}
