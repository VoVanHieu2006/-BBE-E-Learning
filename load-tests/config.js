// Shared with Node's safety tests; no dependencies or remote imports.
const env = typeof __ENV === 'undefined' ? {} : __ENV;
export function target(value = 'http://127.0.0.1:3100') {
  // Literal loopback only: no DNS allowlist, URL credentials, paths or redirects.
  if (!/^http:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(value))
    throw new Error('HTTP target must be literal localhost/127.0.0.1 with explicit port');
  if (Number(value.split(':').pop()) > 65535) throw new Error('Invalid port');
  return value;
}
export function integer(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Expected integer ${min}..${max}`);
  return n;
}
export const BASE = target(env.BASE_URL);
export const MAX = integer(env.MAX_VUS, 10, 1, 1000);
export const MODE = env.MODE || 'mixed';
export const HOLD = integer(env.HOLD_SECONDS, MAX >= 500 ? 300 : MAX <= 10 ? 120 : 180, 10, 3600);
export const RAMP = integer(env.RAMP_SECONDS, 30, 1, 600);
export const RECOVERY = integer(env.RECOVERY_SECONDS, 120, 10, 900);
export const ERROR_LIMIT = Number(env.ERROR_LIMIT || 0.01);
export const P95_LIMIT = Number(env.P95_MS || 1500);
if (!(ERROR_LIMIT > 0 && ERROR_LIMIT <= 0.1 && P95_LIMIT > 0 && Number.isFinite(P95_LIMIT)))
  throw new Error('Invalid initial SLO assumptions');
export const endpointNames = ['login','refresh','courses','member_courses','streak','stars','deadlines','learning','course','lesson','progress','heartbeat','start_quiz','submit_quiz','leaderboard','login_page'];
export function flowForVu(index) {
  const order=[0,5,13,17,1,6,14,18,7,2,8,15,9,19,3,10,16,11,4,12];
  const bucket=order[index%20];
  return bucket<5?'dashboard':bucket<13?'video':bucket<17?'quiz':'leaderboard';
}
export function quizThinkSeconds(expiresAt,now,requestTimeoutSeconds,requested) {
  if(!Number.isFinite(expiresAt))throw new Error('Missing authoritative quiz expiry');
  const available=(expiresAt-now)/1000-requestTimeoutSeconds-10;
  if(available<1)throw new Error('Not enough time left to submit safely');
  return Math.min(requested,available);
}
export function thresholds() {
  const t = {
    http_req_failed: [{ threshold: `rate<${ERROR_LIMIT}`, abortOnFail: true, delayAbortEval: '30s' }],
    business_errors: [{ threshold: 'rate==0', abortOnFail: true, delayAbortEval: '10s' }],
    timeouts: ['count==0'],
    critical_errors: [{ threshold: 'count==0', abortOnFail: true }],
    dropped_iterations: ['count==0'],
    successful_transactions: ['count>0'],
  };
  for (const name of endpointNames) t[`http_req_duration{endpoint:${name}}`] = [
    { threshold: `p(95)<${P95_LIMIT}`, abortOnFail: true, delayAbortEval: '30s' },
  ];
  for (const name of endpointNames) t[`endpoint_requests{endpoint:${name}}`] = ['count>=0'];
  return t;
}
