import {
  DEFAULT_TUNING,
  EVIDENCE,
  FLOW_CUES,
  FLOW_NEEDS,
  PACE_PRESETS,
  PRINCIPLES,
  PROFILE,
  TUNE_CONTROLS,
  flowPhase,
  getFlowCue,
  getFlowNeed,
  getObservation,
  getPhaseInfo,
  phaseLandmarks,
  sanitiseCueIndexes,
  sanitiseSavedCue,
  sanitiseTuning,
  tuneRangeFor,
  tunePace
} from './data.js';
import { buildTrace, computeSidePose, wrap01 } from './kinematics.js';
import { renderStage } from './renderer.js';
import {
  PRE_RUN_STEPS,
  RUN_TYPES,
  buildDailyPlan,
  createDailySession,
  getRunType,
  localDateKey,
  mostFrequentNeed,
  previousPreRunStep,
  sanitiseDailyHistory,
  sanitiseDailySession
} from './pre-run.js';

const STORAGE_KEY = 'rift-form-lab-preferences-v1';
const DAILY_STORAGE_KEY = 'rift-form-lab-daily-v1';
const HISTORY_STORAGE_KEY = 'rift-form-lab-history-v1';
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const compactLayout = window.matchMedia('(max-width: 820px)');
let prefersReducedMotion = motionPreference.matches;

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

function loadPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadLocalJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

const saved = loadPreferences();
const today = new Date();
const dailySession = sanitiseDailySession(
  loadLocalJSON(DAILY_STORAGE_KEY),
  localDateKey(today)
);
const dailyHistory = sanitiseDailyHistory(loadLocalJSON(HISTORY_STORAGE_KEY));
const savedRunType = getRunType(dailySession.runType);
const savedPace = Number(saved?.paceIndex);
const savedNeed = dailySession.needId || (
  FLOW_NEEDS.some((item) => item.id === saved?.flowNeed) ? saved.flowNeed : 'flow'
);

const state = {
  mode: saved?.mode === 'inspect' ? 'inspect' : 'flow',
  paceIndex:
    savedRunType
      ? savedRunType.paceIndex
      : Number.isInteger(savedPace) && savedPace >= 0 && savedPace < PACE_PRESETS.length
      ? savedPace
      : 1,
  phase: 0.1,
  playing: false,
  playback: 0.35,
  view: getFlowNeed(savedNeed).view,
  lens: getFlowNeed(savedNeed).lens,
  contrast: 'overreach',
  flowNeed: savedNeed,
  flowStep: dailySession.step,
  daily: dailySession,
  history: dailyHistory,
  cueIndexes: sanitiseCueIndexes(saved?.cueIndexes),
  savedCue: sanitiseSavedCue(saved?.savedCue),
  activeTune: TUNE_CONTROLS.some((item) => item.id === saved?.activeTune)
    ? saved.activeTune
    : 'rhythm',
  tuning: sanitiseTuning(saved?.tuning),
  overlays: {
    geometry: true,
    forces: true,
    trail: false
  }
};

const elements = Object.fromEntries(
  [
    'runnerCanvas',
    'labGrid',
    'stageCard',
    'analysisCard',
    'flowCoach',
    'flowPractice',
    'flowPracticeSlot',
    'modeTabs',
    'paceTabs',
    'paceSelect',
    'paceReadout',
    'paceName',
    'playButton',
    'playButtonText',
    'flowPauseButton',
    'flowStageActionButton',
    'playbackLabel',
    'playbackHint',
    'speedTabs',
    'resetButton',
    'viewTabs',
    'overlayButtons',
    'contrastOptions',
    'phaseSlider',
    'phasePercent',
    'phaseButtons',
    'stanceWindow',
    'timelineMarker',
    'stageViewLabel',
    'stageFocusLabel',
    'stagePhaseLabel',
    'canvasDescription',
    'dailyDate',
    'dailyTheme',
    'flow-coach-title',
    'runTypeTabs',
    'needTabs',
    'safetyCheck',
    'flowNeedPrompt',
    'flowStatus',
    'changeNeedButton',
    'flowSteps',
    'flowCueCard',
    'flowCueLabel',
    'flowCueText',
    'flowCueSee',
    'flowInsight',
    'flowInsightText',
    'flowBoundary',
    'flowCueAvoid',
    'cueActions',
    'flowActionButton',
    'anotherCueButton',
    'flowBackButton',
    'completedRun',
    'completedCue',
    'completedGuidance',
    'personalInsight',
    'afterRun',
    'outcomeResponse',
    'startAnotherRun',
    'tunePanel',
    'tuneTabs',
    'tuneLabel',
    'tuneShort',
    'tuneOutput',
    'tuneSlider',
    'tuneDescription',
    'tuneLow',
    'tuneHigh',
    'tuneResetButton',
    'phaseNumber',
    'analysis-title',
    'phaseRange',
    'lensTabs',
    'observationTitle',
    'observationText',
    'cueText',
    'hipAngle',
    'hipAngleName',
    'kneeAngle',
    'ankleAngle',
    'ankleAngleName',
    'traceMarker',
    'comTracePath',
    'forceTracePath',
    'cadenceMetric',
    'contactMetric',
    'flightMetric',
    'stepMetric',
    'dutyMetric',
    'bounceMetric',
    'principleGrid',
    'evidenceGrid'
  ].map((id) => [id, document.getElementById(id)])
);

const basePace = () => PACE_PRESETS[state.paceIndex];
let paceCache = tunePace(basePace(), state.tuning);
const currentPace = () => paceCache;
const refreshPace = () => {
  paceCache = tunePace(
    basePace(),
    state.mode === 'flow' ? DEFAULT_TUNING : state.tuning
  );
  return paceCache;
};

function syncResponsiveLayout() {
  const focused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const mobileFlow = compactLayout.matches && state.mode === 'flow';
  if (mobileFlow) {
    elements.labGrid.insertBefore(elements.analysisCard, elements.stageCard);
    elements.flowPracticeSlot.append(elements.flowPractice, elements.tunePanel);
  } else {
    elements.flowCoach.append(elements.flowPractice);
    elements.flowCoach.after(elements.tunePanel);
    elements.labGrid.insertBefore(elements.stageCard, elements.analysisCard);
    elements.labGrid.insertBefore(elements.flowPracticeSlot, elements.analysisCard);
  }
  if (focused?.isConnected && focused.getClientRects().length) {
    focused.focus({ preventScroll: true });
  }
}

function focusSoon(element, { scroll = false, block = 'center' } = {}) {
  const focus = () => {
    if (!element || element.hidden || element.getClientRects().length === 0) return;
    element.focus({ preventScroll: !scroll });
  };
  focus();
  requestAnimationFrame(() => {
    if (document.activeElement !== element) focus();
    if (scroll && element?.getClientRects().length) {
      element.scrollIntoView({
        block,
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    }
  });
}

function dateFromLocalKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function currentDailyPlan() {
  const cueCount = FLOW_CUES[state.flowNeed]?.length || FLOW_CUES.flow.length;
  const priorForNeed = state.history.filter(
    (entry) =>
      entry.needId === state.flowNeed &&
      (entry.dateKey !== state.daily.dateKey || entry.runNumber !== state.daily.runNumber)
  );
  const recentIndexes = priorForNeed.slice(-2).map((entry) => entry.cueIndex);
  const worseIndexes = priorForNeed
    .filter((entry) => entry.outcome === 'worse')
    .map((entry) => entry.cueIndex);
  const exclusions = [...new Set([...worseIndexes, ...recentIndexes])];
  exclusions.hardCount = new Set(worseIndexes).size;
  return buildDailyPlan(
    dateFromLocalKey(state.daily.dateKey),
    state.flowNeed,
    cueCount,
    state.daily.cueOffset,
    exclusions
  );
}

function nextCue() {
  const candidateCount = currentDailyPlan().candidateCount;
  state.daily.cueOffset = candidateCount > 1
    ? (state.daily.cueOffset + 1) % candidateCount
    : 0;
  persistDailySession();
}

function currentCueAndPlan() {
  const plan = currentDailyPlan();
  if (plan.cueIndex === null) {
    return {
      plan,
      cue: {
        feel: 'Look ahead · run natural',
        see: 'No form cue is offered today. Let the environment carry your attention.',
        avoid: 'Do not search for another correction. Ordinary running is enough.',
        release: 'Leave the body alone · follow the route.'
      }
    };
  }
  return { plan, cue: getFlowCue(state.flowNeed, plan.cueIndex) };
}

function persistDailySession() {
  try {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state.daily));
  } catch {
    // The daily setup still works in memory when storage is unavailable.
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history));
  } catch {
    // Reflection history is optional and remains device-local.
  }
}
let needsRender = true;
let animationReady = false;
let animationFrame = 0;

function requestRender() {
  needsRender = true;
  if (animationReady) ensureAnimation();
}

function persistPreferences() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        mode: state.mode,
        paceIndex: state.paceIndex,
        flowNeed: state.flowNeed,
        cueIndexes: state.cueIndexes,
        savedCue: state.savedCue,
        activeTune: state.activeTune,
        tuning: state.tuning
      })
    );
  } catch {
    // Device storage is optional.
  }
}

function buildPaceTabs() {
  elements.paceTabs.innerHTML = PACE_PRESETS.map(
    (pace, index) => `
      <button type="button" data-index="${index}" class="${index === state.paceIndex ? 'active' : ''}" aria-pressed="${index === state.paceIndex}">
        ${pace.label}<span>${pace.pace} /km</span>
      </button>`
  ).join('');

  elements.paceSelect.innerHTML = PACE_PRESETS.map(
    (pace, index) =>
      `<option value="${index}">${pace.label} · ${pace.pace} /km</option>`
  ).join('');
  elements.paceSelect.value = String(state.paceIndex);

  for (const button of elements.paceTabs.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.paceIndex = Number(button.dataset.index);
      persistPreferences();
      updatePaceUI();
    });
  }

  elements.paceSelect.addEventListener('change', () => {
    state.paceIndex = Number(elements.paceSelect.value);
    persistPreferences();
    updatePaceUI();
  });
}

function buildPhaseButtons() {
  elements.phaseButtons.innerHTML = phaseLandmarks(currentPace())
    .map(
      (phase) => `
        <button type="button" data-phase="${phase.phase}" data-phase-id="${phase.id}" aria-pressed="false">
          ${phase.short}
        </button>`
    )
    .join('');

  for (const button of elements.phaseButtons.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.phase = Number(button.dataset.phase);
      state.playing = false;
      syncPlayButton();
      updateFrameUI();
      requestRender();
    });
  }
}

function buildNeedTabs() {
  elements.needTabs.innerHTML = FLOW_NEEDS.map(
    (need) => `
      <button type="button" data-need="${need.id}" aria-pressed="${need.id === state.flowNeed}" class="${need.id === state.flowNeed ? 'active' : ''}">
        ${need.label}
      </button>`
  ).join('');

  for (const button of elements.needTabs.querySelectorAll('button')) {
    button.addEventListener('click', () => setFlowNeed(button.dataset.need));
  }
}

function buildRunTypeTabs() {
  elements.runTypeTabs.innerHTML = RUN_TYPES.map(
    (run) => `
      <button type="button" data-run-type="${run.id}" aria-pressed="${run.id === state.daily.runType}" class="${run.id === state.daily.runType ? 'active' : ''}">
        <b>${run.label}</b><span>${run.note}</span>
      </button>`
  ).join('');

  for (const button of elements.runTypeTabs.querySelectorAll('button')) {
    button.addEventListener('click', () => selectRunType(button.dataset.runType));
  }
}

function buildTuneTabs() {
  elements.tuneTabs.innerHTML = TUNE_CONTROLS.map(
    (control) => `
      <button type="button" data-tune="${control.id}" aria-pressed="${control.id === state.activeTune}" class="${control.id === state.activeTune ? 'active' : ''}">
        ${control.label}
      </button>`
  ).join('');

  for (const button of elements.tuneTabs.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.activeTune = button.dataset.tune;
      persistPreferences();
      updateTuneUI();
    });
  }
}

function buildPrinciples() {
  elements.principleGrid.innerHTML = PRINCIPLES.map(
    (principle) => `
      <article class="principle-card ${principle.id === state.lens ? 'active' : ''}" data-lens="${principle.id}">
        <span>${principle.number}</span>
        <h3>${principle.title}</h3>
        <p>${principle.text}</p>
        <b aria-hidden="true">${principle.cue}</b>
        <button type="button" class="principle-action" data-principle-action data-lens="${principle.id}" aria-label="Inspect ${principle.title}" aria-pressed="${principle.id === state.lens}"></button>
      </article>`
  ).join('');

  for (const action of elements.principleGrid.querySelectorAll('[data-principle-action]')) {
    action.addEventListener('click', () => {
      setLens(action.dataset.lens);
      document.querySelector('.lab-grid').scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start'
      });
      focusSoon(
        elements.lensTabs.querySelector(`[data-lens="${action.dataset.lens}"]`)
      );
    });
  }
}

function buildEvidence() {
  elements.evidenceGrid.innerHTML = EVIDENCE.map(
    (item) => `
      <details class="evidence-card">
        <summary>
          <span>${item.label}</span>
          <h3>${item.title}</h3>
          <b aria-hidden="true">+</b>
        </summary>
        <div class="evidence-body">
          <p>${item.text}</p>
          <a href="${item.link}" target="_blank" rel="noreferrer">Read ${item.linkText} ↗</a>
        </div>
      </details>`
  ).join('');
}

function syncLensButtons() {
  for (const button of elements.lensTabs.querySelectorAll('button')) {
    const active = button.dataset.lens === state.lens;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const card of elements.principleGrid.querySelectorAll('.principle-card')) {
    const active = card.dataset.lens === state.lens;
    card.classList.toggle('active', active);
    card.querySelector('[data-principle-action]')?.setAttribute('aria-pressed', String(active));
  }
}

function setLens(lens) {
  state.lens = lens;
  syncLensButtons();
  updateFrameUI();
  requestRender();
}

function syncViewButtons() {
  for (const button of elements.viewTabs.querySelectorAll('button')) {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.contrastOptions.hidden = state.view !== 'contrast';
}

function formatDailyDate(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  }).format(date);
}

function selectRunType(id) {
  const run = getRunType(id);
  if (!run) return;
  state.daily.runType = run.id;
  state.daily.needId = null;
  state.daily.cueOffset = 0;
  state.daily.completed = false;
  state.daily.completedAt = null;
  state.daily.outcome = null;
  state.paceIndex = run.paceIndex;
  buildRunTypeTabs();
  persistDailySession();
  persistPreferences();
  updatePaceUI();
  setFlowStep('notice');
  focusSoon(elements['flow-coach-title'], {
    scroll: compactLayout.matches,
    block: 'start'
  });
}

function setFlowNeed(id) {
  const need = getFlowNeed(id);
  const changed = state.daily.needId !== need.id;
  state.flowNeed = need.id;
  state.daily.needId = need.id;
  if (changed) state.daily.cueOffset = 0;
  state.daily.completed = false;
  state.daily.completedAt = null;
  state.daily.outcome = null;
  state.lens = need.lens;
  state.view = need.view;
  state.activeTune = need.tune || state.activeTune;
  state.phase = flowPhase(need, currentPace());
  state.playing = false;
  persistDailySession();
  syncLensButtons();
  syncViewButtons();
  syncPlayButton();
  updateTuneUI();
  persistPreferences();
  setFlowStep('see');
  focusSoon(elements['flow-coach-title'], {
    scroll: compactLayout.matches,
    block: 'start'
  });
}

function setFlowStep(step) {
  if (!PRE_RUN_STEPS.includes(step)) return;
  state.flowStep = step;
  state.daily.step = step;
  if (step === 'see') {
    state.phase = flowPhase(getFlowNeed(state.flowNeed), currentPace());
    state.playing = false;
  } else if (step === 'feel') {
    state.playing = !prefersReducedMotion;
  } else {
    state.playing = false;
  }
  persistDailySession();
  syncPlayButton();
  updateFlowUI();
  updateFrameUI();
  requestRender();
}

function updateHistoryEntry() {
  if (!state.daily.runType || !state.daily.needId) return;
  const plan = currentDailyPlan();
  if (plan.cueIndex === null) return;
  const entry = {
    dateKey: state.daily.dateKey,
    runNumber: state.daily.runNumber,
    runType: state.daily.runType,
    needId: state.daily.needId,
    cueIndex: plan.cueIndex,
    outcome: state.daily.outcome
  };
  state.history = sanitiseDailyHistory([
    ...state.history.filter(
      (item) =>
        item.dateKey !== entry.dateKey || item.runNumber !== entry.runNumber
    ),
    entry
  ]);
  persistHistory();
}

function completeDailySetup() {
  const { plan } = currentCueAndPlan();
  state.daily.step = 'go';
  state.flowStep = 'go';
  state.daily.completed = true;
  state.daily.completedAt = new Date().toISOString();
  state.savedCue = plan.cueIndex === null
    ? null
    : { needId: state.flowNeed, index: plan.cueIndex };
  state.playing = false;
  persistDailySession();
  persistPreferences();
  updateHistoryEntry();
  syncPlayButton();
  updateFlowUI();
  requestRender();
  focusSoon(elements.completedCue);
}

function restartDailySetup({ anotherRun = false } = {}) {
  const previousRunNumber = state.daily.runNumber;
  state.daily = createDailySession(localDateKey());
  state.daily.runNumber = anotherRun
    ? previousRunNumber + 1
    : previousRunNumber;
  state.flowStep = 'run';
  state.flowNeed = 'flow';
  state.view = getFlowNeed('flow').view;
  state.lens = getFlowNeed('flow').lens;
  state.playing = false;
  persistDailySession();
  buildRunTypeTabs();
  syncViewButtons();
  syncLensButtons();
  syncPlayButton();
  updateFlowUI();
  updateFrameUI();
  requestRender();
  focusSoon(elements['flow-coach-title'], {
    scroll: compactLayout.matches,
    block: 'start'
  });
}

function updateFlowUI() {
  const sessionDate = dateFromLocalKey(state.daily.dateKey);
  const need = getFlowNeed(state.flowNeed);
  const { plan, cue } = currentCueAndPlan();
  const run = getRunType(state.daily.runType);
  const currentIndex = PRE_RUN_STEPS.indexOf(state.flowStep);
  const titles = {
    run: 'What kind of run is this?',
    notice: 'What is most noticeable?',
    see: 'See one relationship.',
    feel: 'Try it once.',
    go: state.daily.completed ? 'You are ready.' : 'Take one thing.'
  };
  const prompts = {
    run: 'Choose the effort, not a target pace.',
    notice: 'Choose one—or choose nothing. This is a feeling, not a diagnosis.',
    see: need.prompt,
    feel: 'About ten seconds. This primes attention; it is not your physical warm-up.',
    go: state.daily.completed
      ? 'Nothing else to solve before you leave.'
      : 'Use it briefly, then let the cue disappear.'
  };

  document.body.dataset.flowStep = state.flowStep;
  document.body.dataset.flowNeed = need.id;
  document.body.dataset.flowComplete = String(state.daily.completed);
  const runCountLabel = state.daily.runNumber
    ? ` · run ${state.daily.runNumber + 1}`
    : '';
  elements.dailyDate.textContent = `${formatDailyDate(sessionDate)} · before your run${runCountLabel}`;
  elements.dailyTheme.textContent = plan.theme;
  elements['flow-coach-title'].textContent = titles[state.flowStep];
  elements.flowNeedPrompt.textContent = prompts[state.flowStep];
  elements.changeNeedButton.hidden = state.flowStep === 'run' && !state.daily.completed;

  for (const button of elements.runTypeTabs.querySelectorAll('button')) {
    const active = button.dataset.runType === state.daily.runType;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of elements.needTabs.querySelectorAll('button')) {
    const active = button.dataset.need === state.daily.needId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const marker of elements.flowSteps.querySelectorAll('[data-step]')) {
    const index = PRE_RUN_STEPS.indexOf(marker.dataset.step);
    const active = marker.dataset.step === state.flowStep;
    marker.classList.toggle('active', active);
    marker.classList.toggle('complete', index < currentIndex || (state.daily.completed && index === currentIndex));
    if (active) marker.setAttribute('aria-current', 'step');
    else marker.removeAttribute('aria-current');
  }

  elements.runTypeTabs.hidden = state.flowStep !== 'run' || state.daily.completed;
  elements.needTabs.hidden = state.flowStep !== 'notice' || state.daily.completed;
  elements.safetyCheck.hidden = state.flowStep !== 'notice' || state.daily.completed;
  elements.flowPractice.hidden = !['see', 'feel', 'go'].includes(state.flowStep);
  elements.flowCueCard.hidden = ['run', 'notice'].includes(state.flowStep) || state.daily.completed;
  elements.completedRun.hidden = !(state.flowStep === 'go' && state.daily.completed);
  elements.flowCueCard.dataset.step = state.flowStep;
  elements.flowInsight.hidden = state.flowStep !== 'see';
  elements.flowBoundary.hidden = !['see', 'feel'].includes(state.flowStep);
  elements.anotherCueButton.hidden = state.flowStep !== 'see';
  elements.flowBackButton.hidden = !['see', 'feel', 'go'].includes(state.flowStep);

  if (state.flowStep === 'see') {
    elements.flowCueLabel.textContent = 'Today’s relationship';
    elements.flowCueText.textContent = cue.feel;
    elements.flowCueSee.textContent = cue.see;
    elements.flowInsightText.textContent = `${plan.insight} ${
      run?.id === 'workout'
        ? 'For faster work, experiment only during the easy warm-up.'
        : 'For today, one brief experiment is enough.'
    }`;
    elements.flowCueAvoid.textContent = cue.avoid;
    elements.flowActionButton.textContent = plan.cueIndex === null
      ? 'Run without a cue'
      : 'Use this cue';
    elements.anotherCueButton.textContent = 'Show another';
    elements.anotherCueButton.hidden = plan.candidateCount < 2;
  } else if (state.flowStep === 'feel') {
    elements.flowCueLabel.textContent = 'Small rehearsal';
    elements.flowCueText.textContent = plan.rehearsal;
    elements.flowCueSee.textContent = 'Do it once, gently. There is nothing to perfect.';
    elements.flowCueAvoid.textContent = cue.avoid;
    elements.flowActionButton.textContent = 'Done';
    elements.anotherCueButton.textContent = 'Skip rehearsal';
    elements.anotherCueButton.hidden = false;
  } else if (state.flowStep === 'go') {
    elements.flowCueLabel.textContent = 'Today’s cue';
    elements.flowCueText.textContent = cue.feel;
    elements.flowCueSee.textContent = `${cue.release} ${run?.launch || RUN_TYPES[1].launch} If it feels tighter or worse, drop it immediately.`;
    elements.flowActionButton.textContent = 'Ready to run';
  }

  elements.flowStageActionButton.textContent = 'Done';
  elements.flowStatus.textContent = `Step ${currentIndex + 1} of 5. ${titles[state.flowStep]} ${prompts[state.flowStep]}`;

  if (state.daily.completed) {
    elements.completedCue.textContent = cue.feel;
    elements.completedGuidance.textContent = `${cue.release} ${run?.launch || RUN_TYPES[1].launch} If it feels tighter or worse, drop it immediately.`;
    const pattern = mostFrequentNeed(state.history);
    if (pattern) {
      elements.personalInsight.hidden = false;
      elements.personalInsight.textContent = `Recent attention · you chose “${getFlowNeed(pattern.needId).label}” on ${pattern.count} of your last ${pattern.total} setups. This tracks where attention went—not a gait finding or score.`;
    } else {
      elements.personalInsight.hidden = true;
    }
    for (const button of elements.afterRun.querySelectorAll('[data-outcome]')) {
      const active = button.dataset.outcome === state.daily.outcome;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    elements.outcomeResponse.textContent = state.daily.outcome
      ? state.daily.outcome === 'easier'
        ? 'Keep it available, but give it space before it returns.'
        : state.daily.outcome === 'same'
          ? 'No difference is useful information. Nothing needs forcing.'
          : 'That cue will not be treated as a solution. Your natural stride wins.'
      : '';
    elements.afterRun.hidden = plan.cueIndex === null;
  }
}

function tracePath(points, xMap, yMap) {
  return points
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'} ${xMap(point).toFixed(2)} ${yMap(point).toFixed(2)}`
    )
    .join(' ');
}

function updateTrace() {
  const trace = buildTrace(currentPace(), 140);
  const minCom = Math.min(...trace.map((item) => item.comY));
  const maxCom = Math.max(...trace.map((item) => item.comY));
  const maxForce = Math.max(...trace.map((item) => item.force), 1);
  const xMap = (item) => 10 + item.phase * 340;
  const comY = (item) =>
    49 - ((item.comY - minCom) / (maxCom - minCom || 1)) * 25;
  const forceY = (item) => 101 - (item.force / maxForce) * 29;
  elements.comTracePath.setAttribute('d', tracePath(trace, xMap, comY));
  elements.forceTracePath.setAttribute('d', tracePath(trace, xMap, forceY));
  return maxCom - minCom;
}

function tuneOutput(control, pace) {
  if (control.id === 'rhythm') return `${pace.cadence} spm`;
  if (control.id === 'stack') return `${pace.leanDeg.toFixed(1)}°`;
  if (control.id === 'landing') return `${pace.landingOffsetCm.toFixed(1)} cm`;
  if (control.id === 'lane') return `${pace.stepWidthCm.toFixed(1)} cm`;
  return `${pace.armArcCm.toFixed(1)} model cm inward`;
}

function updateTuneUI() {
  const control =
    TUNE_CONTROLS.find((item) => item.id === state.activeTune) || TUNE_CONTROLS[0];
  const pace = currentPace();
  const range = tuneRangeFor(control, basePace());
  for (const button of elements.tuneTabs.querySelectorAll('button')) {
    const active = button.dataset.tune === control.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.tuneLabel.textContent = control.label;
  elements.tuneShort.textContent = control.short;
  elements.tuneOutput.textContent = tuneOutput(control, pace);
  elements.tuneDescription.textContent = control.description;
  elements.tuneLow.textContent = control.low;
  elements.tuneHigh.textContent = control.high;
  elements.tuneSlider.min = String(range.minimum);
  elements.tuneSlider.max = String(range.maximum);
  elements.tuneSlider.step = String(control.step);
  elements.tuneSlider.value = String(state.tuning[control.id]);
  elements.tuneSlider.setAttribute('aria-label', `Adjust ${control.label.toLowerCase()}`);
  elements.tuneSlider.setAttribute(
    'aria-valuetext',
    `${tuneOutput(control, pace)}, pace model ${state.tuning[control.id] === 0 ? 'unchanged' : 'adjusted'}`
  );
}

function updatePaceUI() {
  for (const control of TUNE_CONTROLS) {
    const range = tuneRangeFor(control, basePace());
    state.tuning[control.id] = clamp(
      state.tuning[control.id],
      range.minimum,
      range.maximum
    );
  }
  const pace = refreshPace();
  if (state.mode === 'flow' && state.flowStep === 'see') {
    state.phase = flowPhase(getFlowNeed(state.flowNeed), pace);
  }
  elements.paceReadout.textContent = pace.pace;
  elements.paceName.textContent = pace.label;
  elements.cadenceMetric.textContent = String(pace.cadence);
  elements.contactMetric.textContent = String(Math.round(pace.contactMs));
  elements.flightMetric.textContent = String(Math.round(pace.flightMs));
  elements.stepMetric.textContent = pace.stepLengthM.toFixed(2);
  elements.dutyMetric.textContent = pace.dutyPercent.toFixed(1);
  elements.bounceMetric.textContent = updateTrace().toFixed(1);
  elements.stanceWindow.style.width = `${pace.stanceFraction * 100}%`;

  for (const button of elements.paceTabs.querySelectorAll('button')) {
    const active = Number(button.dataset.index) === state.paceIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.paceSelect.value = String(state.paceIndex);
  buildPhaseButtons();
  updateTuneUI();
  updateFrameUI();
  requestRender();
}

function signedAngle(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}°`;
}

function updateFrameUI() {
  const pace = currentPace();
  const pose = computeSidePose(state.phase, pace, PROFILE);
  const phaseInfo = getPhaseInfo(state.phase, pace);
  const observation = getObservation(phaseInfo, state.lens);

  elements.phasePercent.textContent = `${Math.round(state.phase * 100)}%`;
  elements.phaseSlider.value = String(Math.round(state.phase * 1000));
  elements.phaseSlider.setAttribute(
    'aria-valuetext',
    `${Math.round(state.phase * 100)}%, ${phaseInfo.label.toLowerCase()}`
  );
  elements.timelineMarker.style.left = `${state.phase * 100}%`;
  elements.traceMarker.setAttribute('x1', String(10 + state.phase * 340));
  elements.traceMarker.setAttribute('x2', String(10 + state.phase * 340));

  elements.stagePhaseLabel.textContent = phaseInfo.label;
  elements.phaseNumber.textContent = phaseInfo.number;
  elements['analysis-title'].textContent = phaseInfo.label;
  elements.phaseRange.textContent = phaseInfo.range;
  elements.observationTitle.textContent = observation.title;
  elements.observationText.textContent = observation.text;
  elements.cueText.textContent = observation.cue;

  const hip = pose.lead.angles.hipFlexion;
  const knee = pose.lead.angles.kneeFlexion;
  const ankle = pose.lead.angles.ankleDorsiflexion;
  elements.hipAngle.textContent = signedAngle(hip);
  elements.hipAngleName.textContent = hip >= 0 ? 'flexion' : 'extension';
  elements.kneeAngle.textContent = `${Math.round(knee)}°`;
  elements.ankleAngle.textContent = `${Math.abs(Math.round(ankle))}°`;
  elements.ankleAngleName.textContent =
    ankle >= 0 ? 'dorsiflexion' : 'plantarflexion';

  const viewLabels = {
    side: 'Side view',
    rear: 'Rear view',
    contrast: 'Controlled contrast'
  };
  const focusLabels = {
    system: 'Whole flow',
    posture: 'Head · ribs · pockets',
    contact: state.view === 'rear' ? 'Two running rails' : 'Foot · shin · pelvis',
    recovery: 'Release · fold · carry',
    arms: 'Arm counterbalance'
  };
  elements.stageViewLabel.textContent = viewLabels[state.view];
  elements.stageFocusLabel.textContent =
    state.mode === 'flow' && state.flowStep === 'feel'
      ? 'Whole stride · cue in motion'
      : focusLabels[state.lens];
  const contrastDescriptions = {
    overreach: 'Comparison: the foot lands farther ahead of the pelvis with more braking.',
    waist: 'Comparison: the ribs move ahead of the pelvis and break the whole-body stack.',
    crossover: 'Comparison: the foot crosses the centre line and the knee follows inward.'
  };
  const contrastDescription = state.view === 'contrast'
    ? ` ${contrastDescriptions[state.contrast]}`
    : '';
  const flowDescription = state.mode === 'flow' && ['see', 'feel'].includes(state.flowStep)
    ? ` Selected relationship: ${currentCueAndPlan().cue.feel}.`
    : '';
  elements.canvasDescription.textContent = `${viewLabels[state.view]} model at ${pace.label.toLowerCase()} pace, ${pace.pace} per kilometre. ${phaseInfo.label}. ${focusLabels[state.lens]} focus.${contrastDescription}${flowDescription}`;

  for (const button of elements.phaseButtons.querySelectorAll('button')) {
    const active = button.dataset.phaseId === phaseInfo.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function syncPlayButton() {
  elements.playButton.classList.toggle('paused', !state.playing);
  elements.playButton.removeAttribute('aria-pressed');
  elements.playButton.setAttribute(
    'aria-label',
    state.playing ? 'Pause running model' : 'Play running model'
  );
  elements.playButtonText.textContent = state.playing
    ? state.mode === 'flow'
      ? 'Pause flow'
      : 'Pause'
    : state.mode === 'flow'
      ? 'Watch the flow'
      : 'Play';
  elements.flowPauseButton.removeAttribute('aria-pressed');
  elements.flowPauseButton.textContent = state.playing ? 'Pause' : 'Resume';
}

function setMode(mode) {
  state.mode = mode === 'inspect' ? 'inspect' : 'flow';
  if (state.mode === 'flow') {
    const run = getRunType(state.daily.runType);
    if (run) state.paceIndex = run.paceIndex;
  }
  refreshPace();
  document.body.dataset.mode = state.mode;
  for (const button of elements.modeTabs.querySelectorAll('button')) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (state.mode === 'flow') {
    const need = getFlowNeed(state.flowNeed);
    state.view = need.view;
    state.lens = need.lens;
    if (state.flowStep === 'see') {
      state.phase = flowPhase(need, currentPace());
    }
    state.playing = false;
    elements.playbackLabel.textContent = 'Pre-run';
    elements.playbackHint.textContent = 'Viewing speed never changes the mechanics';
  } else {
    elements.playbackLabel.textContent = 'Playback';
    elements.playbackHint.textContent = 'Viewing speed only';
  }
  elements.analysisCard.setAttribute(
    'aria-label',
    state.mode === 'flow' ? 'Running flow coach' : 'Mechanics analysis'
  );
  syncResponsiveLayout();
  syncViewButtons();
  syncLensButtons();
  syncPlayButton();
  updatePaceUI();
  persistPreferences();
  requestRender();
}

function setContrastPhase() {
  const pace = currentPace();
  state.phase =
    state.contrast === 'overreach'
      ? 0.012
      : state.contrast === 'waist'
        ? 0.1
        : pace.stanceFraction * 0.56;
}

elements.playButton.addEventListener('click', () => {
  if (state.mode === 'flow') {
    if (state.flowStep === 'feel') {
      state.playing = !state.playing;
      syncPlayButton();
      requestRender();
    }
    return;
  }
  if (state.view === 'contrast') {
    state.view = 'side';
    syncViewButtons();
  }
  state.playing = !state.playing;
  syncPlayButton();
  requestRender();
});

elements.resetButton.addEventListener('click', () => {
  state.mode = 'inspect';
  state.paceIndex = 1;
  state.phase = 0.1;
  state.playback = 0.35;
  state.cueIndexes = {};
  state.activeTune = 'rhythm';
  state.tuning = { ...DEFAULT_TUNING };
  state.view = 'side';
  state.lens = 'system';
  state.contrast = 'overreach';
  state.overlays.geometry = true;
  state.overlays.forces = true;
  state.overlays.trail = false;
  state.playing = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Reset still applies in memory when storage is unavailable.
  }

  for (const button of elements.speedTabs.querySelectorAll('button')) {
    const active = Number(button.dataset.speed) === state.playback;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of elements.overlayButtons.querySelectorAll('button')) {
    const active = state.overlays[button.dataset.overlay];
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of elements.contrastOptions.querySelectorAll('button')) {
    const active = button.dataset.contrast === state.contrast;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  setMode('inspect');
  updateFlowUI();
  updateTuneUI();
  updatePaceUI();
  focusSoon(elements.resetButton);
});

for (const button of elements.modeTabs.querySelectorAll('button')) {
  button.addEventListener('click', () => setMode(button.dataset.mode));
}

for (const button of elements.speedTabs.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    state.playback = Number(button.dataset.speed);
    for (const sibling of elements.speedTabs.querySelectorAll('button')) {
      const active = sibling === button;
      sibling.classList.toggle('active', active);
      sibling.setAttribute('aria-pressed', String(active));
    }
  });
}

for (const button of elements.viewTabs.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    syncViewButtons();
    if (state.view === 'contrast') {
      state.playing = false;
      setContrastPhase();
      syncPlayButton();
    }
    updateFrameUI();
    requestRender();
  });
}

for (const button of elements.overlayButtons.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    const key = button.dataset.overlay;
    state.overlays[key] = !state.overlays[key];
    button.classList.toggle('active', state.overlays[key]);
    button.setAttribute('aria-pressed', String(state.overlays[key]));
    requestRender();
  });
}

for (const button of elements.lensTabs.querySelectorAll('button')) {
  button.addEventListener('click', () => setLens(button.dataset.lens));
}

for (const button of elements.contrastOptions.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    state.contrast = button.dataset.contrast;
    for (const sibling of elements.contrastOptions.querySelectorAll('button')) {
      const active = sibling === button;
      sibling.classList.toggle('active', active);
      sibling.setAttribute('aria-pressed', String(active));
    }
    setContrastPhase();
    updateFrameUI();
    requestRender();
  });
}

elements.flowActionButton.addEventListener('click', () => {
  if (state.flowStep === 'see') {
    setFlowStep('feel');
    focusSoon(elements['flow-coach-title'], {
      scroll: compactLayout.matches,
      block: 'start'
    });
  }
  else if (state.flowStep === 'feel') {
    setFlowStep('go');
    focusSoon(elements['flow-coach-title'], {
      scroll: compactLayout.matches,
      block: 'start'
    });
  } else if (state.flowStep === 'go') {
    completeDailySetup();
  }
});

elements.flowStageActionButton.addEventListener('click', () => {
  if (state.flowStep === 'feel') {
    setFlowStep('go');
    focusSoon(elements['flow-coach-title'], {
      scroll: compactLayout.matches,
      block: 'start'
    });
  }
});

elements.flowPauseButton.addEventListener('click', () => {
  state.playing = !state.playing;
  syncPlayButton();
  requestRender();
});

elements.changeNeedButton.addEventListener('click', () => {
  restartDailySetup();
});

elements.anotherCueButton.addEventListener('click', () => {
  if (state.flowStep === 'see') {
    nextCue();
    updateFlowUI();
    updateFrameUI();
    requestRender();
    focusSoon(elements.flowActionButton);
  } else if (state.flowStep === 'feel') {
    setFlowStep('go');
    focusSoon(elements['flow-coach-title'], {
      scroll: compactLayout.matches,
      block: 'start'
    });
  }
});

elements.flowBackButton.addEventListener('click', () => {
  if (state.daily.completed) return;
  setFlowStep(previousPreRunStep(state.flowStep));
  focusSoon(elements['flow-coach-title'], {
    scroll: compactLayout.matches,
    block: 'start'
  });
});

for (const button of elements.afterRun.querySelectorAll('[data-outcome]')) {
  button.addEventListener('click', () => {
    state.daily.outcome = button.dataset.outcome;
    persistDailySession();
    updateHistoryEntry();
    updateFlowUI();
  });
}

elements.startAnotherRun.addEventListener('click', () => {
  restartDailySetup({ anotherRun: true });
});

elements.tuneSlider.addEventListener('input', (event) => {
  const control =
    TUNE_CONTROLS.find((item) => item.id === state.activeTune) || TUNE_CONTROLS[0];
  state.tuning[control.id] = clamp(
    Number(event.target.value),
    control.minimum,
    control.maximum
  );
  if (state.mode === 'flow' && control.id === 'lane') {
    state.view = 'rear';
    syncViewButtons();
  }
  persistPreferences();
  updatePaceUI();
});

elements.tuneResetButton.addEventListener('click', () => {
  state.tuning = { ...DEFAULT_TUNING };
  persistPreferences();
  updatePaceUI();
});

elements.phaseSlider.addEventListener('input', (event) => {
  state.phase = Number(event.target.value) / 1000;
  state.playing = false;
  syncPlayButton();
  updateFrameUI();
  requestRender();
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('button, a, input, select, textarea, summary, [contenteditable="true"]')
  ) {
    return;
  }

  if (state.mode !== 'inspect') return;

  if (event.code === 'Space') {
    event.preventDefault();
    elements.playButton.click();
  } else if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
    state.playing = false;
    state.phase = wrap01(
      state.phase + (event.code === 'ArrowRight' ? 0.0125 : -0.0125)
    );
    syncPlayButton();
    updateFrameUI();
    requestRender();
  }
});

motionPreference.addEventListener('change', (event) => {
  prefersReducedMotion = event.matches;
  if (prefersReducedMotion) {
    state.playing = false;
    syncPlayButton();
    requestRender();
  }
});

compactLayout.addEventListener('change', syncResponsiveLayout);

const resizeObserver = new ResizeObserver(() => {
  requestRender();
});
resizeObserver.observe(elements.runnerCanvas);

let dayBoundaryTimer = 0;

function resetDailyForNewDate() {
  const dateKey = localDateKey();
  if (state.daily.dateKey === dateKey) return false;
  state.daily = createDailySession(dateKey);
  state.flowStep = 'run';
  state.flowNeed = 'flow';
  state.playing = false;
  persistDailySession();
  buildRunTypeTabs();
  if (state.mode === 'flow') {
    state.view = getFlowNeed('flow').view;
    state.lens = getFlowNeed('flow').lens;
    syncViewButtons();
    syncLensButtons();
  }
  syncPlayButton();
  updateFlowUI();
  updateFrameUI();
  requestRender();
  return true;
}

function scheduleDayBoundary() {
  window.clearTimeout(dayBoundaryTimer);
  const now = new Date();
  const nextDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1
  );
  dayBoundaryTimer = window.setTimeout(() => {
    resetDailyForNewDate();
    scheduleDayBoundary();
  }, Math.min(nextDay.getTime() - now.getTime(), 2147483647));
}

document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
  if (document.visibilityState === 'visible') {
    resetDailyForNewDate();
    scheduleDayBoundary();
  }
});

let lastTime = performance.now();
let lastSemanticUpdate = 0;
animationReady = true;
function animate(now) {
  animationFrame = 0;
  const deltaSeconds = Math.min(0.035, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const pace = currentPace();
  let moved = false;

  if (state.playing && state.view !== 'contrast') {
    const cyclesPerSecond = pace.cadence / 120;
    state.phase = wrap01(
      state.phase + deltaSeconds * cyclesPerSecond * state.playback
    );
    moved = true;
  }

  if (moved || needsRender) {
    renderStage(elements.runnerCanvas, state, pace, PROFILE);
    needsRender = false;
  }
  if (moved && now - lastSemanticUpdate > 80) {
    updateFrameUI();
    lastSemanticUpdate = now;
  }
  if (state.playing || needsRender) ensureAnimation();
}

function ensureAnimation() {
  if (!animationFrame) animationFrame = requestAnimationFrame(animate);
}

buildPaceTabs();
buildNeedTabs();
buildRunTypeTabs();
buildTuneTabs();
buildPhaseButtons();
buildPrinciples();
buildEvidence();
setMode(state.mode);
updateFlowUI();
updatePaceUI();
syncPlayButton();
ensureAnimation();
scheduleDayBoundary();

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // The lab remains fully usable online if service-worker registration is unavailable.
    });
  });
}
