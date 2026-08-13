import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TUNING,
  FLOW_CUES,
  FLOW_NEEDS,
  PACE_PRESETS,
  PROFILE,
  TUNE_CONTROLS,
  derivePace,
  flowPhase,
  midstancePhase,
  getPhaseInfo,
  phaseLandmarks,
  sanitiseCueIndexes,
  sanitiseSavedCue,
  sanitiseTuning,
  tuneRangeFor,
  tunePace
} from '../src/data.js';
import {
  armSegmentError,
  buildTrace,
  computeRearPose,
  computeSidePose,
  forceAt,
  legSegmentError,
  pelvisHeightAt,
  poseIsFinite
} from '../src/kinematics.js';
import { groundPatternAt } from '../src/renderer.js';

const pointDistance = (first, second) =>
  Math.hypot(first.x - second.x, first.y - second.y);

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

test('support-foot travel matches speed multiplied by contact time', () => {
  for (const pace of PACE_PRESETS) {
    const contact = computeSidePose(0, pace, PROFILE).lead;
    const toeOff = computeSidePose(pace.stanceFraction, pace, PROFILE).lead;
    const expectedTravelCm = pace.speedMps * (pace.contactMs / 1000) * 100;
    assert.ok(
      Math.abs(contact.ankle.x - toeOff.ankle.x - expectedTravelCm) < 0.5,
      pace.id
    );
  }
});

test('every exposed landing and rhythm combination keeps the support foot locked', () => {
  for (const pace of PACE_PRESETS) {
    const rhythm = TUNE_CONTROLS.find((control) => control.id === 'rhythm');
    const landing = TUNE_CONTROLS.find((control) => control.id === 'landing');
    const rhythmRange = tuneRangeFor(rhythm, pace);
    const landingRange = tuneRangeFor(landing, pace);
    for (const rhythmValue of [rhythmRange.minimum, rhythmRange.maximum]) {
      for (const landingValue of [landingRange.minimum, landingRange.maximum]) {
        const tuned = tunePace(pace, {
          ...DEFAULT_TUNING,
          rhythm: rhythmValue,
          landing: landingValue
        });
        const contact = computeSidePose(0, tuned, PROFILE).lead.ankle.x;
        const toeOff = computeSidePose(tuned.stanceFraction, tuned, PROFILE).lead.ankle.x;
        const expected = tuned.speedMps * (tuned.contactMs / 1000) * 100;
        assert.ok(Math.abs(contact - toeOff - expected) < 0.5, pace.id);

        for (let index = 0; index <= 100; index += 1) {
          const progress = index / 100;
          const phase = tuned.stanceFraction * progress;
          const ankle = computeSidePose(phase, tuned, PROFILE).lead.ankle.x;
          const linearReference = contact + (toeOff - contact) * progress;
          assert.ok(Math.abs(ankle - linearReference) < 0.8, pace.id);
        }
      }
    }
  }
});

test('ground texture advances by the same physical distance as the support foot', () => {
  for (const pace of PACE_PRESETS) {
    for (const scale of [1.8, 2.3, 3.1]) {
      const pattern = groundPatternAt(pace.stanceFraction, pace, scale);
      const contactTravelPixels =
        pace.speedMps * (pace.contactMs / 1000) * 100 * scale;
      assert.ok(Math.abs(pattern.stridePixels * pace.stanceFraction - contactTravelPixels) < 1e-9);
      assert.ok(Math.abs(pattern.spacing * pattern.repeatsPerStride - pattern.stridePixels) < 1e-9);
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
  assert.ok(Math.abs(overreach.force.horizontalBw) > Math.abs(reference.force.horizontalBw) * 1.5);
});

test('centre-of-mass trace is mass-responsive and remains near the authored excursion', () => {
  for (const pace of PACE_PRESETS) {
    const trace = buildTrace(pace, 240);
    const range = Math.max(...trace.map((item) => item.comY)) - Math.min(...trace.map((item) => item.comY));
    assert.ok(range >= pace.bounceCm && range < pace.bounceCm + 1, `${pace.id}: ${range}`);
    const offsets = Array.from({ length: 80 }, (_, index) => {
      const pose = computeSidePose(index / 80, pace, PROFILE);
      return pose.com.y - pose.pelvis.y;
    });
    assert.ok(Math.max(...offsets) - Math.min(...offsets) > 0.2);
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

test('every leg and foot point moves continuously across toe-off, contact and wrap', () => {
  for (const pace of PACE_PRESETS) {
    for (const compute of [computeSidePose, computeRearPose]) {
      let previous = compute(0, pace, PROFILE);
      for (let index = 1; index <= 2000; index += 1) {
        const pose = compute((index % 2000) / 2000, pace, PROFILE);
        for (const side of ['lead', 'far']) {
          for (const point of ['knee', 'ankle']) {
            assert.ok(
              pointDistance(previous[side][point], pose[side][point]) < 0.65,
              `${pace.id} ${compute.name} ${side}.${point} jumped at ${index / 2000}`
            );
          }
          if (compute === computeSidePose) {
            for (const point of ['heel', 'toe']) {
              assert.ok(
                pointDistance(previous[side].foot[point], pose[side].foot[point]) < 0.65,
                `${pace.id} ${side}.${point} jumped at ${index / 2000}`
              );
            }
          }
        }
        previous = pose;
      }
    }
  }
});

test('leg velocity stays continuous through contact and toe-off', () => {
  const sampleWidth = 0.00001;
  const wrap = (value) => ((value % 1) + 1) % 1;
  for (const pace of PACE_PRESETS) {
    const boundaries = [
      0,
      pace.stanceFraction,
      0.5,
      wrap(pace.stanceFraction + 0.5)
    ];
    for (const compute of [computeSidePose, computeRearPose]) {
      for (const boundary of boundaries) {
        const before = compute(wrap(boundary - sampleWidth), pace, PROFILE);
        const at = compute(wrap(boundary), pace, PROFILE);
        const after = compute(wrap(boundary + sampleWidth), pace, PROFILE);
        for (const side of ['lead', 'far']) {
          for (const path of [['knee'], ['ankle'], ['foot', 'heel'], ['foot', 'toe']]) {
            const read = (pose) => path.reduce((value, key) => value[key], pose[side]);
            const first = read(before);
            const middle = read(at);
            const last = read(after);
            const velocityChange = Math.hypot(
              (last.x - 2 * middle.x + first.x) / sampleWidth,
              (last.y - 2 * middle.y + first.y) / sampleWidth
            );
            assert.ok(
              velocityChange < 1,
              `${pace.id} ${compute.name} ${side}.${path.join('.')} jerked at ${boundary}`
            );
          }
        }
      }
    }
  }
});

test('the rendered foot is rigid and the reported ankle angle comes from that geometry', () => {
  let heelAttachment = null;
  let toeAttachment = null;
  const normalise = (value) => ((value + 180) % 360 + 360) % 360 - 180;
  for (const pace of PACE_PRESETS) {
    for (let index = 0; index < 400; index += 1) {
      const pose = computeSidePose(index / 400, pace, PROFILE);
      for (const leg of [pose.lead, pose.far]) {
        assert.ok(Math.abs(pointDistance(leg.foot.heel, leg.foot.toe) - PROFILE.footCm) < 1e-9);
        heelAttachment ??= pointDistance(leg.ankle, leg.foot.heel);
        toeAttachment ??= pointDistance(leg.ankle, leg.foot.toe);
        assert.ok(Math.abs(pointDistance(leg.ankle, leg.foot.heel) - heelAttachment) < 1e-9);
        assert.ok(Math.abs(pointDistance(leg.ankle, leg.foot.toe) - toeAttachment) < 1e-9);
        const shankPitch = Math.atan2(
          leg.ankle.y - leg.knee.y,
          leg.ankle.x - leg.knee.x
        ) * 180 / Math.PI;
        const derived = normalise(leg.foot.pitchDeg - (shankPitch + 90));
        assert.ok(Math.abs(derived - leg.angles.ankleDorsiflexion) < 1e-9);
        assert.ok(leg.angles.ankleDorsiflexion > -35 && leg.angles.ankleDorsiflexion < 35);
        if (!leg.isStance) {
          assert.ok(Math.min(leg.foot.heel.y, leg.foot.toe.y) >= -0.001);
        }
      }
    }
  }
});

test('the swing foot keeps useful late-recovery clearance', () => {
  for (const pace of PACE_PRESETS) {
    const phase = pace.stanceFraction + (1 - pace.stanceFraction) * 0.67;
    const leg = computeSidePose(phase, pace, PROFILE).lead;
    assert.equal(leg.isStance, false);
    assert.ok(Math.min(leg.foot.heel.y, leg.foot.toe.y) > 1, pace.id);
  }
});

test('knees remain flexed across every exposed rhythm and landing stop', () => {
  for (const pace of PACE_PRESETS) {
    const rhythm = TUNE_CONTROLS.find((control) => control.id === 'rhythm');
    const landing = TUNE_CONTROLS.find((control) => control.id === 'landing');
    const rhythmRange = tuneRangeFor(rhythm, pace);
    const landingRange = tuneRangeFor(landing, pace);
    for (
      let rhythmValue = rhythmRange.minimum;
      rhythmValue <= rhythmRange.maximum;
      rhythmValue += rhythm.step
    ) {
      for (
        let landingValue = landingRange.minimum;
        landingValue <= landingRange.maximum + 1e-9;
        landingValue += landing.step
      ) {
        const model = tunePace(pace, {
          ...DEFAULT_TUNING,
          rhythm: rhythmValue,
          landing: landingValue
        });
        const phases = new Set(
          Array.from({ length: 81 }, (_, index) => index / 80)
            .concat(
              Array.from({ length: 30 }, (_, index) =>
                (model.stanceFraction + index * 0.001) % 1
              ),
              Array.from({ length: 30 }, (_, index) =>
                (1 - index * 0.001 + 1) % 1
              ),
              Array.from({ length: 30 }, (_, index) =>
                (0.5 + model.stanceFraction + index * 0.001) % 1
              ),
              Array.from({ length: 30 }, (_, index) =>
                (0.5 - index * 0.001 + 1) % 1
              )
            )
        );
        for (const phase of phases) {
          const pose = computeSidePose(phase, model, PROFILE);
          assert.ok(pose.lead.angles.kneeFlexion >= 3 - 1e-8, pace.id);
          assert.ok(pose.far.angles.kneeFlexion >= 3 - 1e-8, pace.id);
        }
      }
    }
  }
});

test('force origin stays on the ground within the projected shoe', () => {
  for (const pace of PACE_PRESETS) {
    let previous = null;
    for (let index = 0; index <= 1000; index += 1) {
      const phase = pace.stanceFraction * index / 1000;
      const pose = computeSidePose(phase, pace, PROFILE);
      const { heel, toe } = pose.lead.foot;
      const point = pose.contactPoint;
      assert.ok(Math.abs(point.y) < 1e-12, pace.id);
      assert.ok(point.x >= Math.min(heel.x, toe.x) - 1e-9);
      assert.ok(point.x <= Math.max(heel.x, toe.x) + 1e-9);
      if (previous) assert.ok(pointDistance(previous, point) < 0.16, pace.id);
      previous = point;
    }
  }
});

test('mid-stance is authored where the body passes over the support region', () => {
  for (const pace of PACE_PRESETS) {
    const phase = midstancePhase(pace);
    const pose = computeSidePose(phase, pace, PROFILE);
    assert.ok(Math.abs(pose.lead.ankle.x - pose.lead.hip.x) < 0.01);
    const bounds = [pose.lead.foot.heel.x, pose.lead.foot.toe.x].sort((a, b) => a - b);
    assert.ok(pose.com.x >= bounds[0] && pose.com.x <= bounds[1]);
    const landmark = phaseLandmarks(pace).find((item) => item.id === 'midstance');
    assert.ok(Math.abs(landmark.phase - phase) < 1e-10);
  }
});

test('ground forces support body weight over a stride and balance braking with propulsion', () => {
  const samples = 12000;
  for (const pace of PACE_PRESETS) {
    let vertical = 0;
    let horizontal = 0;
    for (let index = 0; index < samples; index += 1) {
      const stanceProgress = (index + 0.5) / samples;
      const force = forceAt({ isStance: true, stanceProgress }, pace);
      vertical += force.verticalBw / samples;
      horizontal += force.horizontalBw / samples;
    }
    const strideVerticalImpulse = vertical * pace.stanceFraction * 2;
    const strideHorizontalImpulse = horizontal * pace.stanceFraction * 2;
    assert.ok(Math.abs(strideVerticalImpulse - 1) < 0.002, pace.id);
    assert.ok(Math.abs(strideHorizontalImpulse) < 0.001, pace.id);
  }
});

test('arms remain exactly reciprocal through every pace and phase', () => {
  for (const pace of PACE_PRESETS) {
    for (let index = 0; index <= 1000; index += 1) {
      const pose = computeSidePose(index / 1000, pace, PROFILE);
      assert.ok(
        Math.abs(pose.leadArm.shoulderAngle + pose.farArm.shoulderAngle) < 1e-9,
        `${pace.id} lost reciprocity at ${index / 10}%`
      );
    }
  }
});

test('arm wrists move continuously through neutral, phase boundaries and cycle wrap', () => {
  for (const pace of PACE_PRESETS) {
    let previous = computeSidePose(0, pace, PROFILE);
    for (let index = 1; index <= 1000; index += 1) {
      const pose = computeSidePose(index / 1000, pace, PROFILE);
      for (const key of ['leadArm', 'farArm']) {
        assert.ok(
          pointDistance(previous[key].wrist, pose[key].wrist) < 0.5,
          `${pace.id} ${key} jumped at ${index / 1000}`
        );
      }
      previous = pose;
    }
  }
});

test('side arms preserve segment lengths and a compact continuous elbow bend', () => {
  for (const pace of PACE_PRESETS) {
    for (let index = 0; index <= 200; index += 1) {
      const pose = computeSidePose(index / 200, pace, PROFILE);
      for (const arm of [pose.leadArm, pose.farArm]) {
        const error = armSegmentError(arm, PROFILE);
        assert.ok(error.upperArm < 1e-9);
        assert.ok(error.forearm < 1e-9);
        assert.ok(arm.elbowFlexion >= 88 && arm.elbowFlexion <= 97);
      }
    }
  }
});

test('arm wrist velocity stays smooth through neutral swing', () => {
  const sampleWidth = 0.000001;
  for (const pace of PACE_PRESETS) {
    for (const phase of [0.25, 0.75]) {
      const before = computeSidePose(phase - sampleWidth, pace, PROFILE);
      const at = computeSidePose(phase, pace, PROFILE);
      const after = computeSidePose(phase + sampleWidth, pace, PROFILE);
      for (const key of ['leadArm', 'farArm']) {
        const velocityChange = Math.hypot(
          (after[key].wrist.x - 2 * at[key].wrist.x + before[key].wrist.x) /
            sampleWidth,
          (after[key].wrist.y - 2 * at[key].wrist.y + before[key].wrist.y) /
            sampleWidth
        );
        assert.ok(velocityChange < 0.01, `${pace.id} ${key}`);
      }
    }
  }
});

test('rear-view arms stay bounded while allowing slight front crossover', () => {
  for (const pace of PACE_PRESETS) {
    for (let index = 0; index <= 200; index += 1) {
      const pose = computeRearPose(index / 200, pace, PROFILE);
      for (const [arm, sign] of [[pose.leadArm, 1], [pose.farArm, -1]]) {
        assert.ok(sign * arm.elbow.x > 0);
        assert.ok(sign * arm.wrist.x >= -PROFILE.hipWidthCm * 0.2 - 1e-9);
        assert.ok(Math.abs(arm.elbow.x) <= Math.abs(arm.shoulder.x) + 1e-9);
        assert.ok(Math.abs(arm.wrist.x) <= Math.abs(arm.shoulder.x) + 1e-9);
      }
    }
  }
});

test('rear arm projection preserves side-arm vertical motion and remains finite', () => {
  for (const pace of PACE_PRESETS) {
    for (let index = 0; index <= 100; index += 1) {
      const phase = index / 100;
      const side = computeSidePose(phase, pace, PROFILE);
      const rear = computeRearPose(phase, pace, PROFILE);
      assert.equal(poseIsFinite(rear), true);
      for (const key of ['leadArm', 'farArm']) {
        const sideElbowDrop = side[key].elbow.y - side[key].shoulder.y;
        const rearElbowDrop = rear[key].elbow.y - rear[key].shoulder.y;
        const sideWristDrop = side[key].wrist.y - side[key].shoulder.y;
        const rearWristDrop = rear[key].wrist.y - rear[key].shoulder.y;
        assert.ok(Math.abs(sideElbowDrop - rearElbowDrop) < 1e-9);
        assert.ok(Math.abs(sideWristDrop - rearWristDrop) < 1e-9);
      }
    }
  }
});

test('neutral tuning reproduces the pace model and extremes remain coherent', () => {
  for (const pace of PACE_PRESETS) {
    const neutral = tunePace(pace, DEFAULT_TUNING);
    assert.equal(neutral.cadence, pace.cadence);
    assert.equal(neutral.leanDeg, pace.leanDeg);
    assert.equal(neutral.landingOffsetCm, pace.landingOffsetCm);
    assert.equal(neutral.stepWidthCm, pace.stepWidthCm);
    assert.equal(neutral.armRangeDeg, pace.armRangeDeg);

    for (const amount of [-1, 1]) {
      const tuned = tunePace(pace, {
        rhythm: amount * 10,
        stack: amount * 1.5,
        landing: amount * 5,
        lane: amount * 2.5,
        arms: amount * 20
      });
      for (let index = 0; index <= 100; index += 1) {
        assert.equal(poseIsFinite(computeSidePose(index / 100, tuned, PROFILE)), true);
        assert.equal(poseIsFinite(computeRearPose(index / 100, tuned, PROFILE)), true);
      }
    }
  }
});

test('every exposed adjustment stop changes its named relationship', () => {
  const property = {
    rhythm: 'cadence',
    stack: 'leanDeg',
    landing: 'landingOffsetCm',
    lane: 'stepWidthCm',
    arms: 'armArcCm'
  };
  for (const pace of PACE_PRESETS) {
    for (const control of TUNE_CONTROLS) {
      const range = tuneRangeFor(control, pace);
      let previous = null;
      for (
        let value = range.minimum;
        value <= range.maximum + control.step / 10;
        value += control.step
      ) {
        const tuned = tunePace(pace, { ...DEFAULT_TUNING, [control.id]: value });
        const current = tuned[property[control.id]];
        if (previous !== null) {
          assert.notEqual(current, previous, `${pace.id} ${control.id} ${value}`);
        }
        previous = current;
      }
    }
  }
});

test('arm-path adjustment changes inward travel without changing swing size', () => {
  for (const pace of PACE_PRESETS) {
    const lessInward = tunePace(pace, { ...DEFAULT_TUNING, arms: -20 });
    const moreInward = tunePace(pace, { ...DEFAULT_TUNING, arms: 20 });
    let lessMinimum = Infinity;
    let moreMinimum = Infinity;
    assert.equal(lessInward.armRangeDeg, moreInward.armRangeDeg);
    for (let index = 0; index < 400; index += 1) {
      const phase = index / 400;
      const lessPose = computeRearPose(phase, lessInward, PROFILE);
      const morePose = computeRearPose(phase, moreInward, PROFILE);
      lessMinimum = Math.min(lessMinimum, lessPose.leadArm.wrist.x);
      moreMinimum = Math.min(moreMinimum, morePose.leadArm.wrist.x);
      assert.ok(morePose.leadArm.wrist.x >= -PROFILE.hipWidthCm * 0.2 - 1e-9);
    }
    assert.ok(moreMinimum < lessMinimum - 3.5, pace.id);
  }
});

test('every felt-problem path offers varied cues and a valid model focus', () => {
  const validLenses = new Set(['system', 'posture', 'contact', 'recovery', 'arms']);
  const validViews = new Set(['side', 'rear']);
  for (const need of FLOW_NEEDS) {
    assert.ok(validLenses.has(need.lens));
    assert.ok(validViews.has(need.view));
    for (const pace of PACE_PRESETS) {
      const phase = flowPhase(need, pace);
      assert.ok(Number.isFinite(phase) && phase >= 0 && phase < 1);
    }
    assert.ok(FLOW_CUES[need.id].length >= 4);
    for (const cue of FLOW_CUES[need.id]) {
      assert.ok(cue.feel.length > 0 && cue.feel.length < 55);
      assert.ok(cue.see.length > 0);
      assert.ok(cue.avoid.length > 0);
      assert.ok(cue.release.length > 0);
    }
  }
});

test('hostile saved cue data is discarded before the coach renders', () => {
  assert.deepEqual(
    sanitiseCueIndexes({ flow: 2, arms: 0.5, reach: '3', bad: 4 }),
    { flow: 2, reach: 3 }
  );
  assert.deepEqual(sanitiseCueIndexes(null), {});
  assert.equal(sanitiseSavedCue({ needId: 'arms', index: Infinity }), null);
  assert.equal(sanitiseSavedCue({ needId: 'missing', index: 1 }), null);
  assert.deepEqual(sanitiseSavedCue({ needId: 'arms', index: '2' }), {
    needId: 'arms',
    index: 2
  });
  assert.deepEqual(sanitiseTuning(null), DEFAULT_TUNING);
  assert.deepEqual(sanitiseTuning({ rhythm: Infinity, stack: -99, arms: '8' }), {
    ...DEFAULT_TUNING,
    stack: -1.5,
    arms: 8
  });
});
