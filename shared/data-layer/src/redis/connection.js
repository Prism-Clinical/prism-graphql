"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.getRedisConfig = getRedisConfig;
const redis_1 = require("redis");
class RedisConnection {
    client = null;
    config = null;
    stats = {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalKeys: 0,
        memoryUsage: 0
    };
    async initialize(config) {
        this.config = config;
        this.client = (0, redis_1.createClient)({
            socket: {
                host: config.host,
                port: config.port,
            },
            password: config.password,
            database: config.db || 0,
        });
        this.client.on('error', (err) => {
            console.error('Redis Client Error', err);
        });
        this.client.on('connect', () => {
            console.log('Redis Client Connected');
        });
        await this.client.connect();
    }
    async set(key, value, ttl) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedKey = this.getPrefixedKey(key);
        const serializedValue = JSON.stringify(value);
        if (ttl) {
            await this.client.setEx(prefixedKey, ttl, serializedValue);
        }
        else {
            await this.client.set(prefixedKey, serializedValue);
        }
    }
    async get(key) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedKey = this.getPrefixedKey(key);
        const value = await this.client.get(prefixedKey);
        if (value === null) {
            this.stats.misses++;
            this.updateHitRate();
            return null;
        }
        this.stats.hits++;
        this.updateHitRate();
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    async del(key) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedKey = this.getPrefixedKey(key);
        return this.client.del(prefixedKey);
    }
    async exists(key) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedKey = this.getPrefixedKey(key);
        const result = await this.client.exists(prefixedKey);
        return result === 1;
    }
    async expire(key, ttl) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedKey = this.getPrefixedKey(key);
        const result = await this.client.expire(prefixedKey, ttl);
        return result;
    }
    async ttl(key) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedKey = this.getPrefixedKey(key);
        return this.client.ttl(prefixedKey);
    }
    async keys(pattern) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const prefixedPattern = this.getPrefixedKey(pattern);
        const keys = await this.client.keys(prefixedPattern);
        const prefix = this.config?.keyPrefix || '';
        return keys.map(key => key.startsWith(prefix) ? key.substring(prefix.length) : key);
    }
    async flushPattern(pattern) {
        if (!this.client) {
            throw new Error('Redis connection not initialized');
        }
        const keys = await this.keys(pattern);
        if (keys.length === 0) {
            return 0;
        }
        const prefixedKeys = keys.map(key => this.getPrefixedKey(key));
        return this.client.del(prefixedKeys);
    }
    async healthCheck() {
        try {
            if (!this.client) {
                return false;
            }
            const result = await this.client.ping();
            return result === 'PONG';
        }
        catch {
            return false;
        }
    }
    async getStats() {
        if (!this.client) {
            return this.stats;
        }
        try {
            const info = await this.client.info('memory');
            const memoryMatch = info.match(/used_memory:(\d+)/);
            const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;
            const dbSize = await this.client.dbSize();
            return {
                ...this.stats,
                totalKeys: dbSize,
                memoryUsage
            };
        }
        catch {
            return this.stats;
        }
    }
    async close() {
        if (this.client) {
            await this.client.quit();
            this.client = null;
        }
    }
    getPrefixedKey(key) {
        const prefix = this.config?.keyPrefix || '';
        return `${prefix}${key}`;
    }
    updateHitRate() {
        const total = this.stats.hits + this.stats.misses;
        this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    }
    async invalidateByTag(tag) {
        const pattern = `*:tag:${tag}:*`;
        return this.flushPattern(pattern);
    }
    async setWithTags(key, value, tags, ttl) {
        await this.set(key, value, ttl);
        for (const tag of tags) {
            const tagKey = `tag:${tag}:${key}`;
            await this.set(tagKey, true, ttl);
        }
    }
}
exports.redis = new RedisConnection();
function getRedisConfig() {
    return {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'healthcare:',
        maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
    };
}
//# sourceMappingURL=connection.js.map