// Use isolateModules so each test gets a fresh module state (pool/redis undefined)
describe('database initialization', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should throw if getPool called before init', () => {
    const { getPool } = require('../services/database');
    expect(() => getPool()).toThrow('Database not initialized');
  });

  it('should throw if getRedis called before init', () => {
    const { getRedis } = require('../services/database');
    expect(() => getRedis()).toThrow('Database not initialized');
  });

  it('should return pool and redis after init', () => {
    const { initializeDatabase, getPool, getRedis } = require('../services/database');
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    expect(getPool()).toBe(mockPool);
    expect(getRedis()).toBe(mockRedis);
  });

  it('should register connect handler on pool for AGE LOAD + search_path', () => {
    const { initializeDatabase } = require('../services/database');
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    expect(mockPool.on).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});
