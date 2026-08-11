import { PROFILE } from './data.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap01 = (value) => ((value % 1) + 1) % 1;
export const radians = (degrees) => (degrees * Math.PI) / 180;
export const degrees = (value) => (value * 180) / Math.PI;

const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

const easeInOut = (value) => 0.5 - Math.cos(Math.PI * clamp(value, 0, 1)) / 2;

const HIP_FRAMES = [
  [0, 23],
  [0.08, 16],
  [0.16, 5],
  [0.24, -9],
  [0.32, -18],
  [0.4, -12],
  [0.52, 6],
  [0.64, 24],
  [0.78, 34],
  [0.9, 31],
  [1, 23]
];

const KNEE_FRAMES = [
  [0, 17],
  [0.08, 30],
  [0.16, 39],
  [0.24, 32],
  [0.32, 43],
  [0.4, 74],
  [0.52, 104],
  [0.64, 94],
  [0.78, 60],
  [0.9, 25],
  [1, 17]
];

const ANKLE_FRAMES = [
  [0, 2],
  [0.08, 7],
  [0.16, 13],
  [0.24, 16],
  [0.32, -18],
  [0.4, -21],
  [0.52, -6],
  [0.64, 3],
  [0.78, 5],
  [0.9, 3],
  [1, 2]
];

const FOOT_PITCH_FRAMES = [
  [0, 4],
  [0.12, 0],
  [0.24, -6],
  [0.32, -23],
  [0.44, -14],
  [0.58, 4],
  [0.75, 7],
  [0.9, 4],
  [1, 4]
];

function sampleFrames(frames, phase) {
  const t = clamp(phase, 0, 1);
  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (t >= current[0] && t <= next[0]) {
      const local = (t - current[0]) / (next[0] - current[0] || 1);
      return lerp(current[1], next[1], easeInOut(local));
    }
  }
  return frames.at(-1)[1];
}

function canonicalLegPhase(phase, preset) {
  const t = wrap01(phase);
  const stance = preset.stanceFraction;
  if (t <= stance) return (t / stance) * 0.32;
  return 0.32 + ((t - stance) / (1 - stance)) * 0.68;
}

function pointFromVerticalDown(origin, length, angleDeg) {
  const angle = radians(angleDeg);
  return {
    x: origin.x + Math.sin(angle) * length,
    y: origin.y - Math.cos(angle) * length
  };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function signedAngleFromVerticalDown(a, b) {
  return degrees(Math.atan2(b.x - a.x, a.y - b.y));
}

function angleBetweenAt(vertex, a, b) {
  const ax = a.x - vertex.x;
  const ay = a.y - vertex.y;
  const bx = b.x - vertex.x;
  const by = b.y - vertex.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
  return degrees(Math.acos(clamp((ax * bx + ay * by) / denominator, -1, 1)));
}

function solveKnee(hip, ankle, thighLength, shankLength, desiredHipFlexion) {
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const rawDistance = Math.hypot(dx, dy) || 0.0001;
  const maximum = thighLength + shankLength - 0.08;
  const minimum = Math.abs(thighLength - shankLength) + 0.08;
  const solvedDistance = clamp(rawDistance, minimum, maximum);
  const ux = dx / rawDistance;
  const uy = dy / rawDistance;
  const adjustedAnkle = {
    x: hip.x + ux * solvedDistance,
    y: hip.y + uy * solvedDistance
  };
  const a =
    (thighLength ** 2 - shankLength ** 2 + solvedDistance ** 2) /
    (2 * solvedDistance);
  const h = Math.sqrt(Math.max(0, thighLength ** 2 - a ** 2));
  const base = { x: hip.x + ux * a, y: hip.y + uy * a };
  const perpendicular = { x: -uy, y: ux };
  const candidates = [
    { x: base.x + perpendicular.x * h, y: base.y + perpendicular.y * h },
    { x: base.x - perpendicular.x * h, y: base.y - perpendicular.y * h }
  ];

  const knee = candidates.sort((first, second) => {
    const firstError = Math.abs(
      signedAngleFromVerticalDown(hip, first) - desiredHipFlexion
    );
    const secondError = Math.abs(
      signedAngleFromVerticalDown(hip, second) - desiredHipFlexion
    );
    return firstError - secondError;
  })[0];

  return { knee, ankle: adjustedAnkle };
}

export function pelvisHeightAt(phase, preset, profile = PROFILE) {
  const t = wrap01(phase);
  const midstance = preset.stanceFraction * 0.55;
  const base = profile.thighCm + profile.shankCm + 1.8;
  const oscillation =
    -Math.cos(Math.PI * 4 * (t - midstance)) * (preset.bounceCm / 2);
  return base + oscillation;
}

function rawLegAngles(phase, preset) {
  const canonical = canonicalLegPhase(phase, preset);
  const paceGain = clamp((preset.speedMps - 3.2) * 0.055, -0.07, 0.13);
  const hipBase = sampleFrames(HIP_FRAMES, canonical);
  const hipFlexion = hipBase * (1 + paceGain * (hipBase > 0 ? 1 : 0.6));
  const kneeFlexion = clamp(
    sampleFrames(KNEE_FRAMES, canonical) *
      (canonical > 0.34 && canonical < 0.82 ? preset.recoveryLift : 1),
    12,
    121
  );
  const ankleDorsiflexion = sampleFrames(ANKLE_FRAMES, canonical);
  const footPitchDeg = sampleFrames(FOOT_PITCH_FRAMES, canonical);
  return { canonical, hipFlexion, kneeFlexion, ankleDorsiflexion, footPitchDeg };
}

function footGeometry(ankle, pitchDeg, profile, stanceProgress = null) {
  const pitch = radians(pitchDeg);
  const footLength = profile.footCm;
  const heelDistance = footLength * 0.28;
  const toeDistance = footLength * 0.72;
  let heel = {
    x: ankle.x - Math.cos(pitch) * heelDistance,
    y: ankle.y - Math.sin(pitch) * heelDistance - 4.2
  };
  let toe = {
    x: ankle.x + Math.cos(pitch) * toeDistance,
    y: ankle.y + Math.sin(pitch) * toeDistance - 4.4
  };

  if (stanceProgress !== null) {
    const lift = smoothstep(0.67, 1, stanceProgress);
    if (stanceProgress < 0.72) {
      const lowest = Math.min(heel.y, toe.y);
      heel = { ...heel, y: heel.y - lowest };
      toe = { ...toe, y: toe.y - lowest };
    } else {
      toe = { ...toe, y: 0 };
      heel = { ...heel, y: Math.max(0, heel.y + lift * 2.5) };
    }
  }

  return { heel, toe, pitchDeg };
}

function computeLeg(phase, hip, preset, profile, variant = 'reference') {
  const t = wrap01(phase);
  const angles = rawLegAngles(t, preset);
  const isStance = t <= preset.stanceFraction;
  let knee;
  let ankle;
  let stanceProgress = null;
  let footPitchDeg = angles.footPitchDeg;

  if (isStance) {
    stanceProgress = clamp(t / preset.stanceFraction, 0, 1);
    const toeOffBehind = clamp(preset.stepLengthM * 100 * 0.28, 26, 40);
    let landingOffset = preset.landingOffsetCm;
    let kneeTarget = angles.hipFlexion;

    if (variant === 'overreach') {
      landingOffset += 21;
      kneeTarget += 5;
      footPitchDeg = 10;
    }

    const ankleX = lerp(
      landingOffset,
      -toeOffBehind,
      smoothstep(0, 1, stanceProgress)
    );
    const heelLift = smoothstep(0.68, 1, stanceProgress) * 8.5;
    const targetAnkle = { x: ankleX, y: 5.1 + heelLift };
    const solution = solveKnee(
      hip,
      targetAnkle,
      profile.thighCm,
      profile.shankCm,
      kneeTarget
    );
    knee = solution.knee;
    ankle = solution.ankle;
  } else {
    knee = pointFromVerticalDown(hip, profile.thighCm, angles.hipFlexion);
    ankle = pointFromVerticalDown(
      knee,
      profile.shankCm,
      angles.hipFlexion - angles.kneeFlexion
    );
  }

  const foot = footGeometry(ankle, footPitchDeg, profile, stanceProgress);
  const hipFlexion = signedAngleFromVerticalDown(hip, knee);
  const kneeFlexion = 180 - angleBetweenAt(knee, hip, ankle);

  return {
    phase: t,
    canonical: angles.canonical,
    isStance,
    stanceProgress,
    hip,
    knee,
    ankle,
    foot,
    angles: {
      hipFlexion,
      kneeFlexion,
      ankleDorsiflexion: angles.ankleDorsiflexion,
      footPitchDeg
    }
  };
}

function computeArm(shoulder, shoulderAngle, profile) {
  const upperArmAngle = shoulderAngle;
  const elbowFlexion = clamp(88 + Math.abs(shoulderAngle) * 0.18, 86, 100);
  const elbow = pointFromVerticalDown(shoulder, profile.upperArmCm, upperArmAngle);
  const direction = Math.sign(shoulderAngle || 1);
  const forearmAngle =
    upperArmAngle + direction * (180 - elbowFlexion);
  const hand = pointFromVerticalDown(shoulder, 0, 0);
  const wrist = pointFromVerticalDown(elbow, profile.forearmCm, forearmAngle);
  hand.x = wrist.x;
  hand.y = wrist.y;
  return { shoulder, elbow, wrist: hand, shoulderAngle, elbowFlexion };
}

export function forceAt(leg, preset) {
  if (!leg?.isStance || leg.stanceProgress === null) {
    return { verticalBw: 0, horizontalBw: 0, magnitudeBw: 0 };
  }
  const progress = leg.stanceProgress;
  const envelope = Math.sin(Math.PI * progress) ** 0.72;
  const verticalBw = preset.forcePeakBw * envelope;
  const horizontalShape =
    progress < 0.48
      ? -Math.sin((progress / 0.48) * Math.PI) * 0.21
      : Math.sin(((progress - 0.48) / 0.52) * Math.PI) * 0.18;
  const horizontalBw = horizontalShape * (0.88 + preset.speedMps * 0.04);
  return {
    verticalBw,
    horizontalBw,
    magnitudeBw: Math.hypot(verticalBw, horizontalBw)
  };
}

export function computeSidePose(
  phase,
  preset,
  profile = PROFILE,
  { variant = 'reference' } = {}
) {
  const t = wrap01(phase);
  let pelvisHeight = pelvisHeightAt(t, preset, profile);
  if (variant === 'overreach') pelvisHeight -= 2.6;
  const pelvis = { x: 0, y: pelvisHeight };
  const hipLead = { x: 0, y: pelvisHeight };
  const hipFar = { x: 0, y: pelvisHeight };
  const lead = computeLeg(t, hipLead, preset, profile, variant);
  const far = computeLeg(wrap01(t + 0.5), hipFar, preset, profile, 'reference');

  const baseLean = preset.leanDeg;
  const normalWaist = {
    x: pelvis.x + Math.sin(radians(baseLean)) * profile.torsoCm * 0.35,
    y: pelvis.y + Math.cos(radians(baseLean)) * profile.torsoCm * 0.35
  };
  let waist = normalWaist;
  let torsoTopLean = baseLean;
  if (variant === 'waist') {
    waist = {
      x: pelvis.x + Math.sin(radians(0.5)) * profile.torsoCm * 0.35,
      y: pelvis.y + Math.cos(radians(0.5)) * profile.torsoCm * 0.35
    };
    torsoTopLean = baseLean + 15;
  }
  const upperTorsoLength = profile.torsoCm * 0.65;
  const shoulderCenter = {
    x: waist.x + Math.sin(radians(torsoTopLean)) * upperTorsoLength,
    y: waist.y + Math.cos(radians(torsoTopLean)) * upperTorsoLength
  };
  const neck = {
    x: shoulderCenter.x + Math.sin(radians(torsoTopLean - 1)) * 7.5,
    y: shoulderCenter.y + Math.cos(radians(torsoTopLean - 1)) * 7.5
  };
  const head = {
    x: neck.x + Math.sin(radians(torsoTopLean - 2)) * 9.3,
    y: neck.y + Math.cos(radians(torsoTopLean - 2)) * 9.3
  };

  const shoulderLead = { ...shoulderCenter };
  const shoulderFar = { ...shoulderCenter };
  const leadArmAngle = clamp(
    -lead.angles.hipFlexion * 0.82,
    -preset.armRangeDeg,
    preset.armRangeDeg
  );
  const farArmAngle = clamp(
    -far.angles.hipFlexion * 0.82,
    -preset.armRangeDeg,
    preset.armRangeDeg
  );
  const leadArm = computeArm(shoulderLead, leadArmAngle, profile);
  const farArm = computeArm(shoulderFar, farArmAngle, profile);

  const supportLeg = lead.isStance ? lead : far.isStance ? far : null;
  const contactPoint = supportLeg
    ? supportLeg.foot.toe.y <= supportLeg.foot.heel.y
      ? supportLeg.foot.toe
      : supportLeg.foot.heel
    : null;
  const force = forceAt(supportLeg, preset);
  const com = {
    x: pelvis.x * 0.72 + shoulderCenter.x * 0.28,
    y: pelvis.y + profile.torsoCm * 0.27
  };

  return {
    phase: t,
    variant,
    pelvis,
    waist,
    shoulderCenter,
    neck,
    head,
    lead,
    far,
    leadArm,
    farArm,
    supportLeg,
    contactPoint,
    force,
    com,
    posture: {
      wholeBodyLeanDeg: baseLean,
      upperTorsoLeanDeg: torsoTopLean,
      stackBreakDeg: torsoTopLean - baseLean
    }
  };
}

export function computeRearPose(
  phase,
  preset,
  profile = PROFILE,
  { variant = 'reference' } = {}
) {
  const side = computeSidePose(phase, preset, profile);
  const halfHip = profile.hipWidthCm / 2;
  const halfShoulder = profile.shoulderWidthCm / 2;
  const leadSign = 1;
  const farSign = -1;
  const supportSign = side.lead.isStance ? leadSign : side.far.isStance ? farSign : 0;
  const tiltDeg = variant === 'crossover' ? 5.2 : 1.7;
  const hipDelta = Math.tan(radians(tiltDeg)) * halfHip;
  const pelvis = { x: 0, y: side.pelvis.y };
  const hipLead = {
    x: halfHip,
    y: pelvis.y + (supportSign === leadSign ? hipDelta : -hipDelta)
  };
  const hipFar = {
    x: -halfHip,
    y: pelvis.y + (supportSign === farSign ? hipDelta : -hipDelta)
  };

  const rearLeg = (sideLeg, hip, sign) => {
    const kneeDrop = Math.max(5, hip.y - sideLeg.knee.y);
    const ankleDrop = Math.max(kneeDrop + 4, hip.y - sideLeg.ankle.y);
    let ankleX;
    let kneeX;

    if (sideLeg.isStance) {
      const corridor = preset.stepWidthCm / 2;
      ankleX = sign * corridor;
      if (variant === 'crossover') ankleX = -sign * 3.2;
      kneeX = lerp(hip.x, ankleX, variant === 'crossover' ? 0.76 : 0.58);
      if (variant === 'crossover') kneeX -= sign * 4.4;
    } else {
      const swingCompression = clamp(sideLeg.angles.kneeFlexion / 110, 0, 1);
      ankleX = sign * lerp(10.5, 5.5, swingCompression);
      kneeX = sign * lerp(11.5, 6.8, swingCompression);
    }

    return {
      ...sideLeg,
      hip,
      knee: { x: kneeX, y: hip.y - kneeDrop },
      ankle: { x: ankleX, y: hip.y - ankleDrop },
      foot: {
        heel: { x: ankleX - 2.6, y: Math.max(0, hip.y - ankleDrop - 4) },
        toe: { x: ankleX + 2.6, y: Math.max(0, hip.y - ankleDrop - 4) },
        pitchDeg: 0
      }
    };
  };

  const lead = rearLeg(side.lead, hipLead, leadSign);
  const far = rearLeg(side.far, hipFar, farSign);
  const shoulderY = side.shoulderCenter.y;
  const shoulderLead = { x: halfShoulder, y: shoulderY - hipDelta * 0.25 };
  const shoulderFar = { x: -halfShoulder, y: shoulderY + hipDelta * 0.25 };

  const makeRearArm = (sideArm, shoulder, sign) => {
    const lift = Math.sin(radians(sideArm.shoulderAngle));
    const elbow = {
      x: shoulder.x + sign * (9.5 + Math.abs(lift) * 2.5),
      y: shoulder.y - 25 + lift * 5
    };
    const wrist = {
      x: elbow.x - sign * 3.5,
      y: elbow.y - 21 - lift * 2
    };
    return { shoulder, elbow, wrist };
  };

  const leadArm = makeRearArm(side.leadArm, shoulderLead, leadSign);
  const farArm = makeRearArm(side.farArm, shoulderFar, farSign);
  const contactPoint = lead.isStance
    ? { x: lead.ankle.x, y: 0 }
    : far.isStance
      ? { x: far.ankle.x, y: 0 }
      : null;

  return {
    phase: wrap01(phase),
    variant,
    pelvis,
    head: { x: 0, y: side.head.y },
    neck: { x: 0, y: side.neck.y },
    shoulderCenter: { x: 0, y: shoulderY },
    shoulderLead,
    shoulderFar,
    hipLead,
    hipFar,
    lead,
    far,
    leadArm,
    farArm,
    contactPoint,
    force: side.force,
    pelvisTiltDeg: supportSign ? tiltDeg : 0,
    stepWidthCm:
      Math.abs((lead.isStance ? lead.ankle.x : far.ankle.x) * 2)
  };
}

export function buildTrace(preset, samples = 120) {
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const phase = index / (samples - 1);
    const pose = computeSidePose(phase, preset);
    values.push({
      phase,
      comY: pose.com.y,
      force: pose.force.verticalBw
    });
  }
  return values;
}

export function poseIsFinite(pose) {
  const points = [
    pose.pelvis,
    pose.waist,
    pose.shoulderCenter,
    pose.neck,
    pose.head,
    pose.lead.hip,
    pose.lead.knee,
    pose.lead.ankle,
    pose.far.hip,
    pose.far.knee,
    pose.far.ankle,
    pose.leadArm.shoulder,
    pose.leadArm.elbow,
    pose.leadArm.wrist
  ];
  return points.every((point) =>
    point && Number.isFinite(point.x) && Number.isFinite(point.y)
  );
}

export function legSegmentError(leg, profile = PROFILE) {
  return {
    thigh: Math.abs(distance(leg.hip, leg.knee) - profile.thighCm),
    shank: Math.abs(distance(leg.knee, leg.ankle) - profile.shankCm)
  };
}
