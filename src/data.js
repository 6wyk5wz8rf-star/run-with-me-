const RAW_PACES = [
  {
    id: 'recovery',
    label: 'Recovery',
    pace: '6:10',
    secondsPerKm: 370,
    cadence: 168,
    contactMs: 242,
    bounceCm: 5.9,
    leanDeg: 1.4,
    landingOffsetCm: 11,
    stepWidthCm: 8.4,
    forcePeakBw: 2.35,
    recoveryLift: 0.86,
    armRangeDeg: 24
  },
  {
    id: 'easy',
    label: 'Easy',
    pace: '5:10',
    secondsPerKm: 310,
    cadence: 174,
    contactMs: 220,
    bounceCm: 6.3,
    leanDeg: 2.1,
    landingOffsetCm: 10,
    stepWidthCm: 7.8,
    forcePeakBw: 2.5,
    recoveryLift: 0.94,
    armRangeDeg: 27
  },
  {
    id: 'steady',
    label: 'Steady',
    pace: '4:25',
    secondsPerKm: 265,
    cadence: 180,
    contactMs: 200,
    bounceCm: 6.7,
    leanDeg: 2.6,
    landingOffsetCm: 9,
    stepWidthCm: 7.2,
    forcePeakBw: 2.68,
    recoveryLift: 1.03,
    armRangeDeg: 31
  },
  {
    id: 'threshold',
    label: 'Threshold',
    pace: '3:50',
    secondsPerKm: 230,
    cadence: 184,
    contactMs: 184,
    bounceCm: 7.1,
    leanDeg: 3.1,
    landingOffsetCm: 8,
    stepWidthCm: 6.8,
    forcePeakBw: 2.88,
    recoveryLift: 1.11,
    armRangeDeg: 35
  },
  {
    id: 'fast',
    label: '10K / fast',
    pace: '3:30',
    secondsPerKm: 210,
    cadence: 188,
    contactMs: 171,
    bounceCm: 7.5,
    leanDeg: 3.6,
    landingOffsetCm: 7,
    stepWidthCm: 6.5,
    forcePeakBw: 3.05,
    recoveryLift: 1.18,
    armRangeDeg: 39
  }
];

export function derivePace(raw) {
  const speedMps = 1000 / raw.secondsPerKm;
  const stepPeriodMs = 60000 / raw.cadence;
  const stridePeriodMs = stepPeriodMs * 2;
  const stepLengthM = speedMps * (60 / raw.cadence);
  const flightMs = Math.max(0, stepPeriodMs - raw.contactMs);
  const stanceFraction = raw.contactMs / stridePeriodMs;

  return Object.freeze({
    ...raw,
    speedMps,
    speedKph: speedMps * 3.6,
    stepPeriodMs,
    stridePeriodMs,
    stepLengthM,
    strideLengthM: stepLengthM * 2,
    flightMs,
    stanceFraction,
    dutyPercent: stanceFraction * 100
  });
}

export const PACE_PRESETS = Object.freeze(RAW_PACES.map(derivePace));

export const PROFILE = Object.freeze({
  heightCm: 190,
  heightLabel: '6′3″',
  thighCm: 47.2,
  shankCm: 48.1,
  footCm: 29.4,
  torsoCm: 53.5,
  upperArmCm: 34.5,
  forearmCm: 30.2,
  shoulderWidthCm: 42,
  hipWidthCm: 31
});

export function phaseLandmarks(preset) {
  return [
    { id: 'contact', label: 'Contact', short: 'Contact', phase: 0.012 },
    { id: 'load', label: 'Load response', short: 'Load', phase: Math.min(0.1, preset.stanceFraction * 0.31) },
    { id: 'midstance', label: 'Mid-stance', short: 'Mid-stance', phase: preset.stanceFraction * 0.56 },
    { id: 'toeoff', label: 'Toe-off', short: 'Toe-off', phase: Math.max(0.25, preset.stanceFraction - 0.012) },
    { id: 'recovery', label: 'Max recovery', short: 'Recovery', phase: 0.53 },
    { id: 'lateswing', label: 'Late swing', short: 'Late swing', phase: 0.84 }
  ];
}

const PHASE_COPY = {
  contact: {
    number: '01',
    range: '0–4% of lead-leg stride',
    title: 'Meet the ground quietly.',
    text: 'The foot arrives close to the moving body with a soft knee and near-vertical shin. Contact begins; it does not become a reach.',
    cue: 'Tall first · foot down, not out'
  },
  load: {
    number: '02',
    range: '4–14% of lead-leg stride',
    title: 'Accept load without sitting.',
    text: 'The foot moves back beneath a quiet pelvis. The knee yields, the trunk stays stacked and forward speed is protected.',
    cue: 'Pockets level · ground moving behind you'
  },
  midstance: {
    number: '03',
    range: '14–24% of lead-leg stride',
    title: 'Pass over a firm spring.',
    text: 'Head, ribs and pelvis travel over the support foot as one calm column. The ankle stores load while the pelvis keeps moving forwards.',
    cue: 'Move over the ankle · stay long'
  },
  toeoff: {
    number: '04',
    range: '24–35% of lead-leg stride',
    title: 'Leave from behind.',
    text: 'Hip extension and ankle recoil finish the stance. The leg does not push for ever; it releases and folds into recovery.',
    cue: 'Release behind · heel floats up'
  },
  recovery: {
    number: '05',
    range: '35–63% of lead-leg stride',
    title: 'Fold the lever, then carry it.',
    text: 'The heel recovers towards the body because the knee is flexed. A shorter lever swings forwards with less rotational demand.',
    cue: 'Heel floats · knee comes through'
  },
  lateswing: {
    number: '06',
    range: '64–100% of lead-leg stride',
    title: 'Prepare down, not forwards.',
    text: 'The thigh finishes its advance while the lower leg unfolds beneath it. The foot is already travelling back before contact.',
    cue: 'Knee forward · foot returning beneath you'
  }
};

const LENS_COPY = {
  posture: {
    title: 'Keep the stack calm.',
    text: 'The head rides over the ribs and the ribs over the pelvis. A small whole-body projection is enough; there is no hinge at the waist.',
    cue: 'Crown tall · pockets level'
  },
  contact: {
    title: 'Watch where the foot meets you.',
    text: 'Foot strike label matters less than the relationship: soft knee, modest reach, low braking and a foot already beginning to sweep back.',
    cue: 'Land near · let the foot move back'
  },
  recovery: {
    title: 'Let the rear leg shorten itself.',
    text: 'Recovery is a consequence of release, knee flexion and pace. Do not force the heel high; watch the lever become compact on its own.',
    cue: 'Release, fold, carry'
  },
  arms: {
    title: 'Use the arms to organise rhythm.',
    text: 'Elbows travel mostly behind and forwards beside the ribs. Hands stay quiet and the shoulders counterbalance the pelvis without crossing the body.',
    cue: 'Elbows brush back · hands stay soft'
  }
};

export function getPhaseInfo(phase, preset) {
  const t = ((phase % 1) + 1) % 1;
  const stance = preset.stanceFraction;
  const contactEnd = 0.045;
  const loadEnd = Math.min(0.14, stance * 0.44);
  const midstanceEnd = stance * 0.76;
  const toeoffEnd = stance + 0.035;
  const recoveryEnd = 0.65;
  let id;

  if (t < contactEnd) id = 'contact';
  else if (t < loadEnd) id = 'load';
  else if (t < midstanceEnd) id = 'midstance';
  else if (t < toeoffEnd) id = 'toeoff';
  else if (t < recoveryEnd) id = 'recovery';
  else id = 'lateswing';

  const percentRange = (start, end) =>
    `${Math.round(start * 100)}–${Math.round(end * 100)}% of lead-leg stride`;
  const ranges = {
    contact: percentRange(0, contactEnd),
    load: percentRange(contactEnd, loadEnd),
    midstance: percentRange(loadEnd, midstanceEnd),
    toeoff: percentRange(midstanceEnd, toeoffEnd),
    recovery: percentRange(toeoffEnd, recoveryEnd),
    lateswing: percentRange(recoveryEnd, 1)
  };
  const landmark = phaseLandmarks(preset).find((item) => item.id === id);
  return { id, label: landmark.label, ...PHASE_COPY[id], range: ranges[id] };
}

export function getObservation(phaseInfo, lens) {
  if (lens === 'system') {
    return {
      title: phaseInfo.title,
      text: phaseInfo.text,
      cue: phaseInfo.cue
    };
  }

  return LENS_COPY[lens] || LENS_COPY.posture;
}

export const PRINCIPLES = Object.freeze([
  {
    id: 'posture',
    number: '01',
    title: 'Stack before lean',
    text: 'Head, ribs and pelvis stay related. Projection is small and whole-body—not a fold at the waist.',
    cue: 'Tall'
  },
  {
    id: 'contact',
    number: '02',
    title: 'Land near',
    text: 'A soft knee and near-vertical shin limit the reach ahead of the moving pelvis.',
    cue: 'Near'
  },
  {
    id: 'system',
    number: '03',
    title: 'Carry the pelvis',
    text: 'The centre of mass keeps moving forwards while vertical travel and braking stay controlled.',
    cue: 'Through'
  },
  {
    id: 'recovery',
    number: '04',
    title: 'Release, then fold',
    text: 'A finished stance becomes a compact recovery. The heel lift is an outcome, not a pose to force.',
    cue: 'Float'
  },
  {
    id: 'arms',
    number: '05',
    title: 'Balance the rhythm',
    text: 'Compact arms counter the pelvis beside the body and keep the upper system quiet.',
    cue: 'Back'
  }
]);

export const EVIDENCE = Object.freeze([
  {
    label: 'Kenyan gait research',
    title: 'Short contact is observed—not commanded.',
    text: 'Small studies of elite Kenyan runners reported comparatively short ground contacts and slim distal limbs. The samples were limited, so the model uses ranges rather than an “optimal” score.',
    link: 'https://www.jssm.org/jssm-07-499.xml%3EFulltext',
    linkText: 'Kong & de Heer, 2008'
  },
  {
    label: 'Kenyan force study',
    title: 'One number does not explain economy.',
    text: 'In 15 elite Kenyan men, simple gait and force variables did not significantly explain energy cost within the group, despite short contacts versus earlier elite samples.',
    link: 'https://pubmed.ncbi.nlm.nih.gov/27157507/',
    linkText: 'Santos-Concejero et al., 2017'
  },
  {
    label: 'Ethiopian economy study',
    title: 'Economy is measured. A signature pose is not.',
    text: 'A 2025 high-altitude study of 53 high-level Ethiopian runners found exceptional running economy across multiple speeds. Biomechanics were not assessed, so this atlas does not invent a fixed Ethiopian gait.',
    link: 'https://link.springer.com/article/10.1186/s13104-025-07397-8',
    linkText: 'Bayissa et al., 2025'
  },
  {
    label: 'Horn of Africa comparison',
    title: 'There is no single East African gait.',
    text: 'Elite Eritrean runners were more economical at one tested speed, yet basic contact, swing, stride length and frequency did not differ from elite Europeans.',
    link: 'https://pubmed.ncbi.nlm.nih.gov/25310728/',
    linkText: 'Santos-Concejero et al., 2015'
  },
  {
    label: 'Posture experiment',
    title: 'More lean is not automatically better.',
    text: 'A 2024 experiment found that deliberately increasing forward lean up to about eight degrees worsened economy. This model therefore stays upright with only modest pace-linked projection.',
    link: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0302249',
    linkText: 'Carson et al., 2024'
  }
]);
