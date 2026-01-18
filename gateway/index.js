const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { ApolloGateway } = require('@apollo/gateway');
const express = require('express');
const cors = require('cors');
const http = require('http');

async function startGateway() {
  const gateway = new ApolloGateway({
    serviceList: [
      { name: 'recommendations', url: process.env.RECOMMENDATIONS_URL || 'http://localhost:4001' },
      { name: 'patients', url: process.env.PATIENTS_URL || 'http://localhost:4002' },
      { name: 'providers', url: process.env.PROVIDERS_URL || 'http://localhost:4003' },
      { name: 'recommendation-items', url: process.env.RECOMMENDATION_ITEMS_URL || 'http://localhost:4004' },
      { name: 'institutions', url: process.env.INSTITUTIONS_URL || 'http://localhost:4005' },
      { name: 'epic-api', url: process.env.EPIC_API_URL || 'http://localhost:4006' },
      // Prism Clinical Services
      { name: 'transcription', url: process.env.TRANSCRIPTION_URL || 'http://localhost:4007' },
      { name: 'rag', url: process.env.RAG_URL || 'http://localhost:4008' },
      { name: 'safety', url: process.env.SAFETY_URL || 'http://localhost:4009' },
      { name: 'careplan', url: process.env.CAREPLAN_URL || 'http://localhost:4010' },
      // Admin Service
      { name: 'admin', url: process.env.ADMIN_URL || 'http://localhost:4011' },
      // Auth Service
      { name: 'auth', url: process.env.AUTH_URL || 'http://localhost:4012/graphql' },
      // Care Plan Recommender Service
      { name: 'careplan-recommender', url: process.env.CAREPLAN_RECOMMENDER_URL || 'http://localhost:4013' },
    ],
  });

  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer({
    gateway,
    introspection: true
  });

  await server.start();

  // CORS configuration - allow frontend origins
  app.use(
    '/graphql',
    cors({
      origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://web-dashboard:3000',
        'http://healthcare-web-dashboard:3000',
        // Admin dashboard
        'http://localhost:3001',
        'http://127.0.0.1:3001',
        'http://admin-dashboard:3001',
        'http://healthcare-admin-dashboard:3001'
      ],
      credentials: true
    }),
    express.json(),
    expressMiddleware(server)
  );

  // Health check endpoint
  app.get('/.well-known/apollo/server-health', (req, res) => {
    res.status(200).json({ status: 'pass' });
  });

  await new Promise((resolve) => httpServer.listen({ port: 4000 }, resolve));
  console.log(`🚀 Gateway ready at http://localhost:4000/graphql`);
}

startGateway().catch(error => {
  console.error('Error starting gateway:', error);
  process.exit(1);
});
