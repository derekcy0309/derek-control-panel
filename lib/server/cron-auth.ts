import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  const received = request.headers.get("authorization") ?? "";
  if (!secret || !received.startsWith("Bearer ")) return false;
  const expectedBuffer = Buffer.from(`Bearer ${secret}`);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}
