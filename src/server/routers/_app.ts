import { createTRPCRouter } from '@/server/trpc';
import { userRouter } from './user';
import { workingGroupRouter } from './workingGroup';
import { standardRouter } from './standard';
import { documentRouter } from './document';
import { voteRouter } from './vote';
import { meetingRouter } from './meeting';
import { taskRouter } from './task';
import { notificationRouter } from './notification';

/**
 * This is the primary router for the server.
 * All routers added here will be merged into a single router.
 */
export const appRouter = createTRPCRouter({
  user: userRouter,
  workingGroup: workingGroupRouter,
  standard: standardRouter,
  document: documentRouter,
  vote: voteRouter,
  meeting: meetingRouter,
  task: taskRouter,
  notification: notificationRouter,
});

export type AppRouter = typeof appRouter;
