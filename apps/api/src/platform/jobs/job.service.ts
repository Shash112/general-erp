import { logger } from '../../config/logger.js';

export interface JobPayload {
  id: string;
  queueName: string;
  jobName: string;
  tenantId: string;
  data: Record<string, unknown>;
  maxRetries?: number;
}

export class JobService {
  private deadLetterQueue: Array<JobPayload & { errorMessage: string; failedAt: Date }> = [];

  /**
   * Enqueue job for background processing
   */
  async enqueueJob(payload: JobPayload): Promise<void> {
    logger.info({ queue: payload.queueName, job: payload.jobName, jobId: payload.id }, '[JOB] Enqueued background job');
  }

  /**
   * Record job execution failure into dead-letter store for Exception Queue UI management
   */
  async recordFailure(job: JobPayload, error: Error): Promise<void> {
    logger.error({ queue: job.queueName, job: job.jobName, jobId: job.id, err: error }, '[JOB_FAILURE] Job failed permanently after retries');
    
    this.deadLetterQueue.push({
      ...job,
      errorMessage: error.message,
      failedAt: new Date()
    });
  }

  getDeadLetterJobs() {
    return this.deadLetterQueue;
  }
}

export const jobService = new JobService();
