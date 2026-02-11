/**
 * Pipeline Load Tests
 *
 * k6 load tests for the care plan generation pipeline.
 *
 * Usage:
 *   k6 run load-tests/pipeline-load.js
 *   k6 run --vus 10 --duration 5m load-tests/pipeline-load.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Custom metrics
const carePlanGenerations = new Counter('careplan_generations');
const carePlanErrors = new Counter('careplan_errors');
const carePlanSuccessRate = new Rate('careplan_success_rate');
const carePlanLatency = new Trend('careplan_latency_ms');
const phiAccessCount = new Counter('phi_access_count');

// Test configuration
export const options = {
  scenarios: {
    // Scenario 1: Sustained load from 10 providers
    sustained_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      gracefulStop: '30s',
    },
    // Scenario 2: Burst load of 50 concurrent requests
    burst_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '30s',
      startTime: '6m',
    },
    // Scenario 3: Soak test
    soak_test: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30m',
      startTime: '10m',
      gracefulStop: '1m',
    },
  },
  thresholds: {
    // Pipeline latency thresholds
    'careplan_latency_ms': ['p95<5000', 'p99<10000'], // 95th percentile < 5s
    // Error rate threshold
    'careplan_success_rate': ['rate>0.99'], // 99% success rate
    // Standard HTTP checks
    'http_req_duration': ['p95<3000'], // 95th percentile < 3s
    'http_req_failed': ['rate<0.01'], // Less than 1% errors
  },
};

// Test data
const sampleTranscripts = [
  `Provider: Good morning, how are you feeling today?
   Patient: I've been experiencing some chest pain for the past two days.
   Provider: Can you describe the pain? Is it sharp or dull?
   Patient: It's more of a dull ache, especially when I exert myself.`,
  `Provider: Let's review your medications.
   Patient: I'm taking metformin for diabetes and lisinopril for blood pressure.
   Provider: Any side effects?
   Patient: Some dizziness in the mornings.`,
  `Provider: How has your asthma been?
   Patient: I've needed my rescue inhaler more frequently.
   Provider: How many times per week?
   Patient: About 4-5 times, mostly at night.`,
];

const conditionCodes = [
  ['I10', 'E11.9'],
  ['J45.20', 'R05.9'],
  ['I25.10', 'I10', 'E78.5'],
  ['M54.5', 'M79.3'],
  ['F32.1', 'G47.00'],
];

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:4000';

// Auth token (in real tests, this would be obtained from auth service)
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
    'X-Request-ID': uuidv4(),
    'X-Correlation-ID': uuidv4(),
  };
}

function generateCarePlanMutation(visitId, patientId, transcript, codes, idempotencyKey) {
  return JSON.stringify({
    query: `
      mutation GenerateCarePlan($input: GenerateCarePlanInput!) {
        generateCarePlanFromVisit(input: $input) {
          requestId
          recommendations {
            templateId
            title
            confidence
          }
          extractedEntities {
            symptoms {
              text
              type
            }
            medications {
              text
              type
            }
          }
          redFlags {
            severity
            description
          }
          processingTime
          cacheHit
          degradedServices
        }
      }
    `,
    variables: {
      input: {
        visitId,
        patientId,
        transcriptText: transcript,
        conditionCodes: codes,
        generateDraft: true,
        idempotencyKey,
      },
    },
  });
}

export default function () {
  group('Care Plan Generation', function () {
    // Generate random test data
    const visitId = uuidv4();
    const patientId = uuidv4();
    const transcript = sampleTranscripts[Math.floor(Math.random() * sampleTranscripts.length)];
    const codes = conditionCodes[Math.floor(Math.random() * conditionCodes.length)];
    const idempotencyKey = uuidv4();

    const payload = generateCarePlanMutation(visitId, patientId, transcript, codes, idempotencyKey);
    const headers = getHeaders();

    const startTime = Date.now();

    const res = http.post(`${BASE_URL}/graphql`, payload, { headers });

    const latency = Date.now() - startTime;
    carePlanLatency.add(latency);
    carePlanGenerations.add(1);

    // Check response
    const success = check(res, {
      'status is 200': (r) => r.status === 200,
      'response has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.generateCarePlanFromVisit;
        } catch {
          return false;
        }
      },
      'no GraphQL errors': (r) => {
        try {
          const body = JSON.parse(r.body);
          return !body.errors || body.errors.length === 0;
        } catch {
          return false;
        }
      },
      'has recommendations': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data.generateCarePlanFromVisit.recommendations.length > 0;
        } catch {
          return false;
        }
      },
      'latency under 5s': () => latency < 5000,
    });

    if (success) {
      carePlanSuccessRate.add(1);
      phiAccessCount.add(1); // Track PHI access for monitoring

      // Log processing time from response
      try {
        const body = JSON.parse(res.body);
        const processingTime = body.data.generateCarePlanFromVisit.processingTime;
        if (processingTime) {
          console.log(`Processing time: ${processingTime}ms, Total latency: ${latency}ms`);
        }
      } catch {
        // Ignore parsing errors
      }
    } else {
      carePlanSuccessRate.add(0);
      carePlanErrors.add(1);
      console.error(`Request failed: ${res.status} - ${res.body}`);
    }

    // Think time between requests (simulates real user behavior)
    sleep(Math.random() * 2 + 1);
  });
}

// Test for idempotency
export function idempotencyTest() {
  group('Idempotency Test', function () {
    const visitId = uuidv4();
    const patientId = uuidv4();
    const transcript = sampleTranscripts[0];
    const codes = conditionCodes[0];
    const idempotencyKey = uuidv4();

    const payload = generateCarePlanMutation(visitId, patientId, transcript, codes, idempotencyKey);
    const headers = getHeaders();

    // Send first request
    const res1 = http.post(`${BASE_URL}/graphql`, payload, { headers });

    // Send duplicate request with same idempotency key
    const res2 = http.post(`${BASE_URL}/graphql`, payload, { headers });

    check(res1, {
      'first request succeeded': (r) => r.status === 200,
    });

    check(res2, {
      'duplicate request succeeded': (r) => r.status === 200,
      'same request ID returned': (r) => {
        try {
          const body1 = JSON.parse(res1.body);
          const body2 = JSON.parse(r.body);
          return body1.data.generateCarePlanFromVisit.requestId ===
                 body2.data.generateCarePlanFromVisit.requestId;
        } catch {
          return false;
        }
      },
    });
  });
}

// Test for concurrent requests
export function concurrencyTest() {
  group('Concurrency Test', function () {
    const visitId = uuidv4();
    const idempotencyKey = uuidv4();

    // Create batch of requests
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push({
        method: 'POST',
        url: `${BASE_URL}/graphql`,
        body: generateCarePlanMutation(
          visitId,
          uuidv4(),
          sampleTranscripts[i % sampleTranscripts.length],
          conditionCodes[i % conditionCodes.length],
          `${idempotencyKey}-${i}`
        ),
        params: { headers: getHeaders() },
      });
    }

    // Execute batch
    const responses = http.batch(requests);

    // Check all succeeded
    responses.forEach((res, index) => {
      check(res, {
        [`request ${index} succeeded`]: (r) => r.status === 200,
      });
    });
  });
}

// Teardown function
export function teardown(data) {
  console.log('Load test completed');
  console.log(`Total generations: ${carePlanGenerations.name}`);
}
