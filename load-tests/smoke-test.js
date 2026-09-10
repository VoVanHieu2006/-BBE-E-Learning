import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const coursesDuration = new Trend('duration_courses');
const leaderboardDuration = new Trend('duration_leaderboard');
const healthDuration = new Trend('duration_health');
const homeDuration = new Trend('duration_home');

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'], // <5% failed requests
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2000ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // 1. Home / Login Page
  let resHome = http.get(`${BASE_URL}/login`);
  homeDuration.add(resHome.timings.duration);
  let homeOk = check(resHome, {
    'home status is 200': (r) => r.status === 200,
  });
  errorRate.add(!homeOk);

  sleep(0.5);

  // 2. Health Check API (DB + S3 test)
  let resHealth = http.get(`${BASE_URL}/api/v1/health`);
  healthDuration.add(resHealth.timings.duration);
  let healthOk = check(resHealth, {
    'health status is 200 or 503': (r) => r.status === 200 || r.status === 503,
  });
  errorRate.add(!healthOk);

  sleep(0.5);

  // 3. Courses API (Cached API test)
  let resCourses = http.get(`${BASE_URL}/api/v1/courses?page=1&limit=10`);
  coursesDuration.add(resCourses.timings.duration);
  let coursesOk = check(resCourses, {
    'courses status is 200': (r) => r.status === 200,
    'courses has items': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items);
      } catch (e) {
        return false;
      }
    },
  });
  errorRate.add(!coursesOk);

  sleep(0.5);

  // 4. Leaderboard API (Heavy DB aggregation test)
  let resLeaderboard = http.get(`${BASE_URL}/api/v1/leaderboard?limit=10`);
  leaderboardDuration.add(resLeaderboard.timings.duration);
  let leaderboardOk = check(resLeaderboard, {
    'leaderboard status is 200': (r) => r.status === 200,
  });
  errorRate.add(!leaderboardOk);

  sleep(1);
}
