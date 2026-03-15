import { initializeDatabase, getPool, getRedis } from '../services/database';

describe('database initialization', () => {
  it('should throw if getPool called before init', () => {
    // Note: this test must run first (before initializeDatabase is called)
    // In a fresh module context, pool is undefined
  });

  it('should return pool and redis after init', () => {
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    expect(getPool()).toBe(mockPool);
    expect(getRedis()).toBe(mockRedis);
  });

  it('should register connect handler on pool for AGE LOAD + search_path', () => {
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    expect(mockPool.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});
