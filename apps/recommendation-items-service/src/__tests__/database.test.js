"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("@recommendation-items/services/database");
const resolvers_types_1 = require("@recommendation-items/__generated__/resolvers-types");
describe('RecommendationItemService', () => {
    let service;
    let mockPool;
    let mockRedis;
    let mockClient;
    beforeEach(() => {
        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };
        mockPool = {
            connect: jest.fn().mockResolvedValue(mockClient),
            query: jest.fn(),
            end: jest.fn()
        };
        mockRedis = {
            get: jest.fn(),
            setex: jest.fn(),
            del: jest.fn(),
            keys: jest.fn()
        };
        (0, database_1.initializeDatabase)(mockPool, mockRedis);
        service = new database_1.RecommendationItemService();
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('getRecommendationItem', () => {
        it('returns cached recommendation item if available', async () => {
            const cachedItem = {
                id: '1',
                type: resolvers_types_1.RecommendationItemType.Medication,
                title: 'Metformin 500mg',
                description: 'First-line medication for type 2 diabetes',
                instructions: 'Take twice daily with meals',
                evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                studyReferences: ['PMID: 99887766'],
                guidelines: ['ADA Standards of Care'],
                contraindications: ['eGFR <30 mL/min/1.73m²'],
                sideEffects: ['GI upset'],
                category: 'Antidiabetic',
                isActive: true
            };
            mockRedis.get.mockResolvedValue(JSON.stringify(cachedItem));
            const result = await service.getRecommendationItem('1');
            expect(mockRedis.get).toHaveBeenCalledWith('recommendation_item:1');
            expect(result).toEqual(cachedItem);
            expect(mockPool.connect).not.toHaveBeenCalled();
        });
        it('fetches recommendation item from database if not cached', async () => {
            const dbRow = {
                id: '1',
                type: 'MEDICATION',
                title: 'Metformin 500mg',
                description: 'First-line medication for type 2 diabetes',
                instructions: 'Take twice daily with meals',
                evidence_level: 'LEVEL_I',
                study_references: ['PMID: 99887766'],
                guidelines: ['ADA Standards of Care'],
                contraindications: ['eGFR <30 mL/min/1.73m²'],
                side_effects: ['GI upset'],
                category: 'Antidiabetic',
                is_active: true
            };
            mockRedis.get.mockResolvedValue(null);
            mockClient.query.mockResolvedValue({ rows: [dbRow] });
            const result = await service.getRecommendationItem('1');
            expect(mockRedis.get).toHaveBeenCalledWith('recommendation_item:1');
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM recommendation_items WHERE id = $1 AND is_active = true', ['1']);
            expect(mockRedis.setex).toHaveBeenCalledWith('recommendation_item:1', 3600, JSON.stringify({
                id: '1',
                type: resolvers_types_1.RecommendationItemType.Medication,
                title: 'Metformin 500mg',
                description: 'First-line medication for type 2 diabetes',
                instructions: 'Take twice daily with meals',
                evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                studyReferences: ['PMID: 99887766'],
                guidelines: ['ADA Standards of Care'],
                contraindications: ['eGFR <30 mL/min/1.73m²'],
                sideEffects: ['GI upset'],
                category: 'Antidiabetic',
                isActive: true
            }));
        });
        it('returns null if recommendation item not found', async () => {
            mockRedis.get.mockResolvedValue(null);
            mockClient.query.mockResolvedValue({ rows: [] });
            const result = await service.getRecommendationItem('nonexistent');
            expect(result).toBeNull();
            expect(mockRedis.setex).not.toHaveBeenCalled();
        });
    });
    describe('getAllRecommendationItems', () => {
        it('returns cached recommendation items if available', async () => {
            const cachedItems = [
                {
                    id: '1',
                    type: resolvers_types_1.RecommendationItemType.Medication,
                    title: 'Metformin 500mg',
                    description: 'First-line medication for type 2 diabetes',
                    instructions: 'Take twice daily with meals',
                    evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                    studyReferences: ['PMID: 99887766'],
                    guidelines: ['ADA Standards of Care'],
                    contraindications: ['eGFR <30 mL/min/1.73m²'],
                    sideEffects: ['GI upset'],
                    category: 'Antidiabetic',
                    isActive: true
                }
            ];
            mockRedis.get.mockResolvedValue(JSON.stringify(cachedItems));
            const result = await service.getAllRecommendationItems();
            expect(mockRedis.get).toHaveBeenCalledWith('recommendation_items:all');
            expect(result).toEqual(cachedItems);
        });
        it('fetches recommendation items from database if not cached', async () => {
            const dbRows = [
                {
                    id: '1',
                    type: 'MEDICATION',
                    title: 'Metformin 500mg',
                    description: 'First-line medication for type 2 diabetes',
                    instructions: 'Take twice daily with meals',
                    evidence_level: 'LEVEL_I',
                    study_references: ['PMID: 99887766'],
                    guidelines: ['ADA Standards of Care'],
                    contraindications: ['eGFR <30 mL/min/1.73m²'],
                    side_effects: ['GI upset'],
                    category: 'Antidiabetic',
                    is_active: true
                }
            ];
            mockRedis.get.mockResolvedValue(null);
            mockClient.query.mockResolvedValue({ rows: dbRows });
            const result = await service.getAllRecommendationItems();
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM recommendation_items WHERE is_active = true ORDER BY category, title');
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe(resolvers_types_1.RecommendationItemType.Medication);
        });
    });
    describe('getRecommendationItemsByType', () => {
        it('fetches recommendation items by type from database', async () => {
            const dbRows = [
                {
                    id: '1',
                    type: 'MEDICATION',
                    title: 'Metformin 500mg',
                    description: 'First-line medication for type 2 diabetes',
                    instructions: 'Take twice daily with meals',
                    evidence_level: 'LEVEL_I',
                    study_references: ['PMID: 99887766'],
                    guidelines: ['ADA Standards of Care'],
                    contraindications: ['eGFR <30 mL/min/1.73m²'],
                    side_effects: ['GI upset'],
                    category: 'Antidiabetic',
                    is_active: true
                }
            ];
            mockClient.query.mockResolvedValue({ rows: dbRows });
            const result = await service.getRecommendationItemsByType(resolvers_types_1.RecommendationItemType.Medication);
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM recommendation_items WHERE type = $1 AND is_active = true ORDER BY title', ['MEDICATION']);
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe(resolvers_types_1.RecommendationItemType.Medication);
        });
    });
    describe('getRecommendationItemsByCategory', () => {
        it('fetches recommendation items by category from database', async () => {
            const dbRows = [
                {
                    id: '1',
                    type: 'MEDICATION',
                    title: 'Metformin 500mg',
                    description: 'First-line medication for type 2 diabetes',
                    instructions: 'Take twice daily with meals',
                    evidence_level: 'LEVEL_I',
                    study_references: ['PMID: 99887766'],
                    guidelines: ['ADA Standards of Care'],
                    contraindications: ['eGFR <30 mL/min/1.73m²'],
                    side_effects: ['GI upset'],
                    category: 'Antidiabetic',
                    is_active: true
                }
            ];
            mockClient.query.mockResolvedValue({ rows: dbRows });
            const result = await service.getRecommendationItemsByCategory('Antidiabetic');
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM recommendation_items WHERE category = $1 AND is_active = true ORDER BY title', ['Antidiabetic']);
            expect(result).toHaveLength(1);
            expect(result[0].category).toBe('Antidiabetic');
        });
    });
    describe('getRecommendationItemsByEvidenceLevel', () => {
        it('fetches recommendation items by evidence level from database', async () => {
            const dbRows = [
                {
                    id: '1',
                    type: 'MEDICATION',
                    title: 'Metformin 500mg',
                    description: 'First-line medication for type 2 diabetes',
                    instructions: 'Take twice daily with meals',
                    evidence_level: 'LEVEL_I',
                    study_references: ['PMID: 99887766'],
                    guidelines: ['ADA Standards of Care'],
                    contraindications: ['eGFR <30 mL/min/1.73m²'],
                    side_effects: ['GI upset'],
                    category: 'Antidiabetic',
                    is_active: true
                }
            ];
            mockClient.query.mockResolvedValue({ rows: dbRows });
            const result = await service.getRecommendationItemsByEvidenceLevel(resolvers_types_1.EvidenceLevel.LevelI);
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM recommendation_items WHERE evidence_level = $1 AND is_active = true ORDER BY title', ['LEVEL_I']);
            expect(result).toHaveLength(1);
            expect(result[0].evidenceLevel).toBe(resolvers_types_1.EvidenceLevel.LevelI);
        });
    });
    describe('searchRecommendationItems', () => {
        it('searches recommendation items by title and description', async () => {
            const dbRows = [
                {
                    id: '1',
                    type: 'MEDICATION',
                    title: 'Metformin 500mg',
                    description: 'First-line medication for type 2 diabetes',
                    instructions: 'Take twice daily with meals',
                    evidence_level: 'LEVEL_I',
                    study_references: ['PMID: 99887766'],
                    guidelines: ['ADA Standards of Care'],
                    contraindications: ['eGFR <30 mL/min/1.73m²'],
                    side_effects: ['GI upset'],
                    category: 'Antidiabetic',
                    is_active: true
                }
            ];
            mockClient.query.mockResolvedValue({ rows: dbRows });
            const result = await service.searchRecommendationItems('diabetes');
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM recommendation_items WHERE (title ILIKE $1 OR description ILIKE $1) AND is_active = true ORDER BY title', ['%diabetes%']);
            expect(result).toHaveLength(1);
            expect(result[0].description).toContain('diabetes');
        });
    });
    describe('createRecommendationItem', () => {
        it('creates a new recommendation item', async () => {
            const newItem = {
                type: resolvers_types_1.RecommendationItemType.Medication,
                title: 'Lisinopril 10mg',
                description: 'ACE inhibitor for hypertension',
                instructions: 'Take once daily',
                evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                studyReferences: ['PMID: 12345678'],
                guidelines: ['AHA Guidelines'],
                contraindications: ['Angioedema history'],
                sideEffects: ['Dry cough'],
                category: 'Antihypertensive'
            };
            const dbRow = {
                id: '2',
                type: 'MEDICATION',
                title: 'Lisinopril 10mg',
                description: 'ACE inhibitor for hypertension',
                instructions: 'Take once daily',
                evidence_level: 'LEVEL_I',
                study_references: ['PMID: 12345678'],
                guidelines: ['AHA Guidelines'],
                contraindications: ['Angioedema history'],
                side_effects: ['Dry cough'],
                category: 'Antihypertensive',
                is_active: true
            };
            mockClient.query.mockResolvedValue({ rows: [dbRow] });
            const result = await service.createRecommendationItem(newItem);
            expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO recommendation_items'), [
                'MEDICATION',
                'Lisinopril 10mg',
                'ACE inhibitor for hypertension',
                'Take once daily',
                'LEVEL_I',
                ['PMID: 12345678'],
                ['AHA Guidelines'],
                ['Angioedema history'],
                ['Dry cough'],
                'Antihypertensive'
            ]);
            expect(result.id).toBe('2');
            expect(result.type).toBe(resolvers_types_1.RecommendationItemType.Medication);
            expect(mockRedis.del).toHaveBeenCalledWith('recommendation_items:all');
        });
    });
    describe('updateRecommendationItem', () => {
        it('updates an existing recommendation item', async () => {
            const updateData = {
                title: 'Metformin 1000mg',
                description: 'Updated dosage for type 2 diabetes',
                instructions: 'Take once daily with dinner'
            };
            const dbRow = {
                id: '1',
                type: 'MEDICATION',
                title: 'Metformin 1000mg',
                description: 'Updated dosage for type 2 diabetes',
                instructions: 'Take once daily with dinner',
                evidence_level: 'LEVEL_I',
                study_references: ['PMID: 99887766'],
                guidelines: ['ADA Standards of Care'],
                contraindications: ['eGFR <30 mL/min/1.73m²'],
                side_effects: ['GI upset'],
                category: 'Antidiabetic',
                is_active: true
            };
            mockClient.query.mockResolvedValue({ rows: [dbRow] });
            const result = await service.updateRecommendationItem('1', updateData);
            expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE recommendation_items'), ['Metformin 1000mg', 'Updated dosage for type 2 diabetes', 'Take once daily with dinner', '1']);
            expect(result?.title).toBe('Metformin 1000mg');
            expect(mockRedis.del).toHaveBeenCalledWith('recommendation_item:1');
            expect(mockRedis.del).toHaveBeenCalledWith('recommendation_items:all');
        });
        it('returns null if recommendation item not found', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });
            const result = await service.updateRecommendationItem('nonexistent', { title: 'Updated' });
            expect(result).toBeNull();
        });
    });
    describe('deleteRecommendationItem', () => {
        it('soft deletes a recommendation item', async () => {
            mockClient.query.mockResolvedValue({ rowCount: 1 });
            const result = await service.deleteRecommendationItem('1');
            expect(mockClient.query).toHaveBeenCalledWith('UPDATE recommendation_items SET is_active = false WHERE id = $1', ['1']);
            expect(result).toBe(true);
            expect(mockRedis.del).toHaveBeenCalledWith('recommendation_item:1');
            expect(mockRedis.del).toHaveBeenCalledWith('recommendation_items:all');
        });
        it('returns false if recommendation item not found', async () => {
            mockClient.query.mockResolvedValue({ rowCount: 0 });
            const result = await service.deleteRecommendationItem('nonexistent');
            expect(result).toBe(false);
        });
    });
    describe('error handling', () => {
        it('handles database connection errors', async () => {
            mockPool.connect.mockRejectedValue(new Error('Connection failed'));
            await expect(service.getRecommendationItem('1')).rejects.toThrow('Connection failed');
        });
        it('handles Redis errors gracefully', async () => {
            mockRedis.get.mockRejectedValue(new Error('Redis error'));
            const dbRow = {
                id: '1',
                type: 'MEDICATION',
                title: 'Metformin 500mg',
                description: 'First-line medication for type 2 diabetes',
                instructions: 'Take twice daily with meals',
                evidence_level: 'LEVEL_I',
                study_references: ['PMID: 99887766'],
                guidelines: ['ADA Standards of Care'],
                contraindications: ['eGFR <30 mL/min/1.73m²'],
                side_effects: ['GI upset'],
                category: 'Antidiabetic',
                is_active: true
            };
            mockClient.query.mockResolvedValue({ rows: [dbRow] });
            const result = await service.getRecommendationItem('1');
            expect(result).toBeDefined();
            expect(result?.id).toBe('1');
        });
    });
});
//# sourceMappingURL=database.test.js.map