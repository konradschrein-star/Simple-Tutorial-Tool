import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tutorialJobs, users } from "@repo/db";

/**
 * Tutorial Repository (hub-web side)
 *
 * Server-side reads for the Dashboard metrics.
 * Uses window / filter counts following the analytics-repository pattern.
 */

export interface TutorialTotals {
  total: number;
  week: number;
}

export interface LeaderboardEntry {
  userId: string | null;
  name: string | null;
  completed: number;
}

export async function getTutorialTotals(): Promise<TutorialTotals> {
  const [total] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(tutorialJobs)
    .where(sql`${tutorialJobs.status} = 'COMPLETED'`);

  const [week] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(tutorialJobs)
    .where(
      sql`${tutorialJobs.status} = 'COMPLETED' AND ${tutorialJobs.completed_at} >= now() - interval '7 days'`,
    );

  return {
    total: total?.count ?? 0,
    week: week?.count ?? 0,
  };
}

export async function getTutorialLeaderboard(): Promise<LeaderboardEntry[]> {
  return db
    .select({
      userId: tutorialJobs.created_by,
      name: users.name,
      completed: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') as integer)`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .groupBy(tutorialJobs.created_by, users.name)
    .orderBy(
      sql`count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') desc`,
    );
}
