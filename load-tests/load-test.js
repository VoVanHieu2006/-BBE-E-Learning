import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const coursesDuration = new Trend('duration_courses');
const leaderboardDuration = new Trend('duration_leaderboard');
const healthDuration = new Trend('duration_health');
const homeDuration = new Trend('duration_home');

export const options = {
  stages: [
    { duration: '30s', target: 15 }, // Warm-up to 15 VUs
    { duration: '1m', target: 30 },  // Normal peak 30 VUs
    { duration: '1m', target: 60 },  // High load 60 VUs
    { duration: '30s', target: 100 }, // Peak stress 100 VUs
    { duration: '30s', target: 0 },   // Cool-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.10'], // <10% failed requests
    http_req_duration: ['p(95)<3000'], // 95% under 3s
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const rand = Math.random();

  if (rand < 0.35) {
    // 35% traffic: Frontend SSR / static
    let res = http.get(`${BASE_URL}/login`);
    homeDuration.add(res.timings.duration);
    let ok = check(res, { 'status is 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else if (rand < 0.70) {
    // 35% traffic: Courses API (Cached)
    let res = http.get(`${BASE_URL}/api/v1/courses?page=1&limit=20`);
    coursesDuration.add(res.timings.duration);
    let ok = check(res, { 'status is 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else if (rand < 0.85) {
    // 15% traffic: Leaderboard API (Heavy compute & DB)
    let res = http.get(`${BASE_URL}/api/v1/leaderboard?page=1&limit=20`);
    leaderboardDuration.add(res.timings.duration);
    let ok = check(res, { 'status is 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else {
    // 15% traffic: Health Check (DB ping + S3 head)
    let res = http.get(`${BASE_URL}/api/v1/health`);
    healthDuration.add(res.timings.duration);
    let ok = check(res, { 'status is 200 or 503': (r) => r.status === 200 || r.status === 503 });
    errorRate.add(!ok);
  }

  // Realistic user pacing between 0.3s and 1.0s
  sleep(0.3 + Math.random() * 0.7);
}
