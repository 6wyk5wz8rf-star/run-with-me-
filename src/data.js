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
    landingOffsetCm: 18,
    stepWidthCm: 8.4,
    recoveryLift: 0.86,
    armRangeDeg: 24,
    armArcCm: 10.4
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
    landingOffsetCm: 20,
    stepWidthCm: 7.8,
    recoveryLift: 0.94,
    armRangeDeg: 27,
    armArcCm: 10.7
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
    landingOffsetCm: 22,
    stepWidthCm: 7.2,
    recoveryLift: 1.03,
    armRangeDeg: 31,
    armArcCm: 11
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
    landingOffsetCm: 24,
    stepWidthCm: 6.8,
    recoveryLift: 1.11,
    armRangeDeg: 35,
    armArcCm: 11.3
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
    landingOffsetCm: 25,
    stepWidthCm: 6.5,
    recoveryLift: 1.18,
    armRangeDeg: 39,
    armArcCm: 11.6
  }
];

export function derivePace(raw) {
  const speedMps = 1000 / raw.secondsPerKm;
  const stepPeriodMs = 60000 / raw.cadence;
  const stridePeriodMs = stepPeriodMs * 2;
  const stepLengthM = speedMps * (60 / raw.cadence);
  const flightMs = Math.max(0, stepPeriodMs - raw.contactMs);
  const stanceFraction = raw.contactMs / stridePeriodMs;
  const forcePeakBw = 1 / (2 * stanceFraction * 0.6991486721);

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
    dutyPercent: stanceFraction * 100,
    forcePeakBw
  });
}

export const PACE_PRESETS = Object.freeze(RAW_PACES.map(derivePace));

const bound = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export const DEFAULT_TUNING = Object.freeze({
  rhythm: 0,
  stack: 0,
  landing: 0,
  lane: 0,
  arms: 0
});

export function sanitiseTuning(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    TUNE_CONTROLS.map((control) => {
      const number = Number(candidate[control.id]);
      return [
        control.id,
        Number.isFinite(number)
          ? bound(number, control.minimum, control.maximum)
          : DEFAULT_TUNING[control.id]
      ];
    })
  );
}

export const TUNE_CONTROLS = Object.freeze([
  {
    id: 'rhythm',
    label: 'Rhythm',
    short: 'steps/min',
    minimum: -10,
    maximum: 10,
    step: 1,
    low: 'Slower turnover',
    high: 'Quicker turnover',
    description: 'Compare a small change from this pace. Speed stays fixed, so step length adapts.'
  },
  {
    id: 'stack',
    label: 'Stack angle',
    short: 'head · ribs · pockets',
    minimum: -1.5,
    maximum: 1.5,
    step: 0.1,
    low: 'More upright',
    high: 'More forward',
    description: 'Changes the angle of the stacked upper body without adding a waist fold.'
  },
  {
    id: 'landing',
    label: 'Landing',
    short: 'contact offset',
    minimum: -5,
    maximum: 5,
    step: 0.5,
    low: 'Nearer',
    high: 'Farther ahead',
    description: 'Moves the model contact nearer to or farther ahead of the travelling pelvis. It is not a target.'
  },
  {
    id: 'lane',
    label: 'Lane',
    short: 'step width',
    minimum: -2.5,
    maximum: 2.5,
    step: 0.5,
    low: 'Narrower',
    high: 'Wider',
    description: 'Changes the space between the two foot tracks in rear view.'
  },
  {
    id: 'arms',
    label: 'Arm path',
    short: 'inward travel',
    minimum: -20,
    maximum: 20,
    step: 2,
    low: 'Less inward',
    high: 'More inward',
    description: 'Illustrative adjustment of inward hand travel without changing swing size. A slight front crossover can occur naturally.'
  }
]);

function minimumLandingAdjustment(preset) {
  if (preset.speedMps >= 4) return -2.5;
  if (preset.speedMps >= 3.6) return -4;
  return -5;
}

function maximumLandingAdjustment(preset) {
  if (preset.speedMps >= 4) return 2;
  if (preset.speedMps >= 3.5) return 3;
  if (preset.speedMps >= 3.1) return 4;
  return 5;
}

export function tuneRangeFor(control, preset) {
  let minimum = control.minimum;
  let maximum = control.maximum;
  if (control.id === 'stack') {
    minimum = Math.max(minimum, -preset.leanDeg);
    maximum = Math.min(maximum, 6 - preset.leanDeg);
  } else if (control.id === 'landing') {
    minimum = Math.max(
      minimum,
      12 - preset.landingOffsetCm,
      minimumLandingAdjustment(preset)
    );
    maximum = Math.min(
      maximum,
      30 - preset.landingOffsetCm,
      maximumLandingAdjustment(preset)
    );
  } else if (control.id === 'lane') {
    minimum = Math.max(minimum, 4 - preset.stepWidthCm);
    maximum = Math.min(maximum, 14 - preset.stepWidthCm);
  }
  return {
    minimum: Math.ceil((minimum - 1e-9) / control.step) * control.step,
    maximum: Math.floor((maximum + 1e-9) / control.step) * control.step
  };
}

export function tunePace(preset, tuning = DEFAULT_TUNING) {
  const rhythm = bound(Number(tuning.rhythm) || 0, -10, 10);
  const cadence = bound(Math.round(preset.cadence + rhythm), 100, 220);
  const contactScale = Math.sqrt(preset.cadence / cadence);
  const landingAdjustment = bound(
    Number(tuning.landing) || 0,
    minimumLandingAdjustment(preset),
    maximumLandingAdjustment(preset)
  );
  const tuned = derivePace({
    ...preset,
    cadence,
    contactMs: preset.contactMs * contactScale,
    leanDeg: bound(preset.leanDeg + (Number(tuning.stack) || 0), 0, 6),
    landingOffsetCm: bound(
      preset.landingOffsetCm + landingAdjustment,
      12,
      30
    ),
    stepWidthCm: bound(
      preset.stepWidthCm + (Number(tuning.lane) || 0),
      4,
      14
    ),
    armRangeDeg: preset.armRangeDeg,
    armArcCm: bound(
      (preset.armArcCm ?? 10.7) + (Number(tuning.arms) || 0) * 0.1,
      7.5,
      14.5
    )
  });

  return Object.freeze({ ...tuned, baseline: preset, tuning: { ...tuning } });
}

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

export const FLOW_NEEDS = Object.freeze([
  {
    id: 'flow',
    label: 'Nothing · just flow',
    prompt: 'Nothing needs fixing. I just want an easy way into the run.',
    lens: 'system',
    view: 'side',
    phase: 'midstance',
    tune: 'rhythm'
  },
  {
    id: 'reach',
    label: 'Landing feels loud',
    prompt: 'Contact feels louder or more reaching than I want today.',
    lens: 'contact',
    view: 'side',
    phase: 0.012,
    tune: 'landing'
  },
  {
    id: 'sit',
    label: 'I feel folded',
    prompt: 'I feel low, folded or a little behind the step.',
    lens: 'posture',
    view: 'side',
    phase: 'midstance',
    tune: 'stack'
  },
  {
    id: 'knees',
    label: 'Legs feel crowded',
    prompt: 'My knees or feet feel as though they have too little room.',
    lens: 'contact',
    view: 'rear',
    phase: 'midstance',
    tune: 'lane'
  },
  {
    id: 'arms',
    label: 'Arms feel busy',
    prompt: 'My shoulders or hands feel busy across the front of me.',
    lens: 'arms',
    view: 'rear',
    phase: 0.1,
    tune: 'arms'
  },
  {
    id: 'tension',
    label: 'Upper body feels held',
    prompt: 'My jaw, hands or shoulders feel held rather than easy.',
    lens: 'arms',
    view: 'side',
    phase: 0.1,
    tune: null
  },
  {
    id: 'overthink',
    label: 'Mind feels busy',
    prompt: 'I am monitoring the stride instead of simply running.',
    lens: 'system',
    view: 'side',
    phase: 0.18,
    tune: null
  }
]);

export const FLOW_CUES = Object.freeze({
  flow: Object.freeze([
    {
      feel: 'Pockets level · ground behind',
      see: 'The pelvis keeps travelling while the support foot moves behind it.',
      avoid: '“Pockets level” is a sensation of balance, not literal symmetry. Do not chase bounce, cadence or a perfect foot strike.',
      release: 'Eyes ahead · let rhythm return.'
    },
    {
      feel: 'Tall body · loose feet',
      see: 'The trunk stays calm while the legs cycle freely underneath.',
      avoid: 'Tall does not mean rigid. Let the ribs breathe.',
      release: 'Keep moving · stop checking.'
    },
    {
      feel: 'Travel over support',
      see: 'The body passes over support instead of waiting behind the foot.',
      avoid: 'Do not force a push. Let the ground leave behind you.',
      release: 'Let the ground pass on its own.'
    },
    {
      feel: 'Light below · quiet above',
      see: 'The legs do the visible work while the head and shoulders travel calmly.',
      avoid: 'Let small natural movement remain; quiet is not frozen.',
      release: 'Look ahead · feel the whole stride.'
    }
  ]),
  reach: Object.freeze([
    {
      feel: 'Foot down under the hanging pocket',
      see: 'Contact arrives nearer than a reaching step, with a soft knee and modest shin angle.',
      avoid: 'This is a feel cue, not an exact landing point. Do not force a forefoot strike.',
      release: 'Let the foot choose its own landing.'
    },
    {
      feel: 'Meet the ground · do not chase it',
      see: 'The thigh finishes forwards as the lower leg returns underneath.',
      avoid: 'Do not shorten the stride deliberately; let cadence and pace organise it.',
      release: 'Eyes up · let the next steps happen.'
    },
    {
      feel: 'Knee forwards · foot returning',
      see: 'Late swing prepares downwards rather than reaching farther forwards.',
      avoid: 'Do not stamp down. Think direction, then let it happen.',
      release: 'Drop the picture · keep the rhythm.'
    },
    {
      feel: 'Pelvis passes · foot leaves',
      see: 'The body catches up to support quickly and continues through it.',
      avoid: 'Do not obsess over the exact landing point each step.',
      release: 'Let support pass behind you.'
    }
  ]),
  sit: Object.freeze([
    {
      feel: 'Crown tall · hips travel',
      see: 'Head, ribs and pelvis remain calmly related while normal breathing and rotation continue.',
      avoid: 'Do not arch the back or lift the chest hard.',
      release: 'Look far ahead · let height remain.'
    },
    {
      feel: 'Ribs ride above pockets',
      see: 'The torso projects from the ankles without a hinge at the waist.',
      avoid: 'Do not squeeze the glutes or lock the pelvis.',
      release: 'Leave the stack alone.'
    },
    {
      feel: 'Move over the ankle · stay long',
      see: 'The knee yields while the pelvis continues forwards instead of dropping back.',
      avoid: 'Do not prevent normal knee bend.',
      release: 'Let the knee soften without watching it.'
    },
    {
      feel: 'Knee soft · pockets through',
      see: 'Support passes beneath you while the body keeps travelling through the step.',
      avoid: 'Do not rush the foot off the ground.',
      release: 'Run forwards · stop arranging the pose.'
    }
  ]),
  knees: Object.freeze([
    {
      feel: 'Two rails under you',
      see: 'Each knee and foot keeps its own narrow forward track.',
      avoid: 'Do not force the legs wide.',
      release: 'See the path ahead, not the rails.'
    },
    {
      feel: 'Knees keep their lane',
      see: 'The model shows each knee and foot travelling in its own narrow forward corridor.',
      avoid: 'Do not hold the knees apart with tension.',
      release: 'Let each leg find its lane.'
    },
    {
      feel: 'Pockets balanced · feet stay separate',
      see: 'A sense of balance at the pockets can accompany two distinct forward leg paths.',
      avoid: 'Balanced is a feeling, not literal symmetry. Do not police every step or widen the stance deliberately.',
      release: 'Notice the corridor · then look ahead.'
    },
    {
      feel: 'Run forwards · not wider',
      see: 'The lane stays narrow but distinct rather than becoming a tightrope.',
      avoid: 'The aim is space, not a deliberately broad stance.',
      release: 'Let forward travel organise the feet.'
    }
  ]),
  arms: Object.freeze([
    {
      feel: 'Elbows brush back · hands soft',
      see: 'The elbows pulse behind while the hands return beside the ribs.',
      avoid: 'Do not pin the elbows or force a perfectly straight hand path.',
      release: 'Eyes ahead · let arms balance legs.'
    },
    {
      feel: 'Hands skim a soft inward arc',
      see: 'The hands travel mostly forwards and back with a small inward arc.',
      avoid: 'A slight front crossover can occur naturally; do not freeze the shoulders.',
      release: 'Let the arms choose their path.'
    },
    {
      feel: 'Shoulders quiet · elbows pulse',
      see: 'The arms counterbalance the legs while normal upper-body rotation continues.',
      avoid: 'Do not drive the hands forwards.',
      release: 'Drop the cue · keep the balance.'
    },
    {
      feel: 'Loose jaw · heavy elbows',
      see: 'Relaxed hands and shoulders allow a compact reciprocal swing.',
      avoid: 'Do not make the arm swing bigger to look powerful.',
      release: 'Look ahead · leave the arms alone.'
    }
  ]),
  tension: Object.freeze([
    {
      feel: 'Soft face · heavy hands',
      see: 'The jaw, fingers and shoulders stay quiet while rhythm continues below.',
      avoid: 'Do not hold relaxation as another task.',
      release: 'Notice the route · not your hands.'
    },
    {
      feel: 'Tall · not stiff',
      see: 'The body stays long with small natural movement through the trunk.',
      avoid: 'Do not brace the stomach or lift the shoulders.',
      release: 'Let the body move around that length.'
    },
    {
      feel: 'Long exhale · hands ungrip',
      see: 'The ribcage can expand while the head and pelvis continue their natural movement.',
      avoid: 'Do not control every breath.',
      release: 'Let the next breath arrive itself.'
    },
    {
      feel: 'Let the elbows hang',
      see: 'Bent arms swing from relaxed shoulders rather than clenched fists.',
      avoid: 'Do not force the arms backwards.',
      release: 'Leave the arms to the stride.'
    }
  ]),
  overthink: Object.freeze([
    {
      feel: 'One cue: through',
      see: 'The whole body keeps moving forwards as one connected rhythm.',
      avoid: 'Do not add a second cue.',
      release: 'Drop the word after ten breaths.'
    },
    {
      feel: 'Pockets level · then run',
      see: 'A calm pelvis gives the legs room without constant correction.',
      avoid: '“Pockets level” is a sensation of balance, not literal symmetry. You do not need to monitor every joint.',
      release: 'Look ahead · just run.'
    },
    {
      feel: 'Watch · feel · let go',
      see: 'The model gives one relationship, not a checklist to copy.',
      avoid: 'Do not turn the relationship into a checklist.',
      release: 'Release it as soon as the stride settles.'
    },
    {
      feel: 'Nothing to judge this stride',
      see: 'Variation from step to step is part of natural running.',
      avoid: 'Do not grade every step.',
      release: 'Let the next minute be running.'
    }
  ])
});

export function getFlowNeed(id) {
  return FLOW_NEEDS.find((item) => item.id === id) || FLOW_NEEDS[0];
}

export function getFlowCue(needId, index = 0) {
  const cues = FLOW_CUES[needId] || FLOW_CUES.flow;
  return cues[((index % cues.length) + cues.length) % cues.length];
}

export function sanitiseCueIndexes(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    FLOW_NEEDS.flatMap((need) => {
      const index = Number(value[need.id]);
      return Number.isInteger(index) && index >= 0 ? [[need.id, index]] : [];
    })
  );
}

export function sanitiseSavedCue(value) {
  if (!value || typeof value !== 'object') return null;
  const need = FLOW_NEEDS.find((item) => item.id === value.needId);
  const index = Number(value.index);
  if (!need || !Number.isInteger(index) || index < 0) return null;
  return { needId: need.id, index };
}

export function midstancePhase(preset) {
  const contactTravelCm = preset.speedMps * (preset.contactMs / 1000) * 100;
  const behindCm = Math.max(32, contactTravelCm - preset.landingOffsetCm);
  const target = preset.landingOffsetCm / (preset.landingOffsetCm + behindCm);
  const edge = 0.012;
  const slope = 1 / (1 - edge);
  let progress;
  if (target < (slope * edge) / 2) {
    progress = Math.sqrt((target * 2 * edge) / slope);
  } else if (target > 1 - (slope * edge) / 2) {
    progress = 1 - Math.sqrt(((1 - target) * 2 * edge) / slope);
  } else {
    progress = target / slope + edge / 2;
  }
  return progress * preset.stanceFraction;
}

export function flowPhase(need, preset) {
  return need.phase === 'midstance' ? midstancePhase(preset) : need.phase;
}

export function phaseLandmarks(preset) {
  return [
    { id: 'contact', label: 'Contact', short: 'Contact', phase: 0.012 },
    { id: 'load', label: 'Load response', short: 'Load', phase: Math.min(0.1, preset.stanceFraction * 0.31) },
    { id: 'midstance', label: 'Mid-stance', short: 'Mid-stance', phase: midstancePhase(preset) },
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
    text: 'Elbows travel mostly behind and forwards beside the ribs. Hands stay soft; individual inward travel can vary.',
    cue: 'Elbows brush back · hands stay soft'
  }
};

export function getPhaseInfo(phase, preset) {
  const t = ((phase % 1) + 1) % 1;
  const stance = preset.stanceFraction;
  const contactEnd = 0.045;
  const midstance = midstancePhase(preset);
  const loadEnd = Math.max(contactEnd + 0.01, (contactEnd + midstance) / 2);
  const midstanceEnd = (midstance + stance) / 2;
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
    text: 'Relaxed arms support counterbalance with mostly forward–back travel; inward hand travel can vary.',
    cue: 'Back'
  }
]);

export const EVIDENCE = Object.freeze([
  {
    label: 'Step-rate experiment',
    title: 'Cadence is a comparison—not a magic number.',
    text: 'At a fixed speed, 45 recreational runners taking 5–10% more steps shortened each step and reduced braking and knee loading. Ten percent also felt harder, so this lab starts from the runner’s pace model rather than prescribing 180.',
    link: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3022995/',
    linkText: 'Heiderscheit et al., 2011'
  },
  {
    label: 'Arm-swing experiment',
    title: 'Arms balance rotation—not a pose to manufacture.',
    text: 'In 13 adults, restricting normal arm swing increased shoulder and pelvis rotation and raised net metabolic demand. The useful principle is natural counterbalance, not one compulsory hand path.',
    link: 'https://journals.biologists.com/jeb/article/217/14/2456/12120/The-metabolic-cost-of-human-running-is-swinging',
    linkText: 'Arellano & Kram, 2014'
  },
  {
    label: 'Kenyan gait research',
    title: 'Short contact is observed—not commanded.',
    text: 'Small studies of elite Kenyan runners reported comparatively short ground contacts and slim distal limbs. The samples were limited, so this app treats them as context rather than an “optimal” score.',
    link: 'https://www.jssm.org/volume07/iss4/cap/jssm-07-499.pdf',
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
  },
  {
    label: 'Attention experiment',
    title: 'A useful cue should eventually disappear.',
    text: 'Continuous attention to breathing or running movement made 12 runners less economical than a distraction condition. This lab therefore uses one cue briefly and then removes it.',
    link: 'https://doi.org/10.1080/02640414.2018.1522697',
    linkText: 'Schücker & Parrington, 2019'
  }
]);
