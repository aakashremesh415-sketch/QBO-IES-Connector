import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function audit(userId: string | null, action: string, detail: string) {
  await db.insert(auditLog).values({ userId, action, detail: detail.slice(0, 2000) });
}
