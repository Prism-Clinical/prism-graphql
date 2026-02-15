const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { ApolloGateway } = require('@apollo/gateway');
const express = require('express');
const cors = require('cors');
const http = require('http');

async function startGateway() {
  // Build service list dynamically - only include services with URLs configured
  const serviceList = [];

  const services = [
    { name: 'auth', envVar: 'AUTH_URL', defaultUrl: 'http://auth-service:4017/graphql' },
    { name: 'patients', envVar: 'PATIENTS_URL', defaultUrl: 'http://patient-service:4005/graphql' },
    { name: 'providers', envVar: 'PROVIDERS_URL', defaultUrl: 'http://provider-service:4006/graphql' },
    { name: 'institutions', envVar: 'INSTITUTIONS_URL', defaultUrl: 'http://organization-service:4002/graphql' },
    { name: 'careplan', envVar: 'CAREPLAN_URL', defaultUrl: 'http://care-plan-service:4004/graphql' },
    { name: 'admin', envVar: 'ADMIN_URL', defaultUrl: 'http://admin-service:4013/graphql' },
    { name: 'safety', envVar: 'SAFETY_URL', defaultUrl: 'http://safety-rules-service:4014/graphql' },
    { name: 'transcription', envVar: 'TRANSCRIPTION_URL', defaultUrl: 'http://audio-intelligence:8101/graphql' },
    { name: 'rag', envVar: 'RAG_URL', defaultUrl: 'http://rag-embeddings:8103/graphql' },
    { name: 'careplan-recommender', envVar: 'CAREPLAN_RECOMMENDER_URL', defaultUrl: 'http://careplan-recommender:8100/graphql' },
    { name: 'epic-api', envVar: 'EPIC_API_URL', defaultUrl: 'http://epic-api-service:4006/graphql' },
  ];

  for (const svc of services) {
    const url = process.env[svc.envVar] || svc.defaultUrl;
    // Skip services marked as disabled
    if (process.env[`${svc.envVar}_DISABLED`] !== 'true') {
      serviceList.push({ name: svc.name, url });
      console.log(`Adding service: ${svc.name} at ${url}`);
    }
  }

  const gateway = new ApolloGateway({
    serviceList,
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
