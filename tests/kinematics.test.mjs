import test from 'node:test';
import assert from 'node:assert/strict';

import { PACE_PRESETS, PROFILE, derivePace, getPhaseInfo } from '../src/data.js';
import {
  buildTrace,
  computeRearPose,
  computeSidePose,
  legSegmentError,
  pelvisHeightAt,
  poseIsFinite
} from '../src/kinematics.js';

test('pace metrics remain physically self-consistent', () => {
  for (const pace of PACE_PRESETS) {
    const reconstructedSpeed = pace.stepLengthM * (pace.cadence / 60);
    assert.ok(Math.abs(reconstructedSpeed - pace.speedMps) < 1e-10);
    assert.ok(pace.flightMs > 0);
    assert.ok(pace.stanceFraction > 0.25 && pace.stanceFraction < 0.38);
    assert.ok(pace.strideLengthM === pace.stepLengthM * 2);
  }
});

test('derived paces distinguish step length from full stride length', () => {
  const pace = derivePace({
    secondsPerKm: 300,
    cadence: 180,
    contactMs: 200,
    bounceCm: 6,
    speedMps: 0
  });
  assert.equal(pace.stepLengthM.toFixed(3), '1.111');
  assert.equal(pace.strideLengthM.toFixed(3), '2.222');
  assert.equal(Math.round(pace.flightMs), 133);
});

test('side pose stays finite through every pace and gait phase', () => {
  for (const pace of PACE_PRESETS) {
    for (let index = 0; index <= 100; index += 1) {
      const pose = computeSidePose(index / 100, pace, PROFILE);
      assert.equal(poseIsFinite(pose), true, `${pace.id} failed at ${index}%`);
    }
  }
});

test('stance leg preserves segment lengths and keeps its foot on the ground', () => {
  for (const pace of PACE_PRESETS) {
    for (const phase of [0.01, pace.stanceFraction * 0.25, pace.stanceFraction * 0.55]) {
      const pose = computeSidePose(phase, pace, PROFILE);
      assert.equal(pose.lead.isStance, true);
      const error = legSegmentError(pose.lead, PROFILE);
      assert.ok(error.thigh < 0.02, `thigh error ${error.thigh}`);
      assert.ok(error.shank < 0.02, `shank error ${error.shank}`);
      assert.ok(Math.min(pose.lead.foot.heel.y, pose.lead.foot.toe.y) < 0.001);
    }
  }
});

test('opposite legs are offset by half a gait cycle', () => {
  const pace = PACE_PRESETS[1];
  const first = computeSidePose(0.13, pace, PROFILE);
  const second = computeSidePose(0.63, pace, PROFILE);
  const firstThigh = {
    x: first.lead.knee.x - first.lead.hip.x,
    y: first.lead.knee.y - first.lead.hip.y
  };
  const secondThigh = {
    x: second.far.knee.x - second.far.hip.x,
    y: second.far.knee.y - second.far.hip.y
  };
  assert.ok(Math.abs(firstThigh.x - secondThigh.x) < 0.01);
  assert.ok(Math.abs(firstThigh.y - secondThigh.y) < 0.01);
});

test('gait cycle closes without a visible coordinate jump', () => {
  const pace = PACE_PRESETS[2];
  const start = computeSidePose(0, pace, PROFILE);
  const end = computeSidePose(1, pace, PROFILE);
  for (const key of ['pelvis', 'head']) {
    assert.ok(Math.abs(start[key].x - end[key].x) < 0.001);
    assert.ok(Math.abs(start[key].y - end[key].y) < 0.001);
  }
  assert.ok(Math.abs(start.lead.ankle.x - end.lead.ankle.x) < 0.001);
  assert.ok(Math.abs(start.lead.ankle.y - end.lead.ankle.y) < 0.001);
});

test('rear view keeps reference contacts uncrossed and exposes crossover variant', () => {
  const pace = PACE_PRESETS[1];
  const phase = pace.stanceFraction * 0.55;
  const reference = computeRearPose(phase, pace, PROFILE);
  const crossover = computeRearPose(phase, pace, PROFILE, { variant: 'crossover' });
  assert.ok(reference.lead.ankle.x > 0);
  assert.ok(crossover.lead.ankle.x < 0);
  assert.ok(crossover.pelvisTiltDeg > reference.pelvisTiltDeg);
});

test('over-reach contrast moves the ankle materially farther ahead at contact', () => {
  const pace = PACE_PRESETS[1];
  const reference = computeSidePose(0.012, pace, PROFILE);
  const overreach = computeSidePose(0.012, pace, PROFILE, { variant: 'overreach' });
  const referenceOffset = reference.lead.ankle.x - reference.lead.hip.x;
  const overreachOffset = overreach.lead.ankle.x - overreach.lead.hip.x;

  assert.ok(overreachOffset - referenceOffset > 15);
  assert.ok(overreach.lead.angles.kneeFlexion < reference.lead.angles.kneeFlexion);
});

test('centre-of-mass trace spans the configured vertical excursion', () => {
  for (const pace of PACE_PRESETS) {
    const trace = buildTrace(pace, 240);
    const range = Math.max(...trace.map((item) => item.comY)) - Math.min(...trace.map((item) => item.comY));
    assert.ok(Math.abs(range - pace.bounceCm) < 0.25, `${pace.id}: ${range}`);
  }
});

test('phase labels follow pace-specific stance timing', () => {
  const pace = PACE_PRESETS[1];
  assert.equal(getPhaseInfo(0.01, pace).id, 'contact');
  assert.equal(getPhaseInfo(pace.stanceFraction * 0.2, pace).id, 'load');
  assert.equal(getPhaseInfo(pace.stanceFraction * 0.6, pace).id, 'midstance');
  assert.equal(getPhaseInfo(pace.stanceFraction, pace).id, 'toeoff');
  assert.equal(getPhaseInfo(0.53, pace).id, 'recovery');
  assert.equal(getPhaseInfo(0.84, pace).id, 'lateswing');
  assert.equal(getPhaseInfo(0.99, pace).id, 'lateswing');
});

test('displayed phase ranges adapt to the selected pace', () => {
  const recovery = PACE_PRESETS[0];
  const fast = PACE_PRESETS.at(-1);
  const recoveryToeoff = getPhaseInfo(recovery.stanceFraction, recovery).range;
  const fastToeoff = getPhaseInfo(fast.stanceFraction, fast).range;

  assert.notEqual(recoveryToeoff, fastToeoff);
  assert.match(recoveryToeoff, /% of lead-leg stride$/);
});

test('pelvis oscillation has two bounded waves per stride', () => {
  const pace = PACE_PRESETS[1];
  const samples = Array.from({ length: 200 }, (_, index) => pelvisHeightAt(index / 200, pace));
  const range = Math.max(...samples) - Math.min(...samples);
  assert.ok(Math.abs(range - pace.bounceCm) < 0.1);
});
