import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const coursesDuration = new Trend('duration_courses');
const leaderboardDuration = new Trend('duration_leaderboard');
const healthDuration = new Trend('duration_health');

export const options = {
  stages: [
    { duration: '20s', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 150 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 250 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    // We observe where thresholds start to fail
    errors: ['rate<0.15'],
    http_req_duration: ['p(95)<5000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const rand = Math.random();

  if (rand < 0.50) {
    // 50% Courses
    let res = http.get(`${BASE_URL}/api/v1/courses?page=1&limit=20`, { timeout: '10s' });
    coursesDuration.add(res.timings.duration);
    let ok = check(res, { 'courses ok': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else if (rand < 0.80) {
    // 30% Leaderboard
    let res = http.get(`${BASE_URL}/api/v1/leaderboard?page=1&limit=20`, { timeout: '10s' });
    leaderboardDuration.add(res.timings.duration);
    let ok = check(res, { 'leaderboard ok': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else {
    // 20% Health
    let res = http.get(`${BASE_URL}/api/v1/health`, { timeout: '10s' });
    healthDuration.add(res.timings.duration);
    let ok = check(res, { 'health ok': (r) => r.status === 200 || r.status === 503 });
    errorRate.add(!ok);
  }

  sleep(0.2 + Math.random() * 0.3);
}
