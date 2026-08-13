import { PROFILE } from './data.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap01 = (value) => ((value % 1) + 1) % 1;
export const radians = (degrees) => (degrees * Math.PI) / 180;
export const degrees = (value) => (value * 180) / Math.PI;
const normaliseDegrees = (value) => ((value + 180) % 360 + 360) % 360 - 180;

const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

const MIN_KNEE_FLEXION_DEG = 3;

function nearLinearProgress(value, edge = 0.012) {
  const t = clamp(value, 0, 1);
  const slope = 1 / (1 - edge);
  if (t < edge) return (slope * t * t) / (2 * edge);
  if (t > 1 - edge) {
    const remaining = 1 - t;
    return 1 - (slope * remaining * remaining) / (2 * edge);
  }
  return slope * (t - edge / 2);
}

const FORCE_ENVELOPE_INTEGRAL = 0.6991486721;

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
      const previous = index === 0
        ? [frames.at(-2)[0] - 1, frames.at(-2)[1]]
        : frames[index - 1];
      const afterNext = index + 2 >= frames.length
        ? [frames[1][0] + 1, frames[1][1]]
        : frames[index + 2];
      const currentSlope =
        (next[1] - previous[1]) / (next[0] - previous[0] || 1);
      const nextSlope =
        (afterNext[1] - current[1]) /
        (afterNext[0] - current[0] || 1);
      const duration = next[0] - current[0];
      const u2 = local * local;
      const u3 = u2 * local;
      return (
        (2 * u3 - 3 * u2 + 1) * current[1] +
        (u3 - 2 * u2 + local) * duration * currentSlope +
        (-2 * u3 + 3 * u2) * next[1] +
        (u3 - u2) * duration * nextSlope
      );
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

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function weightedCentre(parts) {
  const total = parts.reduce((sum, part) => sum + part.mass, 0) || 1;
  return parts.reduce(
    (centre, part) => ({
      x: centre.x + (part.point.x * part.mass) / total,
      y: centre.y + (part.point.y * part.mass) / total
    }),
    { x: 0, y: 0 }
  );
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

function solveKnee(
  hip,
  ankle,
  thighLength,
  shankLength,
  desiredHipFlexion,
  desiredKneeFlexion = null
) {
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const rawDistance = Math.hypot(dx, dy) || 0.0001;
  const maximum = Math.sqrt(
    thighLength ** 2 +
    shankLength ** 2 +
    2 * thighLength * shankLength * Math.cos(radians(MIN_KNEE_FLEXION_DEG))
  );
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
    const score = (candidate) => {
      const hipAngle = signedAngleFromVerticalDown(hip, candidate);
      const shankAngle = signedAngleFromVerticalDown(candidate, adjustedAnkle);
      const signedKneeFlexion = normaliseDegrees(hipAngle - shankAngle);
      const hipError = Math.abs(hipAngle - desiredHipFlexion);
      const kneeError = desiredKneeFlexion === null
        ? 0
        : Math.abs(signedKneeFlexion - Math.max(2, desiredKneeFlexion));
      // The mirrored circle solution is mathematically valid but depicts the
      // knee bending backwards. Make anatomical direction a hard constraint;
      // the remaining errors only choose between viable flexed solutions.
      const hyperextensionPenalty = signedKneeFlexion < 0 ? 1e6 : 0;
      return hipError + kneeError + hyperextensionPenalty;
    };
    const firstError = score(first);
    const secondError = score(second);
    return firstError - secondError;
  })[0];

  return { knee, ankle: adjustedAnkle };
}

export function pelvisHeightAt(phase, preset, profile = PROFILE) {
  const t = wrap01(phase);
  const midstance = preset.stanceFraction * 0.55;
  // A slightly flexed reference chain avoids the singular, locked-knee end of
  // two-link IK at faster contacts and leaves room for the pelvis to travel.
  const base = profile.thighCm + profile.shankCm - 0.65;
  const oscillation =
    -Math.cos(Math.PI * 4 * (t - midstance)) * (preset.bounceCm / 2);
  return base + oscillation;
}

function rawAnglesFromCanonical(canonical, preset) {
  const paceGain = clamp((preset.speedMps - 3.2) * 0.055, -0.07, 0.13);
  const hipBase = sampleFrames(HIP_FRAMES, canonical);
  const hipFlexion = hipBase * (1 + paceGain * (hipBase > 0 ? 1 : 0.6));
  const recoveryEnvelope =
    smoothstep(0.32, 0.43, canonical) *
    (1 - smoothstep(0.76, 0.88, canonical));
  const kneeFlexion = clamp(
    sampleFrames(KNEE_FRAMES, canonical) *
      lerp(1, preset.recoveryLift, recoveryEnvelope),
    12,
    121
  );
  const ankleDorsiflexion = sampleFrames(ANKLE_FRAMES, canonical);
  const footPitchDeg = sampleFrames(FOOT_PITCH_FRAMES, canonical);
  return { canonical, hipFlexion, kneeFlexion, ankleDorsiflexion, footPitchDeg };
}

function rawLegAngles(phase, preset) {
  return rawAnglesFromCanonical(canonicalLegPhase(phase, preset), preset);
}

function footGeometry(ankle, pitchDeg, profile, stanceProgress = null) {
  const pitch = radians(pitchDeg);
  const footLength = profile.footCm;
  const heelDistance = footLength * 0.28;
  const toeDistance = footLength * 0.72;
  const direction = { x: Math.cos(pitch), y: Math.sin(pitch) };
  const upwardNormal = { x: -direction.y, y: direction.x };
  const soleCenter = {
    x: ankle.x - upwardNormal.x * 4.3,
    y: ankle.y - upwardNormal.y * 4.3
  };
  const heel = {
    x: soleCenter.x - direction.x * heelDistance,
    y: soleCenter.y - direction.y * heelDistance
  };
  const toe = {
    x: soleCenter.x + direction.x * toeDistance,
    y: soleCenter.y + direction.y * toeDistance
  };
  return { heel, toe, pitchDeg };
}

function groundedAnkleHeight(pitchDeg, profile, toeOnly = false) {
  const pitch = radians(pitchDeg);
  const directionY = Math.sin(pitch);
  const normalY = Math.cos(pitch);
  const heelOffset = -normalY * 4.3 - directionY * profile.footCm * 0.28;
  const toeOffset = -normalY * 4.3 + directionY * profile.footCm * 0.72;
  return toeOnly ? -toeOffset : -Math.min(heelOffset, toeOffset);
}

function stanceLegGeometry(phase, hip, preset, profile, variant, angles) {
  const stanceProgress = clamp(phase / preset.stanceFraction, 0, 1);
  const contactTravelCm = preset.speedMps * (preset.contactMs / 1000) * 100;
  let landingOffset = preset.landingOffsetCm;
  let kneeTarget = angles.hipFlexion;
  let footPitchDeg = angles.footPitchDeg;

  if (variant === 'overreach') {
    landingOffset += 21;
    kneeTarget += 5;
    footPitchDeg = 10;
  }

  const toeOffBehind = Math.max(32, contactTravelCm - landingOffset);
  const toeOffPitch = variant === 'overreach' ? -65 : -70;
  footPitchDeg = lerp(
    footPitchDeg,
    toeOffPitch,
    smoothstep(0.58, 1, stanceProgress)
  );

  const ankleX = lerp(
    landingOffset,
    -toeOffBehind,
    nearLinearProgress(stanceProgress)
  );
  const targetAnkle = {
    x: ankleX,
    y: groundedAnkleHeight(footPitchDeg, profile, stanceProgress >= 0.72)
  };
  const solution = solveKnee(
    hip,
    targetAnkle,
    profile.thighCm,
    profile.shankCm,
    kneeTarget,
    angles.kneeFlexion
  );

  return {
    knee: solution.knee,
    ankle: solution.ankle,
    stanceProgress,
    footPitchDeg
  };
}

function stanceEndpointAngles(phase, preset, profile, variant) {
  const hip = { x: 0, y: pelvisHeightAt(phase, preset, profile) };
  const raw = rawLegAngles(phase, preset);
  const endpoint = stanceLegGeometry(
    phase,
    hip,
    preset,
    profile,
    variant,
    raw
  );

  const shankPitch = degrees(
    Math.atan2(
      endpoint.ankle.y - endpoint.knee.y,
      endpoint.ankle.x - endpoint.knee.x
    )
  );
  return {
    hipFlexion: signedAngleFromVerticalDown(hip, endpoint.knee),
    kneeFlexion: 180 - angleBetweenAt(endpoint.knee, hip, endpoint.ankle),
    ankleDorsiflexion: normaliseDegrees(
      endpoint.footPitchDeg - (shankPitch + 90)
    ),
    footPitchDeg: endpoint.footPitchDeg
  };
}

function hermiteBetween(value, start, end, startValue, endValue, startSlope, endSlope) {
  const duration = end - start || 1;
  const t = clamp((value - start) / duration, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * startValue +
    (t3 - 2 * t2 + t) * duration * startSlope +
    (-2 * t3 + 3 * t2) * endValue +
    (t3 - t2) * duration * endSlope
  );
}

function angleSlopeAtStanceBoundary(key, preset, profile, variant, boundary) {
  const sampleWidth = 0.000001;
  if (boundary === 'toeoff') {
    const end = stanceEndpointAngles(
      preset.stanceFraction,
      preset,
      profile,
      variant
    )[key];
    const before = stanceEndpointAngles(
      preset.stanceFraction - sampleWidth,
      preset,
      profile,
      variant
    )[key];
    return (end - before) / sampleWidth;
  }
  const start = stanceEndpointAngles(0, preset, profile, variant)[key];
  const after = stanceEndpointAngles(sampleWidth, preset, profile, variant)[key];
  return (after - start) / sampleWidth;
}

function angleSlopeAtCanonical(key, canonical, preset) {
  const sampleWidth = 0.000001;
  const before = rawAnglesFromCanonical(canonical - sampleWidth, preset)[key];
  const after = rawAnglesFromCanonical(canonical + sampleWidth, preset)[key];
  return (after - before) / (sampleWidth * 2);
}

function continuousSwingAngles(raw, preset, profile, variant) {
  const toeOff = stanceEndpointAngles(
    preset.stanceFraction,
    preset,
    profile,
    variant
  );
  const contact = stanceEndpointAngles(0, preset, profile, variant);
  const toeOffCanonical = 0.32;
  const recoveryJoin = 0.44;
  const contactJoin = 0.82;
  const contactCanonical = 1;
  const canonicalPerPhase = 0.68 / (1 - preset.stanceFraction);
  const recoveryAngles = rawAnglesFromCanonical(recoveryJoin, preset);
  const contactAngles = rawAnglesFromCanonical(contactJoin, preset);
  const blend = (key) => {
    if (raw.canonical <= recoveryJoin) {
      return hermiteBetween(
        raw.canonical,
        toeOffCanonical,
        recoveryJoin,
        toeOff[key],
        recoveryAngles[key],
        angleSlopeAtStanceBoundary(
          key,
          preset,
          profile,
          variant,
          'toeoff'
        ) / canonicalPerPhase,
        angleSlopeAtCanonical(key, recoveryJoin, preset)
      );
    }
    if (raw.canonical >= contactJoin) {
      return hermiteBetween(
        raw.canonical,
        contactJoin,
        contactCanonical,
        contactAngles[key],
        contact[key],
        angleSlopeAtCanonical(key, contactJoin, preset),
        angleSlopeAtStanceBoundary(
          key,
          preset,
          profile,
          variant,
          'contact'
        ) / canonicalPerPhase
      );
    }
    return raw[key];
  };

  const blendMinimum = (key, start, end, startValue, endValue, startSlope, endSlope) =>
    Array.from({ length: 41 }, (_, index) =>
      hermiteBetween(
        lerp(start, end, index / 40),
        start,
        end,
        startValue,
        endValue,
        startSlope,
        endSlope
      )
    ).reduce((minimum, value) => Math.min(minimum, value), Infinity);

  const toeOffSlope = angleSlopeAtStanceBoundary(
    'kneeFlexion',
    preset,
    profile,
    variant,
    'toeoff'
  ) / canonicalPerPhase;
  const recoverySlope = angleSlopeAtCanonical(
    'kneeFlexion',
    recoveryJoin,
    preset
  );
  const toeOffMinimum = blendMinimum(
    'kneeFlexion',
    toeOffCanonical,
    recoveryJoin,
    toeOff.kneeFlexion,
    recoveryAngles.kneeFlexion,
    toeOffSlope,
    recoverySlope
  );
  let kneeFlexion = blend('kneeFlexion');
  if (raw.canonical <= recoveryJoin && toeOffMinimum < MIN_KNEE_FLEXION_DEG) {
    const minimumFlexion = Math.max(
      MIN_KNEE_FLEXION_DEG,
      Math.min(4.5, toeOff.kneeFlexion - 0.15)
    );
    const departDuration = clamp(
      (2.5 * (toeOff.kneeFlexion - minimumFlexion)) /
        Math.max(1, Math.abs(toeOffSlope)),
      0.002,
      0.055
    );
    const minimumCanonical = toeOffCanonical + departDuration;
    kneeFlexion = raw.canonical <= minimumCanonical
      ? hermiteBetween(
          raw.canonical,
          toeOffCanonical,
          minimumCanonical,
          toeOff.kneeFlexion,
          minimumFlexion,
          toeOffSlope,
          0
        )
      : hermiteBetween(
          raw.canonical,
          minimumCanonical,
          recoveryJoin,
          minimumFlexion,
          recoveryAngles.kneeFlexion,
          0,
          recoverySlope
        );
  }

  const contactSlope = angleSlopeAtStanceBoundary(
    'kneeFlexion',
    preset,
    profile,
    variant,
    'contact'
  ) / canonicalPerPhase;
  const rawContactSlope = angleSlopeAtCanonical(
    'kneeFlexion',
    contactJoin,
    preset
  );
  const unconstrainedMinimum = blendMinimum(
    'kneeFlexion',
    contactJoin,
    contactCanonical,
    contactAngles.kneeFlexion,
    contact.kneeFlexion,
    rawContactSlope,
    contactSlope
  );
  if (raw.canonical >= contactJoin && unconstrainedMinimum < MIN_KNEE_FLEXION_DEG) {
    const minimumFlexion = Math.max(
      MIN_KNEE_FLEXION_DEG,
      Math.min(4.5, contact.kneeFlexion - 0.75)
    );
    const returnDuration = clamp(
      (2.5 * (contact.kneeFlexion - minimumFlexion)) /
        Math.max(1, Math.abs(contactSlope)),
      0.002,
      0.055
    );
    const minimumCanonical = contactCanonical - returnDuration;
    kneeFlexion = raw.canonical <= minimumCanonical
      ? hermiteBetween(
          raw.canonical,
          contactJoin,
          minimumCanonical,
          contactAngles.kneeFlexion,
          minimumFlexion,
          rawContactSlope,
          0
        )
      : hermiteBetween(
          raw.canonical,
          minimumCanonical,
          contactCanonical,
          minimumFlexion,
          contact.kneeFlexion,
          0,
          contactSlope
        );
  }
  return {
    ...raw,
    hipFlexion: blend('hipFlexion'),
    kneeFlexion,
    ankleDorsiflexion: blend('ankleDorsiflexion'),
    footPitchDeg: blend('footPitchDeg')
  };
}

function computeLeg(phase, hip, preset, profile, variant = 'reference') {
  const t = wrap01(phase);
  const rawAngles = rawLegAngles(t, preset);
  const isStance = t <= preset.stanceFraction + 1e-10;
  const angles = isStance
    ? rawAngles
    : continuousSwingAngles(rawAngles, preset, profile, variant);
  let knee;
  let ankle;
  let stanceProgress = null;
  let footPitchDeg = angles.footPitchDeg;

  if (isStance) {
    const stance = stanceLegGeometry(
      t,
      hip,
      preset,
      profile,
      variant,
      rawAngles
    );
    knee = stance.knee;
    ankle = stance.ankle;
    stanceProgress = stance.stanceProgress;
    footPitchDeg = stance.footPitchDeg;
  } else {
    knee = pointFromVerticalDown(hip, profile.thighCm, angles.hipFlexion);
    ankle = pointFromVerticalDown(
      knee,
      profile.shankCm,
      angles.hipFlexion - angles.kneeFlexion
    );
    const shankPitch = degrees(
      Math.atan2(ankle.y - knee.y, ankle.x - knee.x)
    );
    footPitchDeg = normaliseDegrees(
      shankPitch + 90 + angles.ankleDorsiflexion
    );
  }

  let foot = footGeometry(ankle, footPitchDeg, profile, stanceProgress);
  if (!isStance) {
    // Preserve the rigid shoe-to-ankle connection. If the authored swing would
    // scuff, lift the ankle and resolve the knee instead of moving the shoe by
    // itself. The clearance envelope reaches zero with zero slope at both
    // contacts, so it does not add a new event snap.
    const swingProgress = clamp(
      (t - preset.stanceFraction) / (1 - preset.stanceFraction),
      0,
      1
    );
    const minimumClearance = 1.5 * Math.sin(Math.PI * swingProgress) ** 2;
    const lowest = Math.min(foot.heel.y, foot.toe.y);
    if (lowest < minimumClearance) {
      const raisedTarget = {
        x: ankle.x,
        y: ankle.y + minimumClearance - lowest
      };
      const resolved = solveKnee(
        hip,
        raisedTarget,
        profile.thighCm,
        profile.shankCm,
        angles.hipFlexion,
        angles.kneeFlexion
      );
      knee = resolved.knee;
      ankle = resolved.ankle;
      foot = footGeometry(ankle, footPitchDeg, profile);
    }
  }
  const hipFlexion = signedAngleFromVerticalDown(hip, knee);
  const kneeFlexion = normaliseDegrees(
    signedAngleFromVerticalDown(hip, knee) -
    signedAngleFromVerticalDown(knee, ankle)
  );
  const shankPitch = degrees(
    Math.atan2(ankle.y - knee.y, ankle.x - knee.x)
  );
  const ankleDorsiflexion = normaliseDegrees(
    footPitchDeg - (shankPitch + 90)
  );

  return {
    phase: t,
    variant,
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
      ankleDorsiflexion,
      footPitchDeg
    }
  };
}

function computeArm(shoulder, shoulderAngle, profile) {
  const upperArmAngle = shoulderAngle;
  // A differentiable even curve keeps the compact bend through neutral
  // without the velocity cusp produced by abs(angle).
  const elbowFlexion = clamp(91 + shoulderAngle ** 2 * 0.0031, 88, 97);
  const elbow = pointFromVerticalDown(shoulder, profile.upperArmCm, upperArmAngle);
  // Keep one anatomical hinge branch through neutral. Switching the branch at
  // zero makes the wrist jump from one side of the elbow to the other.
  const forearmAngle = upperArmAngle + (180 - elbowFlexion);
  const wrist = pointFromVerticalDown(elbow, profile.forearmCm, forearmAngle);
  return { shoulder, elbow, wrist, shoulderAngle, elbowFlexion, forearmAngle };
}

function armCycleAt(phase) {
  const angle = Math.PI * 2 * wrap01(phase);
  // A dominant stride-frequency wave with a small odd harmonic creates a
  // smooth, compact reversal while preserving exact left/right reciprocity.
  return Math.cos(angle) * 0.92 + Math.cos(angle * 3) * 0.08;
}

export function forceAt(leg, preset) {
  if (!leg?.isStance || leg.stanceProgress === null) {
    return { verticalBw: 0, horizontalBw: 0, magnitudeBw: 0 };
  }
  const progress = leg.stanceProgress;
  const envelope = Math.sin(Math.PI * progress) ** 0.72;
  // Two alternating contacts must integrate to one body weight across a full
  // stride. The normalised envelope avoids visually impressive but physically
  // impossible force peaks.
  const verticalPeakBw =
    preset.forcePeakBw ||
    1 / (2 * preset.stanceFraction * FORCE_ENVELOPE_INTEGRAL);
  const verticalBw = verticalPeakBw * envelope;
  const split = 0.48;
  const horizontalShape =
    progress < split
      ? -Math.sin((progress / split) * Math.PI)
      : (split / (1 - split)) *
        Math.sin(((progress - split) / (1 - split)) * Math.PI);
  const reachGain = 1 + Math.max(0, preset.landingOffsetCm - 9) * 0.035;
  const patternGain = leg.variant === 'overreach' ? 1.65 : 1;
  const horizontalBw =
    horizontalShape * 0.2 * (0.88 + preset.speedMps * 0.04) * reachGain * patternGain;
  return {
    verticalBw,
    horizontalBw,
    magnitudeBw: Math.hypot(verticalBw, horizontalBw),
    verticalPeakBw
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
  const leadArmAngle = -preset.armRangeDeg * armCycleAt(t);
  const farArmAngle = -leadArmAngle;
  const leadArm = computeArm(shoulderLead, leadArmAngle, profile);
  const farArm = computeArm(shoulderFar, farArmAngle, profile);

  const supportLeg = lead.isStance ? lead : far.isStance ? far : null;
  const contactProgress = supportLeg
    ? smoothstep(0.04, 0.92, supportLeg.stanceProgress)
    : 0;
  const contactPoint = supportLeg
    ? {
        x: lerp(supportLeg.foot.heel.x, supportLeg.foot.toe.x, contactProgress),
        // This is the ground projection used to anchor the illustrative force
        // vector, not a claim to reconstruct a measured centre of pressure.
        y: 0
      }
    : null;
  const force = forceAt(supportLeg, preset);
  // Approximate adult segment fractions sum to one. Unlike a fixed pelvis
  // offset, this centre responds to leg recovery, foot position and arm swing.
  const com = weightedCentre([
    { mass: 0.497, point: midpoint(pelvis, shoulderCenter) },
    { mass: 0.081, point: head },
    { mass: 0.1, point: midpoint(lead.hip, lead.knee) },
    { mass: 0.1, point: midpoint(far.hip, far.knee) },
    { mass: 0.0465, point: midpoint(lead.knee, lead.ankle) },
    { mass: 0.0465, point: midpoint(far.knee, far.ankle) },
    { mass: 0.0145, point: midpoint(lead.foot.heel, lead.foot.toe) },
    { mass: 0.0145, point: midpoint(far.foot.heel, far.foot.toe) },
    { mass: 0.028, point: midpoint(leadArm.shoulder, leadArm.elbow) },
    { mass: 0.028, point: midpoint(farArm.shoulder, farArm.elbow) },
    { mass: 0.022, point: midpoint(leadArm.elbow, leadArm.wrist) },
    { mass: 0.022, point: midpoint(farArm.elbow, farArm.wrist) }
  ]);

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
  const cycle = Math.cos(Math.PI * 2 * wrap01(phase));
  const halfHip = profile.hipWidthCm / 2;
  const halfShoulder = profile.shoulderWidthCm / 2;
  const leadSign = 1;
  const farSign = -1;
  const tiltDeg = variant === 'crossover' ? 5.2 : 1.7;
  const hipDelta = Math.tan(radians(tiltDeg)) * halfHip;
  const pelvisTiltWave = cycle * hipDelta;
  const pelvis = { x: 0, y: side.pelvis.y };
  const hipLead = {
    x: halfHip,
    y: pelvis.y + pelvisTiltWave
  };
  const hipFar = {
    x: -halfHip,
    y: pelvis.y - pelvisTiltWave
  };

  const rearLeg = (sideLeg, hip, sign) => {
    const kneeDrop = Math.max(5, hip.y - sideLeg.knee.y);
    const ankleDrop = Math.max(kneeDrop + 4, hip.y - sideLeg.ankle.y);
    let ankleX;
    let kneeX;

    const corridor = preset.stepWidthCm / 2;
    const swingCompression = clamp(sideLeg.angles.kneeFlexion / 110, 0, 1);
    const swingAnkleX = sign * lerp(10.5, 5.5, swingCompression);
    const swingKneeX = sign * lerp(11.5, 6.8, swingCompression);
    const contactAnkleX = variant === 'crossover' ? -sign * 3.2 : sign * corridor;
    let stanceKneeX = lerp(hip.x, contactAnkleX, variant === 'crossover' ? 0.76 : 0.58);
    if (variant === 'crossover') stanceKneeX -= sign * 4.4;

    const transitionWidth = Math.min(0.022, preset.stanceFraction * 0.075);
    const enterStance = smoothstep(
      1 - transitionWidth,
      1,
      sideLeg.phase
    );
    const exitStance =
      1 - smoothstep(
        preset.stanceFraction,
        preset.stanceFraction + transitionWidth,
        sideLeg.phase
      );
    const stanceBlend = sideLeg.phase <= preset.stanceFraction
      ? 1
      : Math.max(enterStance, exitStance);
    ankleX = lerp(swingAnkleX, contactAnkleX, stanceBlend);
    kneeX = lerp(swingKneeX, stanceKneeX, stanceBlend);

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
  const shoulderLead = {
    x: halfShoulder,
    y: shoulderY - pelvisTiltWave * 0.25
  };
  const shoulderFar = {
    x: -halfShoulder,
    y: shoulderY + pelvisTiltWave * 0.25
  };

  const makeRearArm = (sideArm, shoulder, sign) => {
    const elbowRail = Math.max(halfHip * 0.82, halfShoulder - 2.5);
    const neutralWristRail = Math.max(halfHip * 0.68, halfShoulder * 0.52);
    const forwardAmount = smoothstep(
      -preset.armRangeDeg * 0.2,
      preset.armRangeDeg,
      sideArm.shoulderAngle
    );
    const wristRail = Math.max(
      -halfHip * 0.2,
      neutralWristRail - (preset.armArcCm ?? 10.7) * forwardAmount
    );
    const elbow = {
      x: sign * elbowRail,
      y: shoulder.y + (sideArm.elbow.y - sideArm.shoulder.y)
    };
    const wrist = {
      x: sign * wristRail,
      y: shoulder.y + (sideArm.wrist.y - sideArm.shoulder.y)
    };
    return {
      shoulder,
      elbow,
      wrist,
      shoulderAngle: sideArm.shoulderAngle,
      elbowFlexion: sideArm.elbowFlexion,
      depth: {
        shoulder: 0,
        elbow: sideArm.elbow.x - sideArm.shoulder.x,
        wrist: sideArm.wrist.x - sideArm.shoulder.x
      }
    };
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
    pelvisTiltDeg: tiltDeg * cycle,
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
    pose.leadArm.wrist,
    pose.farArm.shoulder,
    pose.farArm.elbow,
    pose.farArm.wrist,
    pose.waist,
    pose.shoulderLead,
    pose.shoulderFar,
    pose.hipLead,
    pose.hipFar
  ].filter(Boolean);
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

export function armSegmentError(arm, profile = PROFILE) {
  return {
    upperArm: Math.abs(distance(arm.shoulder, arm.elbow) - profile.upperArmCm),
    forearm: Math.abs(distance(arm.elbow, arm.wrist) - profile.forearmCm)
  };
}
