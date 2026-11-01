export const MAX_SETTLEMENT_COMMENT_LENGTH = 50;

export function isValidSettlementComment(comment: string) {
  return Array.from(comment).length <= MAX_SETTLEMENT_COMMENT_LENGTH;
}
