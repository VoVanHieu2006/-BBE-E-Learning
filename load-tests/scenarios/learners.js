import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Rate, Counter,Trend } from 'k6/metrics';
import { BASE, MAX, MODE, HOLD, RAMP, RECOVERY, thresholds,flowForVu,quizThinkSeconds } from '../config.js';
const requestTimeout=Number(__ENV.REQUEST_TIMEOUT_SECONDS||10);
if(!Number.isInteger(requestTimeout)||requestTimeout<1||requestTimeout>30)throw new Error('Invalid request timeout');

const allowed = ['mixed','dashboard','video','quiz','leaderboard','diagnostic-read','spike-login','spike-course','spike-heartbeat','spike-submit','spike-completion','static-smoke'];
if (!allowed.includes(MODE)) throw new Error('Unsupported MODE');
if (__ENV.SAFETY_PREFLIGHT !== 'verified') throw new Error('Run through run.mjs after environment verification');
const staticOnly = MODE === 'static-smoke';
const fixtureName=__ENV.FIXTURE_FILE || 'users.private.json';
if(!/^[a-zA-Z0-9_-]+\.private\.json$/.test(fixtureName))throw new Error('Invalid fixture path');
const users = new SharedArray('synthetic learners', () => {
  if(staticOnly)return [];
  const rows=JSON.parse(open('../fixtures/'+fixtureName)).users;
  if(!Array.isArray(rows) || new Set(rows.map(u=>u.id)).size!==rows.length || rows.some(u=>!u.email.endsWith('@loadtest.invalid')))
    throw new Error('Need unique synthetic users, no real accounts');
  return rows;
});
if(!staticOnly && users.length<MAX)throw new Error('Not enough unique test users');
const userOffset=Number(__ENV.USER_OFFSET||0);
if(!Number.isInteger(userOffset)||userOffset<0||(!staticOnly&&users.length<MAX+userOffset))throw new Error('Invalid user offset');

const business = new Rate('business_errors');
const critical = new Counter('critical_errors');
const timeouts = new Counter('timeouts');
const authErrors = new Counter('auth_errors');
const rateLimited = new Counter('rate_limited');
const transactions = new Counter('successful_transactions');
const missedBarrier = new Counter('missed_barrier');
const heartbeatAcks = new Counter('heartbeat_acks');
const completionAcks = new Counter('completion_acks');
const submitAcks = new Counter('submit_acks');
const endpointRequests = new Counter('endpoint_requests');
const videoStarsAck = new Counter('video_stars_acknowledged');
const quizThinkPlanned = new Trend('quiz_think_seconds_planned');
const businessErrorCodes = new Counter('business_error_codes');
const spike = MODE.startsWith('spike-');
const scenario = staticOnly && __ENV.HARNESS_ONLY === 'yes'
  ? { executor:'shared-iterations', vus:1, iterations:1, maxDuration:'15s' }
  : MODE === 'spike-login'
  ? { executor: 'constant-arrival-rate', rate: Number(__ENV.LOGIN_RATE || 10), timeUnit: '1s', duration: `${Math.ceil(MAX / Number(__ENV.LOGIN_RATE || 10))}s`, preAllocatedVUs: Math.min(MAX, 25), maxVUs: MAX }
  : spike ? { executor: 'per-vu-iterations', vus: MAX, iterations: 1, maxDuration: `${HOLD + 240}s` }
  : { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: `${RAMP}s`, target: MAX }, { duration: `${HOLD}s`, target: MAX },
      { duration: `${RAMP}s`, target: 1 }, { duration: `${RECOVERY}s`, target: 1 },
      { duration: '5s', target: 0 },
    ], gracefulRampDown: '30s', gracefulStop: '30s' };
export const options = {
  scenarios: { learners: { ...scenario, exec: 'learner' } },
  thresholds: { ...thresholds(), missed_barrier: ['count==0'] },
  summaryTrendStats: ['avg','min','med','max','p(90)','p(95)','p(99)'],
  systemTags: ['status','method','name','scenario','error_code','expected_response'],
  // Never log auth headers, tokens, cookies, or response bodies.
};
let token, refreshToken, tokenAt = 0, video, quiz, quizDone = false;
function body(r) { try { return r.json(); } catch { return {}; } }
function request(method, path, payload, endpoint) {
  const r = http.request(method, BASE + path, payload === undefined ? null : JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirects: 0, timeout: `${requestTimeout}s`, tags: { name: endpoint, endpoint,phase:!spike && Date.now()-exec.scenario.startTime >= (2*RAMP+HOLD)*1000?'recovery':'load' }, responseType: 'text',
  });
  const b = body(r);
  endpointRequests.add(1,{endpoint});
  const ok = check(r, { 'HTTP success and no business error': x => x.status >= 200 && x.status < 300 && !b.error }, { endpoint });
  business.add(!ok, { endpoint });
  timeouts.add(r.error_code === 1050 ? 1 : 0);
  authErrors.add([401,403].includes(r.status) ? 1 : 0);
  rateLimited.add(r.status === 429 ? 1 : 0);
  critical.add(r.status >= 500 ? 1 : 0);
  if (!ok) {
    const code=typeof b.error?.code==='string'&&/^[A-Za-z0-9_]+$/.test(b.error.code)?b.error.code:'HTTP_OR_TRANSPORT';
    businessErrorCodes.add(1,{endpoint,code});fail(`Failed ${endpoint}: status ${r.status}, code ${code}`);
  }
  return b;
}
function login(u) {
  const b = request('POST','/api/v1/auth/login',{ email:u.email,password:u.password },'login');
  if (!b.accessToken || b.user?.id !== u.id) { business.add(true); fail('Invalid login identity'); }
  token = b.accessToken; refreshToken = b.refreshToken; tokenAt = Date.now();
}
function ensureAuth(u) {
  if (!token) login(u);
  else if (Date.now() - tokenAt > 12 * 60 * 1000) {
    const b = request('POST','/api/v1/auth/refresh',{refreshToken},'refresh');
    if (!b.accessToken) { business.add(true); fail('Refresh missing token'); }
    token = b.accessToken; tokenAt = Date.now();
  }
}
function dashboardReads(u) {
  for (const [path,name] of [['/members/me/courses','member_courses'],['/streak','streak'],['/stars/me','stars'],['/courses','courses'],['/members/me/deadlines','deadlines']])
    request('GET','/api/v1'+path,undefined,name);
  request('GET',`/api/v1/courses/${u.courseId}`,undefined,'course');
}
function dashboard(u) {
  dashboardReads(u);
  sleep(30 + Math.random()*30); // Cache-aware revisit, not unlimited requests.
}
function heartbeat(u, event = 'HEARTBEAT', completing = false) {
  const lessonId = completing ? u.completionLessonId : u.lessonId;
  const duration = completing ? u.completionDuration : u.duration;
  if (!video || video.lessonId !== lessonId) {
    request('GET',`/api/v1/lessons/${lessonId}`,undefined,'lesson');
    const p = request('GET',`/api/v1/lessons/${lessonId}/progress`,undefined,'progress');
    video = { lessonId, position: p.replay?.watchedSeconds || 0, at: Date.now(), nextAt:Date.now()+(duration<30?3000:10000), session:`k6_${__VU}_${Date.now()}` };
    const initial=request('PATCH',`/api/v1/lessons/${lessonId}/progress`,{positionSeconds:video.position,furthestWatchedPositionSeconds:video.position,playbackRate:1,event:'PLAY',playerDurationSeconds:duration,viewSessionId:video.session},'heartbeat');
    heartbeatAcks.add(1);videoStarsAck.add(initial.starReward?.amount||0);
    while(video.nextAt<=Date.now())video.nextAt+=(duration<30?3000:10000);
    return initial;
  }
  const now = Date.now();
  video.position = Math.min(duration, video.position+(now-video.at)/1000); video.at = now;
  if(event==='ENDED' && completing)video.position=duration; // ENDED allowance still enforced by server wall-clock validation.
  const b = request('PATCH',`/api/v1/lessons/${lessonId}/progress`,{
    positionSeconds:video.position,furthestWatchedPositionSeconds:video.position,playbackRate:1,
    event:video.position >= duration ? 'ENDED' : event, playerDurationSeconds:duration,viewSessionId:video.session,
  },'heartbeat');
  heartbeatAcks.add(1);
  videoStarsAck.add(b.starReward?.amount || 0);
  if (b.videoCompleted) completionAcks.add(1);
  if (event==='ENDED' && completing && !b.videoCompleted) { business.add(true); fail('Completion not acknowledged'); }
  while(video.nextAt<=Date.now())video.nextAt+=(duration<30?3000:10000);
  return b;
}
function startQuiz(u) {
  if (!quiz) {
    const b = request('POST',`/api/v1/assessments/${u.assessmentId}/attempts`,{forceNew:false},'start_quiz');
    quiz = { id:b.attemptId || b.id, questions:b.questions || [], answers:{},expiresAt:Date.parse(b.expiresAt) };
    if (!quiz.id || !quiz.questions.length) { business.add(true); fail('Empty quiz'); }
    for (const q of quiz.questions) {
      if (!u.correctAnswers[q.id]) { business.add(true); fail('Fixture bank mismatch'); }
      quiz.answers[q.id] = u.correctAnswers[q.id];
    }
  }
}
function submitQuiz() {
  const b = request('POST',`/api/v1/attempts/${quiz.id}/submit`,{answers:quiz.answers},'submit_quiz');
  if (!b.passed || b.scorePercent !== 100) { business.add(true); fail('Grading mismatch'); }
  submitAcks.add(1);
  // Deliberate duplicate submission validates public idempotency contract.
  const again = request('POST',`/api/v1/attempts/${quiz.id}/submit`,{answers:quiz.answers},'submit_quiz');
  if (again.starReward?.amount !== 0 || again.scorePercent !== b.scorePercent) { business.add(true); exec.test.abort('Duplicate reward/grading mismatch'); }
  quizDone = true;
}
export function setup() {
  business.add(false); critical.add(0); timeouts.add(0); missedBarrier.add(0);
  return { barrier: Date.now() + Number(__ENV.BARRIER_SECONDS || 120)*1000 };
}
export function learner(data) {
  if (staticOnly) { request('GET','/login',undefined,'login_page'); transactions.add(1); sleep(2); return; }
  const index = MODE === 'spike-login' ? exec.scenario.iterationInTest : __VU - 1;
  if (index >= MAX) { sleep(1); return; }
  const u = users[index+userOffset];
  if (MODE === 'spike-login') { login(u); transactions.add(1); return; }
  ensureAuth(u);
  if(MODE==='diagnostic-read' && Date.now()-exec.scenario.startTime < (2*RAMP+HOLD)*1000) {
    dashboardReads(u);
    request('GET','/api/v1/learning/me',undefined,'learning');
    request('GET',`/api/v1/lessons/${u.lessonId}/progress`,undefined,'progress');
    request('GET',u.chapterId?`/api/v1/leaderboard/chapters/${u.chapterId}`:'/api/v1/leaderboard',undefined,'leaderboard');
    transactions.add(1,{flow:'diagnostic_read'});sleep(30);return;
  }
  if(!spike && Date.now()-exec.scenario.startTime >= (2*RAMP+HOLD)*1000) {
    request('GET','/api/v1/learning/me',undefined,'learning');
    request('GET','/api/v1/stars/me',undefined,'stars');
    heartbeat(u);transactions.add(1,{flow:'recovery'});sleep(10);return;
  }
  if (spike) {
    if (MODE === 'spike-submit') startQuiz(u);
    if (MODE === 'spike-completion') {
      const lead=(data.barrier-Date.now())/1000-u.completionDuration;
      if(lead<0) {missedBarrier.add(1);fail('Missed video preparation barrier');}
      sleep(lead);heartbeat(u,'PLAY',true);
      while((data.barrier-Date.now())/1000>3) {sleep(3);heartbeat(u,'HEARTBEAT',true);}
    }
    if (MODE === 'spike-heartbeat') {
      const lead=(data.barrier-Date.now())/1000-10;
      if(lead<0) {missedBarrier.add(1);fail('Missed heartbeat preparation barrier');}
      sleep(lead);heartbeat(u,'PLAY');
    }
    const wait = (data.barrier - Date.now())/1000;
    if(MODE==='spike-submit' && quiz.expiresAt-data.barrier<(requestTimeout+10)*1000){missedBarrier.add(1);fail('Quiz expires before safe spike submit');}
    if (wait < 0) { missedBarrier.add(1); fail('Warmup missed spike barrier'); }
    sleep(wait);
    if (MODE === 'spike-course') request('GET',`/api/v1/courses/${u.courseId}`,undefined,'course');
    else if (MODE === 'spike-submit') submitQuiz();
    else {
      const result=heartbeat(u,MODE === 'spike-completion' ? 'ENDED' : 'HEARTBEAT',MODE === 'spike-completion');
      if(MODE==='spike-completion') {
        if(result.starReward?.amount!==1) {business.add(true);fail('Expected one star for fresh 20-second video');}
        const repeated=heartbeat(u,'ENDED',true);
        if(repeated.starReward?.amount!==0) {business.add(true);exec.test.abort('Duplicate video reward');}
      }
    }
    transactions.add(1); return;
  }
  const flow = MODE === 'mixed' ? flowForVu(index) : MODE;
  if (flow === 'dashboard') dashboard(u);
  else if (flow === 'video') { heartbeat(u); sleep(Math.max(0.05,(video.nextAt-Date.now())/1000)); }
  else if (flow === 'quiz') {
    if (!quizDone) { startQuiz(u); const think=quizThinkSeconds(quiz.expiresAt,Date.now(),requestTimeout,120+Math.random()*60);quizThinkPlanned.add(think);sleep(think);submitQuiz(); }
    else { request('GET','/api/v1/stars/me',undefined,'stars'); sleep(60); }
  } else { request('GET',u.chapterId?`/api/v1/leaderboard/chapters/${u.chapterId}`:'/api/v1/leaderboard',undefined,'leaderboard'); sleep(30+Math.random()*30); }
  transactions.add(1, { flow });
}
export function handleSummary(data) {
  const path = __ENV.RUN_DIR;
  if (!path || !/^results\/[a-zA-Z0-9_-]+$/.test(path)) throw new Error('Invalid output directory');
  return { [path+'/summary.json']: JSON.stringify(data,null,2), stdout: JSON.stringify({mode:MODE,maxConfigured:MAX,metrics:data.metrics},null,2)+'\n' };
}
