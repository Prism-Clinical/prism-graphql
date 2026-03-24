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

  it('should execute AGE LOAD SQL when connect handler is invoked', async () => {
    const { initializeDatabase } = require('../services/database');
    const mockQuery = jest.fn().mockResolvedValue({});
    const mockClient = { query: mockQuery };
    const mockPool = { on: jest.fn() } as any;
    const mockRedis = {} as any;
    initializeDatabase(mockPool, mockRedis);

    // Extract and invoke the registered connect callback
    const connectCallback = mockPool.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'connect'
    )?.[1];
    expect(connectCallback).toBeDefined();
    await connectCallback(mockClient);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("LOAD 'age'")
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET search_path')
    );
  });
});
