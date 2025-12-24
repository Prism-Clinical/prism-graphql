"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("@apollo/server");
const subgraph_1 = require("@apollo/subgraph");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const fs_1 = require("fs");
const path_1 = require("path");
const database_1 = require("@recommendation-items/services/database");
const resolvers_types_1 = require("@recommendation-items/__generated__/resolvers-types");
jest.mock('@recommendation-items/services/database');
const typeDefs = (0, graphql_tag_1.default)((0, fs_1.readFileSync)((0, path_1.join)(__dirname, '../../schema.graphql'), 'utf8'));
const resolvers = {
    Query: {
        recommendationItem: async (_, { id }) => {
            const service = new database_1.RecommendationItemService();
            return service.getRecommendationItem(id);
        },
        recommendationItems: async () => {
            const service = new database_1.RecommendationItemService();
            return service.getAllRecommendationItems();
        },
        itemsByType: async (_, { type }) => {
            const service = new database_1.RecommendationItemService();
            return service.getRecommendationItemsByType(type);
        },
        itemsByCategory: async (_, { category }) => {
            const service = new database_1.RecommendationItemService();
            return service.getRecommendationItemsByCategory(category);
        },
        itemsByEvidenceLevel: async (_, { evidenceLevel }) => {
            const service = new database_1.RecommendationItemService();
            return service.getRecommendationItemsByEvidenceLevel(evidenceLevel);
        },
        searchRecommendationItems: async (_, { searchTerm }) => {
            const service = new database_1.RecommendationItemService();
            return service.searchRecommendationItems(searchTerm);
        }
    },
    Mutation: {
        createRecommendationItem: async (_, { input }) => {
            const service = new database_1.RecommendationItemService();
            return service.createRecommendationItem(input);
        },
        updateRecommendationItem: async (_, { id, input }) => {
            const service = new database_1.RecommendationItemService();
            return service.updateRecommendationItem(id, input);
        },
        deleteRecommendationItem: async (_, { id }) => {
            const service = new database_1.RecommendationItemService();
            return service.deleteRecommendationItem(id);
        }
    },
    RecommendationItem: {
        __resolveReference: async (reference) => {
            const service = new database_1.RecommendationItemService();
            return service.getRecommendationItem(reference.id);
        }
    },
    Recommendation: {
        items: async (recommendation) => {
            return [];
        }
    }
};
describe('RecommendationItem GraphQL Queries', () => {
    let server;
    let mockService;
    beforeEach(() => {
        mockService = new database_1.RecommendationItemService();
        database_1.RecommendationItemService.mockImplementation(() => mockService);
        server = new server_1.ApolloServer({
            schema: (0, subgraph_1.buildSubgraphSchema)({ typeDefs, resolvers }),
        });
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('recommendationItem query', () => {
        it('returns a recommendation item by ID', async () => {
            const mockItem = {
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
            mockService.getRecommendationItem.mockResolvedValue(mockItem);
            const query = `
        query GetRecommendationItem($id: ID!) {
          recommendationItem(id: $id) {
            id
            type
            title
            description
            instructions
            evidenceLevel
            studyReferences
            guidelines
            contraindications
            sideEffects
            category
            isActive
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: { id: '1' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.recommendationItem).toEqual(mockItem);
            }
            expect(mockService.getRecommendationItem).toHaveBeenCalledWith('1');
        });
        it('returns null for non-existent recommendation item', async () => {
            mockService.getRecommendationItem.mockResolvedValue(null);
            const query = `
        query GetRecommendationItem($id: ID!) {
          recommendationItem(id: $id) {
            id
            title
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: { id: 'nonexistent' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.recommendationItem).toBeNull();
            }
            expect(mockService.getRecommendationItem).toHaveBeenCalledWith('nonexistent');
        });
    });
    describe('recommendationItems query', () => {
        it('returns all recommendation items', async () => {
            const mockItems = [
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
                },
                {
                    id: '2',
                    type: resolvers_types_1.RecommendationItemType.LabTest,
                    title: 'Hemoglobin A1C',
                    description: 'Glycemic control assessment',
                    instructions: 'No fasting required',
                    evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                    studyReferences: ['PMID: 13579246'],
                    guidelines: ['ADA Glycemic Targets'],
                    contraindications: ['Hemoglobinopathies may affect accuracy'],
                    sideEffects: ['None'],
                    category: 'Laboratory',
                    isActive: true
                }
            ];
            mockService.getAllRecommendationItems.mockResolvedValue(mockItems);
            const query = `
        query GetAllRecommendationItems {
          recommendationItems {
            id
            type
            title
            description
            category
            isActive
          }
        }
      `;
            const response = await server.executeOperation({ query });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.recommendationItems).toHaveLength(2);
                expect((response.body.singleResult.data?.recommendationItems)[0].title).toBe('Metformin 500mg');
            }
            expect(mockService.getAllRecommendationItems).toHaveBeenCalled();
        });
    });
    describe('itemsByType query', () => {
        it('returns recommendation items filtered by type', async () => {
            const mockItems = [
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
            mockService.getRecommendationItemsByType.mockResolvedValue(mockItems);
            const query = `
        query GetItemsByType($type: RecommendationItemType!) {
          itemsByType(type: $type) {
            id
            type
            title
            category
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: { type: 'MEDICATION' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.itemsByType).toHaveLength(1);
                expect((response.body.singleResult.data?.itemsByType)[0].type).toBe('MEDICATION');
            }
            expect(mockService.getRecommendationItemsByType).toHaveBeenCalledWith(resolvers_types_1.RecommendationItemType.Medication);
        });
    });
    describe('itemsByCategory query', () => {
        it('returns recommendation items filtered by category', async () => {
            const mockItems = [
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
            mockService.getRecommendationItemsByCategory.mockResolvedValue(mockItems);
            const query = `
        query GetItemsByCategory($category: String!) {
          itemsByCategory(category: $category) {
            id
            type
            title
            category
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: { category: 'Antidiabetic' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.itemsByCategory).toHaveLength(1);
                expect((response.body.singleResult.data?.itemsByCategory)[0].category).toBe('Antidiabetic');
            }
            expect(mockService.getRecommendationItemsByCategory).toHaveBeenCalledWith('Antidiabetic');
        });
    });
    describe('itemsByEvidenceLevel query', () => {
        it('returns recommendation items filtered by evidence level', async () => {
            const mockItems = [
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
            mockService.getRecommendationItemsByEvidenceLevel.mockResolvedValue(mockItems);
            const query = `
        query GetItemsByEvidenceLevel($evidenceLevel: EvidenceLevel!) {
          itemsByEvidenceLevel(evidenceLevel: $evidenceLevel) {
            id
            evidenceLevel
            title
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: { evidenceLevel: 'LEVEL_I' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.itemsByEvidenceLevel).toHaveLength(1);
                expect((response.body.singleResult.data?.itemsByEvidenceLevel)[0].evidenceLevel).toBe('LEVEL_I');
            }
            expect(mockService.getRecommendationItemsByEvidenceLevel).toHaveBeenCalledWith(resolvers_types_1.EvidenceLevel.LevelI);
        });
    });
    describe('searchRecommendationItems query', () => {
        it('returns recommendation items matching search term', async () => {
            const mockItems = [
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
            mockService.searchRecommendationItems.mockResolvedValue(mockItems);
            const query = `
        query SearchRecommendationItems($searchTerm: String!) {
          searchRecommendationItems(searchTerm: $searchTerm) {
            id
            title
            description
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: { searchTerm: 'diabetes' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.searchRecommendationItems).toHaveLength(1);
                expect((response.body.singleResult.data?.searchRecommendationItems)[0].description).toContain('diabetes');
            }
            expect(mockService.searchRecommendationItems).toHaveBeenCalledWith('diabetes');
        });
    });
    describe('mutations', () => {
        it('creates a new recommendation item', async () => {
            const mockItem = {
                id: '2',
                type: resolvers_types_1.RecommendationItemType.Medication,
                title: 'Lisinopril 10mg',
                description: 'ACE inhibitor for hypertension',
                instructions: 'Take once daily',
                evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                studyReferences: ['PMID: 12345678'],
                guidelines: ['AHA Guidelines'],
                contraindications: ['Angioedema history'],
                sideEffects: ['Dry cough'],
                category: 'Antihypertensive',
                isActive: true
            };
            mockService.createRecommendationItem.mockResolvedValue(mockItem);
            const mutation = `
        mutation CreateRecommendationItem($input: CreateRecommendationItemInput!) {
          createRecommendationItem(input: $input) {
            id
            type
            title
            description
            category
          }
        }
      `;
            const response = await server.executeOperation({
                query: mutation,
                variables: {
                    input: {
                        type: 'MEDICATION',
                        title: 'Lisinopril 10mg',
                        description: 'ACE inhibitor for hypertension',
                        instructions: 'Take once daily',
                        evidenceLevel: 'LEVEL_I',
                        studyReferences: ['PMID: 12345678'],
                        guidelines: ['AHA Guidelines'],
                        contraindications: ['Angioedema history'],
                        sideEffects: ['Dry cough'],
                        category: 'Antihypertensive'
                    }
                }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect((response.body.singleResult.data?.createRecommendationItem).title).toBe('Lisinopril 10mg');
            }
            expect(mockService.createRecommendationItem).toHaveBeenCalled();
        });
        it('updates an existing recommendation item', async () => {
            const mockItem = {
                id: '1',
                type: resolvers_types_1.RecommendationItemType.Medication,
                title: 'Metformin 1000mg',
                description: 'Updated dosage for type 2 diabetes',
                instructions: 'Take once daily with dinner',
                evidenceLevel: resolvers_types_1.EvidenceLevel.LevelI,
                studyReferences: ['PMID: 99887766'],
                guidelines: ['ADA Standards of Care'],
                contraindications: ['eGFR <30 mL/min/1.73m²'],
                sideEffects: ['GI upset'],
                category: 'Antidiabetic',
                isActive: true
            };
            mockService.updateRecommendationItem.mockResolvedValue(mockItem);
            const mutation = `
        mutation UpdateRecommendationItem($id: ID!, $input: UpdateRecommendationItemInput!) {
          updateRecommendationItem(id: $id, input: $input) {
            id
            title
            description
            instructions
          }
        }
      `;
            const response = await server.executeOperation({
                query: mutation,
                variables: {
                    id: '1',
                    input: {
                        title: 'Metformin 1000mg',
                        description: 'Updated dosage for type 2 diabetes',
                        instructions: 'Take once daily with dinner'
                    }
                }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect((response.body.singleResult.data?.updateRecommendationItem).title).toBe('Metformin 1000mg');
            }
            expect(mockService.updateRecommendationItem).toHaveBeenCalledWith('1', expect.any(Object));
        });
        it('deletes a recommendation item', async () => {
            mockService.deleteRecommendationItem.mockResolvedValue(true);
            const mutation = `
        mutation DeleteRecommendationItem($id: ID!) {
          deleteRecommendationItem(id: $id)
        }
      `;
            const response = await server.executeOperation({
                query: mutation,
                variables: { id: '1' }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect(response.body.singleResult.data?.deleteRecommendationItem).toBe(true);
            }
            expect(mockService.deleteRecommendationItem).toHaveBeenCalledWith('1');
        });
    });
    describe('federation', () => {
        it('resolves recommendation item reference', async () => {
            const mockItem = {
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
            mockService.getRecommendationItem.mockResolvedValue(mockItem);
            const query = `
        query GetRecommendationItemReference($representations: [_Any!]!) {
          _entities(representations: $representations) {
            ... on RecommendationItem {
              id
              title
              type
            }
          }
        }
      `;
            const response = await server.executeOperation({
                query,
                variables: {
                    representations: [{ __typename: 'RecommendationItem', id: '1' }]
                }
            });
            expect(response.body.kind).toBe('single');
            if (response.body.kind === 'single') {
                expect(response.body.singleResult.errors).toBeUndefined();
                expect((response.body.singleResult.data?._entities)[0].id).toBe('1');
            }
            expect(mockService.getRecommendationItem).toHaveBeenCalledWith('1');
        });
    });
});
//# sourceMappingURL=query.test.js.map