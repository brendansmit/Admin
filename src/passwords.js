import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Shared by the session gate and the user records, so both hash the same way
// and an old hash keeps working after the move to per-user accounts.

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(String(password), salt, 64).toString("hex")}`;
}

function hashMatches(password, stored) {
  const [salt, digest] = String(stored || "").split(":");
  if (!salt || !digest) {
    return false;
  }
  return constantTimeEqual(scryptSync(String(password), salt, 64).toString("hex"), digest);
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export { constantTimeEqual, hashMatches, hashPassword };
