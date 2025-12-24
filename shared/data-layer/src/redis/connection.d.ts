import { RedisConfig, CacheStats } from '@shared/data-layer/src/types';
declare class RedisConnection {
    private client;
    private config;
    private stats;
    initialize(config: RedisConfig): Promise<void>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    get<T>(key: string): Promise<T | null>;
    del(key: string): Promise<number>;
    exists(key: string): Promise<boolean>;
    expire(key: string, ttl: number): Promise<boolean>;
    ttl(key: string): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    flushPattern(pattern: string): Promise<number>;
    healthCheck(): Promise<boolean>;
    getStats(): Promise<CacheStats>;
    close(): Promise<void>;
    private getPrefixedKey;
    private updateHitRate;
    invalidateByTag(tag: string): Promise<number>;
    setWithTags<T>(key: string, value: T, tags: string[], ttl?: number): Promise<void>;
}
export declare const redis: RedisConnection;
export declare function getRedisConfig(): RedisConfig;
export {};
//# sourceMappingURL=connection.d.ts.map