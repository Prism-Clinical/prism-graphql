const { ApolloServer } = require('@apollo/server');
const { ApolloGateway } = require('@apollo/gateway');
const { startStandaloneServer } = require('@apollo/server/standalone');

async function startGateway() {
  const gateway = new ApolloGateway({
    serviceList: [
      { name: 'recommendations', url: process.env.RECOMMENDATIONS_URL || 'http://localhost:4001' },
      { name: 'patients', url: process.env.PATIENTS_URL || 'http://localhost:4002' },
      { name: 'providers', url: process.env.PROVIDERS_URL || 'http://localhost:4003' },
      { name: 'recommendation-items', url: process.env.RECOMMENDATION_ITEMS_URL || 'http://localhost:4004' },
      { name: 'institutions', url: process.env.INSTITUTIONS_URL || 'http://localhost:4005' },
      { name: 'epic-api', url: process.env.EPIC_API_URL || 'http://localhost:4006' }
    ],
  });

  const server = new ApolloServer({
    gateway,
    introspection: true
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: 4000 }
  });

  console.log(`🚀 Gateway ready at ${url}`);
}

startGateway().catch(error => {
  console.error('Error starting gateway:', error);
  process.exit(1);
});