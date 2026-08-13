import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  NEED_INSIGHTS,
  PRE_RUN_STEPS,
  RUN_TYPES,
  buildDailyPlan,
  createDailySession,
  dailyIndex,
  getRunType,
  localDateKey,
  mostFrequentNeed,
  nextPreRunStep,
  previousPreRunStep,
  sanitiseDailyHistory,
  sanitiseDailySession
} from '../src/pre-run.js';
import { FLOW_CUES, FLOW_NEEDS, PACE_PRESETS } from '../src/data.js';

test('daily plans are stable for a local day and rotate on the next day', () => {
  const morning = new Date(2026, 7, 13, 6, 15);
  const evening = new Date(2026, 7, 13, 21, 45);
  const tomorrow = new Date(2026, 7, 14, 6, 15);
  const first = buildDailyPlan(morning, 'arms', FLOW_CUES.arms.length, 0);
  const later = buildDailyPlan(evening, 'arms', FLOW_CUES.arms.length, 0);
  const next = buildDailyPlan(tomorrow, 'arms', FLOW_CUES.arms.length, 0);

  assert.deepEqual(first, later);
  assert.notEqual(first.dateKey, next.dateKey);
  assert.notEqual(first.cueIndex, next.cueIndex);
  assert.notEqual(first.theme, undefined);
  assert.ok(first.rehearsal.length > 20);
  assert.equal(first.insight, NEED_INSIGHTS.arms);
});

test('local date keys follow the device day rather than UTC', () => {
  const script = [
    "import { localDateKey } from './src/pre-run.js';",
    "process.stdout.write(localDateKey(new Date('2026-08-13T15:30:00.000Z')));"
  ].join('');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, TZ: 'Australia/Sydney' },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '2026-08-14');
});

test('every pre-run need resolves to a valid daily cue and model relationship', () => {
  const date = new Date(2026, 7, 13, 9);
  for (const need of FLOW_NEEDS) {
    const cues = FLOW_CUES[need.id];
    const plan = buildDailyPlan(date, need.id, cues.length, 0);
    assert.ok(cues[plan.cueIndex]);
    assert.ok(['side', 'rear'].includes(need.view));
    assert.ok(NEED_INSIGHTS[need.id]);
  }
  for (const run of RUN_TYPES) {
    assert.equal(getRunType(run.id), run);
    assert.ok(PACE_PRESETS[run.paceIndex]);
  }
});

test('daily session resumes only valid same-day progress', () => {
  const dateKey = '2026-08-13';
  const session = sanitiseDailySession({
    version: 1,
    dateKey,
    step: 'feel',
    runType: 'easy',
    needId: 'arms',
    cueOffset: 2,
    completed: false,
    outcome: 'worse'
  }, dateKey);
  assert.equal(session.step, 'feel');
  assert.equal(session.runType, 'easy');
  assert.equal(session.needId, 'arms');
  assert.equal(session.cueOffset, 2);
  assert.equal(session.runNumber, 0);
  assert.equal(session.completed, false);
  assert.equal(session.outcome, null);

  assert.deepEqual(
    sanitiseDailySession(session, '2026-08-14'),
    createDailySession('2026-08-14')
  );
});

test('daily session rejects hostile state and impossible progress', () => {
  const dateKey = '2026-08-13';
  const malformed = sanitiseDailySession({
    version: 1,
    dateKey,
    step: 'go',
    runType: '__proto__',
    needId: 'made-up',
    cueOffset: 999999,
    completed: true,
    outcome: 'perfect'
  }, dateKey);
  assert.deepEqual(malformed, createDailySession(dateKey));

  const missingNeed = sanitiseDailySession({
    version: 1,
    dateKey,
    step: 'go',
    runType: 'steady',
    needId: null,
    cueOffset: -2,
    completed: true
  }, dateKey);
  assert.equal(missingNeed.step, 'notice');
  assert.equal(missingNeed.completed, false);
  assert.equal(missingNeed.cueOffset, 0);
});

test('the five-step state order is bounded and reversible', () => {
  assert.deepEqual(PRE_RUN_STEPS, ['run', 'notice', 'see', 'feel', 'go']);
  assert.deepEqual(
    PRE_RUN_STEPS.map(nextPreRunStep),
    ['notice', 'see', 'feel', 'go', 'go']
  );
  assert.deepEqual(
    PRE_RUN_STEPS.map(previousPreRunStep),
    ['run', 'run', 'notice', 'see', 'feel']
  );
});

test('daily offset changes the cue once without changing the date theme', () => {
  const date = new Date(2026, 7, 13, 9);
  const base = buildDailyPlan(date, 'flow', FLOW_CUES.flow.length, 0);
  const another = buildDailyPlan(date, 'flow', FLOW_CUES.flow.length, 1);
  assert.equal(another.cueIndex, (base.cueIndex + 1) % FLOW_CUES.flow.length);
  assert.equal(another.theme, base.theme);
});

test('same-day run numbers remain distinct and restart identity can be preserved', () => {
  const dateKey = '2026-08-13';
  const laterRun = sanitiseDailySession({
    ...createDailySession(dateKey),
    runNumber: 2,
    runType: 'easy',
    step: 'notice'
  }, dateKey);
  assert.equal(laterRun.runNumber, 2);

  const distantRun = sanitiseDailySession({
    ...createDailySession(dateKey),
    runNumber: 120,
    runType: 'easy',
    step: 'notice'
  }, dateKey);
  assert.equal(distantRun.runNumber, 120);

  const history = sanitiseDailyHistory([
    { dateKey, runNumber: 0, runType: 'easy', needId: 'flow', cueIndex: 0 },
    { dateKey, runNumber: 1, runType: 'easy', needId: 'flow', cueIndex: 1 }
  ]);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.runNumber), [0, 1]);
});

test('daily plans avoid recently used or worse cues when another option exists', () => {
  const date = new Date(2026, 7, 13, 9);
  const base = buildDailyPlan(date, 'arms', FLOW_CUES.arms.length, 0);
  const alternative = buildDailyPlan(
    date,
    'arms',
    FLOW_CUES.arms.length,
    0,
    [base.cueIndex]
  );
  assert.notEqual(alternative.cueIndex, base.cueIndex);
  assert.equal(alternative.dateKey, base.dateKey);

  const exhausted = buildDailyPlan(
    date,
    'arms',
    FLOW_CUES.arms.length,
    0,
    [0, 1, 2, 3]
  );
  assert.equal(exhausted.cueIndex, null);
  assert.match(exhausted.rehearsal, /landmark ahead/i);
});

test('soft recent exclusions relax to preserve a real alternate, while worse cues remain excluded', () => {
  const date = new Date(2026, 7, 13, 9);
  const exclusions = [0, 1, 2];
  exclusions.hardCount = 1;
  const plan = buildDailyPlan(date, 'arms', FLOW_CUES.arms.length, 0, exclusions);
  assert.equal(plan.candidateCount, 3);
  assert.notEqual(plan.cueIndex, 0);

  const hard = [0, 1, 2];
  hard.hardCount = 3;
  const oneLeft = buildDailyPlan(date, 'arms', FLOW_CUES.arms.length, 0, hard);
  assert.equal(oneLeft.candidateCount, 1);
  assert.equal(oneLeft.cueIndex, 3);
});

test('history is bounded, sanitised and yields only a non-scoring pattern', () => {
  const history = sanitiseDailyHistory([
    null,
    { dateKey: 'bad', runType: 'easy', needId: 'arms', cueIndex: 0 },
    { dateKey: '2026-08-11', runType: 'easy', needId: 'arms', cueIndex: 0, outcome: 'easier' },
    { dateKey: '2026-08-12', runType: 'steady', needId: 'arms', cueIndex: 1, outcome: 'same' },
    { dateKey: '2026-08-13', runType: 'recovery', needId: 'overthink', cueIndex: 2, outcome: 'worse' }
  ]);
  assert.equal(history.length, 3);
  assert.equal(mostFrequentNeed(history), null);

  const clearPattern = sanitiseDailyHistory([
    ...history,
    { dateKey: '2026-08-14', runType: 'easy', needId: 'arms', cueIndex: 3, outcome: null }
  ]);
  assert.deepEqual(
    mostFrequentNeed(clearPattern),
    { needId: 'arms', count: 3, total: 4 }
  );
  assert.equal(dailyIndex(new Date(2026, 7, 13), 0, 'anything'), 0);
  assert.equal(localDateKey(new Date(2026, 7, 13)), '2026-08-13');
});

test('history rejects impossible dates and cues and deduplicates run identity', () => {
  const history = sanitiseDailyHistory([
    { dateKey: '2026-99-99', runNumber: 0, runType: 'easy', needId: 'arms', cueIndex: 0 },
    { dateKey: '2026-08-13', runNumber: 0, runType: 'easy', needId: 'arms', cueIndex: null },
    { dateKey: '2026-08-13', runNumber: 0, runType: 'easy', needId: 'arms', cueIndex: 99 },
    { dateKey: '2026-08-13', runNumber: 0, runType: 'easy', needId: 'arms', cueIndex: 0 },
    { dateKey: '2026-08-13', runNumber: 0, runType: 'steady', needId: 'arms', cueIndex: 1 }
  ]);
  assert.equal(history.length, 1);
  assert.equal(history[0].runType, 'steady');
  assert.equal(history[0].cueIndex, 1);
});
