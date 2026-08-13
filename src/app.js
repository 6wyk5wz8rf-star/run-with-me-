import {
  DEFAULT_TUNING,
  EVIDENCE,
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

const STORAGE_KEY = 'rift-form-lab-preferences-v1';
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

const saved = loadPreferences();
const savedPace = Number(saved?.paceIndex);
const savedNeed = FLOW_NEEDS.some((item) => item.id === saved?.flowNeed)
  ? saved.flowNeed
  : 'flow';

const state = {
  mode: saved?.mode === 'inspect' ? 'inspect' : 'flow',
  paceIndex:
    Number.isInteger(savedPace) && savedPace >= 0 && savedPace < PACE_PRESETS.length
      ? savedPace
      : 1,
  phase: 0.1,
  playing: false,
  playback: 0.35,
  view: getFlowNeed(savedNeed).view,
  lens: getFlowNeed(savedNeed).lens,
  contrast: 'overreach',
  flowNeed: savedNeed,
  flowStep: 'choose',
  cueIndexes: sanitiseCueIndexes(saved?.cueIndexes),
  savedCue: sanitiseSavedCue(saved?.savedCue),
  reflection: null,
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
    'needTabs',
    'flowNeedPrompt',
    'flowStatus',
    'changeNeedButton',
    'flowSteps',
    'flowCueCard',
    'flowCueLabel',
    'flowCueText',
    'flowCueSee',
    'flowBoundary',
    'flowCueAvoid',
    'flowReflect',
    'cueActions',
    'flowActionButton',
    'anotherCueButton',
    'savedCue',
    'savedCueText',
    'clearSavedCue',
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
  paceCache = tunePace(basePace(), state.tuning);
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

function focusSoon(element, { scroll = false } = {}) {
  const focus = () => {
    if (!element || element.hidden || element.getClientRects().length === 0) return;
    element.focus({ preventScroll: !scroll });
  };
  focus();
  requestAnimationFrame(() => {
    if (document.activeElement !== element) focus();
    if (scroll && element?.getClientRects().length) {
      element.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    }
  });
}

function nextCue() {
  const current = Number(state.cueIndexes[state.flowNeed]) || 0;
  state.cueIndexes[state.flowNeed] = current + 1;
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

function setFlowNeed(id) {
  const need = getFlowNeed(id);
  state.flowNeed = need.id;
  state.lens = need.lens;
  state.view = need.view;
  state.activeTune = need.tune || state.activeTune;
  state.flowStep = 'see';
  state.reflection = null;
  state.phase = flowPhase(need, currentPace());
  state.playing = false;
  syncLensButtons();
  syncViewButtons();
  syncPlayButton();
  updateFlowUI();
  updateTuneUI();
  updateFrameUI();
  persistPreferences();
  requestRender();
}

function setFlowStep(step) {
  if (!['choose', 'see', 'feel', 'release', 'reflect'].includes(step)) return;
  state.flowStep = step;
  if (step === 'choose') {
    state.playing = false;
  } else if (step === 'see') {
    state.phase = flowPhase(getFlowNeed(state.flowNeed), currentPace());
    state.playing = false;
  } else if (step === 'feel' || step === 'release') {
    state.playing = !prefersReducedMotion;
  } else {
    state.playing = false;
  }
  if (step !== 'reflect') {
    state.reflection = null;
  }
  syncPlayButton();
  updateFlowUI();
  updateFrameUI();
  requestRender();
}

function updateFlowUI() {
  const need = getFlowNeed(state.flowNeed);
  const cueIndex = Number(state.cueIndexes[need.id]) || 0;
  const cue = getFlowCue(need.id, cueIndex);
  document.body.dataset.flowStep = state.flowStep;
  document.body.dataset.flowNeed = need.id;
  elements.flowNeedPrompt.textContent =
    state.flowStep === 'choose' ? 'Choose the closest. One cue is enough.' : need.prompt;
  elements.changeNeedButton.hidden = state.flowStep === 'choose';

  for (const button of elements.needTabs.querySelectorAll('button')) {
    const active =
      state.flowStep !== 'choose' && button.dataset.need === state.flowNeed;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const marker of elements.flowSteps.querySelectorAll('[data-step]')) {
    const active = marker.dataset.step === state.flowStep;
    marker.classList.toggle('active', active);
    if (active) marker.setAttribute('aria-current', 'step');
    else marker.removeAttribute('aria-current');
  }

  elements.flowSteps.hidden = state.flowStep === 'choose';
  elements.flowCueCard.hidden = state.flowStep === 'choose';
  elements.flowCueCard.dataset.step = state.flowStep;
  elements.flowBoundary.hidden = state.flowStep !== 'see';
  elements.flowReflect.hidden =
    state.flowStep !== 'reflect' || Boolean(state.reflection);
  elements.cueActions.hidden =
    state.flowStep === 'reflect' && !state.reflection;
  elements.anotherCueButton.hidden = state.flowStep !== 'feel';

  if (state.flowStep === 'see') {
    elements.flowCueLabel.textContent = 'See';
    elements.flowCueText.textContent = 'Watch one relationship.';
    elements.flowCueSee.textContent = cue.see;
    elements.flowActionButton.textContent = 'Try this cue';
  } else if (state.flowStep === 'release') {
    elements.flowCueLabel.textContent = 'Let go';
    elements.flowCueText.textContent = cue.release;
    elements.flowCueSee.textContent = 'Nothing to correct. Run without checking.';
    elements.flowActionButton.textContent = 'How did that feel?';
  } else if (state.flowStep === 'reflect') {
    elements.flowCueLabel.textContent = 'Notice';
    elements.flowCueText.textContent = state.reflection
      ? state.reflection === 'easier'
        ? 'Keep what helped · leave the rest.'
        : state.reflection === 'same'
          ? 'No change is useful information.'
          : 'Drop this cue. Your stride wins.'
      : 'How did that feel?';
    elements.flowCueSee.textContent = state.reflection
      ? state.reflection === 'easier'
        ? 'Save it for today, then use it briefly—not every step.'
        : 'Try a different cue or return to your natural stride.'
      : 'Compare with how you felt before, not with a perfect pose.';
    if (state.reflection) {
      elements.flowActionButton.textContent =
        state.reflection === 'easier' ? 'Return to choices' : 'Try another cue';
      elements.anotherCueButton.hidden = true;
    }
  } else {
    elements.flowCueLabel.textContent = 'Feel';
    elements.flowCueText.textContent = cue.feel;
    elements.flowCueSee.textContent = 'Use it for a few strides. Nothing else.';
    elements.flowActionButton.textContent = 'Let it go';
  }

  elements.flowCueAvoid.textContent = cue.avoid;
  const stepName = {
    choose: 'Choose',
    see: 'See',
    feel: 'Feel',
    release: 'Let go',
    reflect: 'Notice'
  }[state.flowStep];
  elements.flowStatus.textContent = `${stepName}. ${
    state.flowStep === 'choose'
      ? 'Choose one feeling.'
      : `${elements.flowCueText.textContent} ${elements.flowCueSee.textContent}`
  }`;
  elements.flowStageActionButton.textContent =
    state.flowStep === 'release' ? 'How did that feel?' : 'Let it go';
  const savedCue = state.savedCue
    ? getFlowCue(state.savedCue.needId, state.savedCue.index)
    : null;
  elements.savedCue.hidden = !savedCue;
  elements.flowPractice.hidden = state.flowStep === 'choose' && !savedCue;
  if (savedCue) elements.savedCueText.textContent = savedCue.feel;
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
    state.mode === 'flow' && state.flowStep === 'release'
      ? 'Whole stride · cue released'
      : focusLabels[state.lens];
  const contrastDescriptions = {
    overreach: 'Comparison: the foot lands farther ahead of the pelvis with more braking.',
    waist: 'Comparison: the ribs move ahead of the pelvis and break the whole-body stack.',
    crossover: 'Comparison: the foot crosses the centre line and the knee follows inward.'
  };
  const contrastDescription = state.view === 'contrast'
    ? ` ${contrastDescriptions[state.contrast]}`
    : '';
  elements.canvasDescription.textContent = `${viewLabels[state.view]} model at ${pace.label.toLowerCase()} pace, ${pace.pace} per kilometre. ${phaseInfo.label}. ${focusLabels[state.lens]} focus.${contrastDescription}`;

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
    if (state.flowStep === 'choose' || state.flowStep === 'see') {
      state.phase = flowPhase(need, currentPace());
      state.playing = false;
    } else if (state.flowStep === 'feel' || state.flowStep === 'release') {
      state.playing = !prefersReducedMotion;
    }
    elements.playbackLabel.textContent = 'Flow';
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
  updateFrameUI();
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
  if (state.view === 'contrast') {
    state.view = 'side';
    syncViewButtons();
  }
  if (state.mode === 'flow' && state.flowStep === 'choose') return;
  if (state.mode === 'flow' && state.flowStep === 'see') {
    setFlowStep('feel');
    return;
  }
  state.playing = !state.playing;
  syncPlayButton();
  requestRender();
});

elements.resetButton.addEventListener('click', () => {
  state.mode = 'flow';
  state.paceIndex = 1;
  state.phase = 0.1;
  state.playback = 0.35;
  state.flowNeed = 'flow';
  state.flowStep = 'choose';
  state.cueIndexes = {};
  state.savedCue = null;
  state.reflection = null;
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
  setMode('flow');
  updateFlowUI();
  updateTuneUI();
  updatePaceUI();
  focusSoon(elements.needTabs.querySelector('button'));
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
    focusSoon(elements.flowStageActionButton, { scroll: compactLayout.matches });
  }
  else if (state.flowStep === 'feel') setFlowStep('release');
  else if (state.flowStep === 'release') {
    setFlowStep('reflect');
    focusSoon(elements.flowReflect.querySelector('[data-reflection]'), {
      scroll: compactLayout.matches
    });
  } else if (state.flowStep === 'reflect' && state.reflection) {
    if (state.reflection === 'easier') {
      setFlowStep('choose');
      focusSoon(elements.needTabs.querySelector('button'));
    } else {
      nextCue();
      setFlowStep('see');
      persistPreferences();
      focusSoon(elements.flowActionButton);
    }
  }
});

elements.flowStageActionButton.addEventListener('click', () => {
  if (state.flowStep === 'feel') {
    setFlowStep('release');
    focusSoon(elements.flowStageActionButton);
  } else if (state.flowStep === 'release') {
    setFlowStep('reflect');
    focusSoon(elements.flowReflect.querySelector('[data-reflection]'), {
      scroll: compactLayout.matches
    });
  }
});

elements.flowPauseButton.addEventListener('click', () => {
  state.playing = !state.playing;
  syncPlayButton();
  requestRender();
});

elements.changeNeedButton.addEventListener('click', () => {
  setFlowStep('choose');
  focusSoon(elements.needTabs.querySelector('button'));
});

elements.anotherCueButton.addEventListener('click', () => {
  nextCue();
  setFlowStep('see');
  persistPreferences();
  focusSoon(elements.flowActionButton);
});

for (const button of elements.flowReflect.querySelectorAll('[data-reflection]')) {
  button.addEventListener('click', () => {
    state.reflection = button.dataset.reflection;
    if (state.reflection === 'easier') {
      state.savedCue = {
        needId: state.flowNeed,
        index: Number(state.cueIndexes[state.flowNeed]) || 0
      };
    }
    updateFlowUI();
    persistPreferences();
    focusSoon(elements.flowActionButton);
  });
}

elements.clearSavedCue.addEventListener('click', () => {
  state.savedCue = null;
  updateFlowUI();
  persistPreferences();
  focusSoon(
    state.flowStep === 'choose'
      ? elements.needTabs.querySelector('button')
      : state.flowStep === 'reflect' && !state.reflection
        ? elements.flowReflect.querySelector('[data-reflection]')
        : elements.flowActionButton
  );
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

document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
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
buildTuneTabs();
buildPhaseButtons();
buildPrinciples();
buildEvidence();
setMode(state.mode);
updateFlowUI();
updatePaceUI();
syncPlayButton();
ensureAnimation();

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // The lab remains fully usable online if service-worker registration is unavailable.
    });
  });
}
