import { eq, and, desc, asc, isNull } from "drizzle-orm";
import { tutorialJobs } from "../schema/tutorial-jobs.js";
import type { DrizzleClient } from "../client.js";

export type NewTutorialJob = typeof tutorialJobs.$inferInsert;
export type TutorialJob = typeof tutorialJobs.$inferSelect;
export type TutorialJobUpdate = Partial<Omit<TutorialJob, "id" | "created_at">>;

export async function createTutorialJob(
  db: DrizzleClient,
  data: NewTutorialJob,
): Promise<TutorialJob> {
  const [row] = await db.insert(tutorialJobs).values(data).returning();
  if (!row) throw new Error("Failed to create tutorial job");
  return row;
}

export async function getTutorialJobById(
  db: DrizzleClient,
  id: string,
): Promise<TutorialJob | undefined> {
  const [row] = await db
    .select()
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, id))
    .limit(1);
  return row;
}

/**
 * Delete a tutorial job. Any child segments (parent_job_id = id) are removed
 * automatically via the ON DELETE CASCADE foreign key.
 */
export async function deleteTutorialJob(
  db: DrizzleClient,
  id: string,
): Promise<void> {
  await db.delete(tutorialJobs).where(eq(tutorialJobs.id, id));
}

export async function updateTutorialJob(
  db: DrizzleClient,
  id: string,
  data: TutorialJobUpdate,
): Promise<TutorialJob> {
  const [row] = await db
    .update(tutorialJobs)
    .set({ ...data, updated_at: new Date() })
    .where(eq(tutorialJobs.id, id))
    .returning();
  if (!row) throw new Error(`Tutorial job ${id} not found`);
  return row;
}

export async function listTutorialJobsByUser(
  db: DrizzleClient,
  userId: string,
  limit = 50,
): Promise<TutorialJob[]> {
  return db
    .select()
    .from(tutorialJobs)
    .where(eq(tutorialJobs.created_by, userId))
    .orderBy(desc(tutorialJobs.created_at))
    .limit(limit);
}

export async function listTutorialJobsByStatus(
  db: DrizzleClient,
  userId: string,
  status: TutorialJob["status"],
): Promise<TutorialJob[]> {
  return db
    .select()
    .from(tutorialJobs)
    .where(
      and(eq(tutorialJobs.created_by, userId), eq(tutorialJobs.status, status)),
    )
    .orderBy(desc(tutorialJobs.created_at));
}

/**
 * List child segment jobs for a given parent tutorial job, ordered by segment_index.
 * Used by the stitch processor to concat segments in order.
 */
export async function listTutorialJobsByParent(
  db: DrizzleClient,
  parentId: string,
): Promise<TutorialJob[]> {
  return db
    .select()
    .from(tutorialJobs)
    .where(eq(tutorialJobs.parent_job_id, parentId))
    .orderBy(asc(tutorialJobs.segment_index));
}
