/**
 * Pick file queue vs Redis from env.
 */

import path from 'path';
import { FileJobQueue } from './fileQueue.js';

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function createJobQueue(env = process.env) {
  const redisUrl = env.MYTHOS_REDIS_URL?.trim();
  if (redisUrl) {
    const { createRedisJobQueue } = await import('./redisQueue.js');
    return createRedisJobQueue(redisUrl);
  }
  const dir = env.MYTHOS_QUEUE_DIR?.trim() || path.join(process.cwd(), '.mythos-queue');
  return new FileJobQueue(dir);
}
