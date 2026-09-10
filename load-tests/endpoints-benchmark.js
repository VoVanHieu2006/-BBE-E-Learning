import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TARGET = __ENV.TARGET || 'courses';

export const options = {
  vus: parseInt(__ENV.VUS || '20', 10),
  duration: __ENV.DURATION || '15s',
};

export default function () {
  let url = `${BASE_URL}/api/v1/courses`;
  if (TARGET === 'login') {
    url = `${BASE_URL}/login`;
  } else if (TARGET === 'health') {
    url = `${BASE_URL}/api/v1/health`;
  } else if (TARGET === 'leaderboard') {
    url = `${BASE_URL}/api/v1/leaderboard`;
  } else if (TARGET === 'courses') {
    url = `${BASE_URL}/api/v1/courses`;
  }

  let res = http.get(url, { timeout: '10s' });
  check(res, {
    'status is 200 or acceptable': (r) => r.status === 200 || (TARGET === 'health' && r.status === 503),
  });

  sleep(0.1);
}
