import { RecommendationJob, JobStatus, RecommendationJobType, JobPriority } from '@shared/data-layer/src/types';
export declare class RecommendationJobQueries {
    static createJob(sessionId: string, patientId: string, jobType: RecommendationJobType, priority?: JobPriority, inputData?: any): Promise<RecommendationJob>;
    static getJobById(jobId: string): Promise<RecommendationJob | null>;
    static getNextPendingJob(): Promise<RecommendationJob | null>;
    static getJobsBySession(sessionId: string): Promise<RecommendationJob[]>;
    static getJobsByPatient(patientId: string, status?: JobStatus, limit?: number): Promise<RecommendationJob[]>;
    static updateJobStatus(jobId: string, status: JobStatus, errorMessage?: string): Promise<boolean>;
    static updateJobResults(jobId: string, results: any): Promise<boolean>;
    static cancelJob(jobId: string): Promise<boolean>;
    static cancelJobsBySession(sessionId: string): Promise<number>;
    static getJobQueue(limit?: number): Promise<RecommendationJob[]>;
    static getJobStats(): Promise<{
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
        avgProcessingTime: number | null;
    }>;
    static cleanupOldJobs(olderThanDays?: number): Promise<number>;
    static retryFailedJob(jobId: string): Promise<boolean>;
}
//# sourceMappingURL=recommendation-jobs.d.ts.map