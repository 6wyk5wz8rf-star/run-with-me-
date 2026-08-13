export const PRE_RUN_STEPS = Object.freeze(['run', 'notice', 'see', 'feel', 'go']);

export const RUN_TYPES = Object.freeze([
  {
    id: 'recovery',
    label: 'Recovery',
    note: 'Your very gentle effort',
    paceIndex: 0,
    launch: 'Begin softer than you think. Reassess after ten easy breaths.'
  },
  {
    id: 'easy',
    label: 'Easy or long',
    note: 'Your conversational effort',
    paceIndex: 1,
    launch: 'Visit the cue for ten breaths. Then let the route take your attention.'
  },
  {
    id: 'steady',
    label: 'Steady',
    note: 'Your controlled effort',
    paceIndex: 2,
    launch: 'Use the cue for ten breaths, then release it. Keep the effort calm and continuous.'
  },
  {
    id: 'workout',
    label: 'Faster work',
    note: 'Your purposeful session',
    paceIndex: 1,
    launch: 'Use the cue for ten breaths in the easy warm-up. Hard repetitions are not the place to manage every joint.'
  }
]);

const DAILY_THEMES = Object.freeze([
  'Quiet momentum',
  'Room to move',
  'Light attention',
  'Calm beginning',
  'Forward ease',
  'Enough, not perfect',
  'Let rhythm emerge'
]);

const NEED_PRIMERS = Object.freeze({
  flow: Object.freeze([
    'Walk eight easy steps. Feel the body continue past each foot without adding a push.',
    'Stand tall enough, soften both knees, then let each foot feel loose for a moment.',
    'Make one tiny whole-body rock from the ankles, then simply walk forwards.',
    'Choose a point ahead and take eight unhurried steps towards it. Let the body organise itself.'
  ]),
  reach: Object.freeze([
    'Take six easy walking steps. Let contact arrive without reaching for the ground.',
    'March six relaxed steps and sense each foot returning beneath you before it meets the floor.',
    'Lift one knee naturally, let the lower leg hang, then place the foot without stamping. Swap sides.',
    'Walk forwards and feel your body keep travelling over each quiet contact.'
  ]),
  sit: Object.freeze([
    'Stand naturally, exhale once and make a tiny ankle rock with head, ribs and pockets travelling together.',
    'Let the ribs rest above the pockets. Soften the knees and take six easy steps without lifting the chest.',
    'Grow long through the crown, keep the waist easy and walk forwards for eight steps.',
    'Take six slow steps. Let each knee soften while the pockets keep moving through.'
  ]),
  knees: Object.freeze([
    'March six relaxed steps at your natural width. Sense two narrow paths without looking down.',
    'Walk eight steps and let each knee travel forwards in its own space. Do not hold the legs apart.',
    'Stand with easy feet, soften the pockets, then walk without trying to correct the width.',
    'Choose a point ahead and take eight steps towards it. Think forwards, not wider.'
  ]),
  arms: Object.freeze([
    'Walk eight steps and let the opposite elbow drift back. Keep both hands unshaped and easy.',
    'Let the arms hang, then walk with a soft inward hand arc. Do not steer them into rails.',
    'Take eight steps with quiet shoulders and a small backward elbow pulse.',
    'Uncurl the fingers, let the elbows feel heavy and walk until the arms answer the legs on their own.'
  ]),
  tension: Object.freeze([
    'Take one unforced long exhale. Uncurl the fingers once, then leave them alone.',
    'Let the shoulders drop without pushing them down. Take six steps with the jaw easy.',
    'Breathe out naturally, feel the hands become heavy, then look ahead rather than checking them.',
    'Let both elbows hang for a moment. Walk eight steps without trying to manufacture relaxation.'
  ]),
  overthink: Object.freeze([
    'Pick one landmark ahead. Name its colour or shape, then take eight steps without grading them.',
    'Choose one word—through—then walk for ten breaths and drop the word.',
    'Look ahead, notice three things in the environment and let your stride remain unjudged.',
    'Take eight ordinary steps. Your only task is to arrive at step eight, not to improve them.'
  ])
});

export const NEED_INSIGHTS = Object.freeze({
  flow: 'Ease is coordination, not a pose. The useful reference is forward continuity with no single joint taking over.',
  reach: 'A quieter meeting does not require a forefoot strike or a magic cadence. Contact changes with speed and with the runner.',
  sit: 'More lean is not automatically better. Look for unforced length through the whole body, not a manufactured angle.',
  knees: 'Two rails are a feeling, not a target width. Natural step width varies, and the legs should never be forced apart.',
  arms: 'Arms counterbalance the legs. A small inward arc can be natural; ease matters more than parallel hand paths.',
  tension: 'Relaxation is permission, not another position to hold. One release is enough; continued checking can become more tension.',
  overthink: 'Continuous movement-checking can cost ease. Use one cue briefly, then return attention to the route.'
});

const positiveModulo = (value, length) => ((value % length) + length) % length;
const CUE_COUNTS = Object.freeze({
  flow: 4,
  reach: 4,
  sit: 4,
  knees: 4,
  arms: 4,
  tension: 4,
  overthink: 4
});

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDayNumber(date = new Date()) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}

export function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function dailyIndex(date, length, salt = '') {
  if (!Number.isInteger(length) || length < 1) return 0;
  return positiveModulo(localDayNumber(date) + stableHash(salt), length);
}

export function getRunType(id) {
  return RUN_TYPES.find((item) => item.id === id) || null;
}

export function buildDailyPlan(
  date,
  needId,
  cueCount,
  cueOffset = 0,
  excludedCueIndexes = []
) {
  const count = Math.max(1, Number.isInteger(cueCount) ? cueCount : 1);
  const safeOffset = Number.isInteger(cueOffset) ? cueOffset : 0;
  const baseIndex = dailyIndex(date, count, `cue:${needId}`);
  const orderedIndexes = Array.from(
    { length: count },
    (_, index) => positiveModulo(baseIndex + index, count)
  );
  const exclusions = Array.isArray(excludedCueIndexes)
    ? excludedCueIndexes.filter((index) => Number.isInteger(index))
    : [];
  const hardExclusionCount = Number.isInteger(excludedCueIndexes?.hardCount)
    ? Math.max(0, excludedCueIndexes.hardCount)
    : exclusions.length;
  const hardExcluded = new Set(exclusions.slice(0, hardExclusionCount));
  const allExcluded = new Set(exclusions);
  const hardAvailable = orderedIndexes.filter((index) => !hardExcluded.has(index));
  const fullyAvailable = hardAvailable.filter((index) => !allExcluded.has(index));
  const availableIndexes = fullyAvailable.length >= 2
    ? fullyAvailable
    : hardAvailable;
  const candidates = availableIndexes.length ? availableIndexes : [];
  const cueIndex = candidates.length
    ? candidates[positiveModulo(safeOffset, candidates.length)]
    : null;
  const primers = NEED_PRIMERS[needId] || NEED_PRIMERS.flow;

  return Object.freeze({
    dateKey: localDateKey(date),
    theme: DAILY_THEMES[dailyIndex(date, DAILY_THEMES.length, 'theme')],
    cueIndex,
    candidateCount: candidates.length,
    rehearsal: cueIndex === null
      ? 'Pick one landmark ahead. Notice its shape or colour, then let the run be ordinary.'
      : primers[dailyIndex(date, primers.length, `primer:${needId}`)],
    insight: NEED_INSIGHTS[needId] || NEED_INSIGHTS.flow
  });
}

export function createDailySession(dateKey) {
  return {
    version: 1,
    dateKey,
    runNumber: 0,
    step: 'run',
    runType: null,
    needId: null,
    cueOffset: 0,
    completed: false,
    completedAt: null,
    outcome: null
  };
}

export function sanitiseDailySession(value, dateKey) {
  const fresh = createDailySession(dateKey);
  if (!value || typeof value !== 'object' || value.version !== 1) return fresh;
  if (value.dateKey !== dateKey) return fresh;

  const runType = getRunType(value.runType)?.id || null;
  if (!runType) return fresh;
  const validNeeds = new Set(Object.keys(NEED_PRIMERS));
  const needId = validNeeds.has(value.needId) ? value.needId : null;
  let step = PRE_RUN_STEPS.includes(value.step) ? value.step : 'run';

  if (!needId && !['run', 'notice'].includes(step)) step = 'notice';

  const cueOffset = Number.isInteger(value.cueOffset)
    ? Math.max(0, Math.min(99, value.cueOffset))
    : 0;
  const runNumber = Number.isSafeInteger(value.runNumber)
    ? Math.max(0, value.runNumber)
    : 0;
  const completed = Boolean(value.completed && step === 'go' && runType && needId);
  const outcome = completed && ['easier', 'same', 'worse'].includes(value.outcome)
    ? value.outcome
    : null;

  return {
    version: 1,
    dateKey,
    runNumber,
    step,
    runType,
    needId,
    cueOffset,
    completed,
    completedAt:
      completed && typeof value.completedAt === 'string' ? value.completedAt : null,
    outcome
  };
}

export function sanitiseDailyHistory(value) {
  if (!Array.isArray(value)) return [];
  const entries = value
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      if (!validDateKey(entry.dateKey)) return [];
      if (!getRunType(entry.runType)) return [];
      if (!Object.hasOwn(NEED_PRIMERS, entry.needId)) return [];
      const cueIndex = entry.cueIndex;
      if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= CUE_COUNTS[entry.needId]) return [];
      const outcome = ['easier', 'same', 'worse'].includes(entry.outcome)
        ? entry.outcome
        : null;
      const runNumber = Number.isSafeInteger(entry.runNumber)
        ? Math.max(0, entry.runNumber)
        : 0;
      return [{
        dateKey: entry.dateKey,
        runNumber,
        runType: entry.runType,
        needId: entry.needId,
        cueIndex,
        outcome
      }];
    });
  const unique = new Map();
  for (const entry of entries) {
    const key = `${entry.dateKey}:${entry.runNumber}`;
    if (unique.has(key)) unique.delete(key);
    unique.set(key, entry);
  }
  return [...unique.values()].slice(-14);
}

export function nextPreRunStep(step) {
  const index = PRE_RUN_STEPS.indexOf(step);
  return PRE_RUN_STEPS[Math.min(PRE_RUN_STEPS.length - 1, Math.max(0, index + 1))];
}

export function previousPreRunStep(step) {
  const index = PRE_RUN_STEPS.indexOf(step);
  return PRE_RUN_STEPS[Math.max(0, index - 1)];
}

export function mostFrequentNeed(history) {
  const safeHistory = sanitiseDailyHistory(history);
  if (safeHistory.length < 3) return null;
  const counts = new Map();
  for (const entry of safeHistory) {
    counts.set(entry.needId, (counts.get(entry.needId) || 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [needId, count] = ordered[0] || [];
  if (!needId) return null;
  const tied = ordered[1]?.[1] === count;
  return count >= 3 && !tied
    ? { needId, count, total: safeHistory.length }
    : null;
}
