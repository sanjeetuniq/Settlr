export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ReceiptValidation =
  | { valid: true; contentType: "image/png" | "application/pdf" }
  | { valid: false; message: string };

export function validateReceipt(
  bytes: Uint8Array,
  declaredType: string,
): ReceiptValidation {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RECEIPT_BYTES) {
    return { valid: false, message: "Receipts must be between 1 byte and 5 MB." };
  }

  const isPng = pngSignature.every((byte, index) => bytes[index] === byte);
  const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  const contentType = isPng
    ? "image/png"
    : isPdf
      ? "application/pdf"
      : null;

  if (!contentType || contentType !== declaredType) {
    return {
      valid: false,
      message: "Only valid PNG and PDF files are accepted.",
    };
  }

  return { valid: true, contentType };
}
