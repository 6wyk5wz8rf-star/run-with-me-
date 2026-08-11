import {
  EVIDENCE,
  PACE_PRESETS,
  PRINCIPLES,
  PROFILE,
  getObservation,
  getPhaseInfo,
  phaseLandmarks
} from './data.js';
import { buildTrace, computeSidePose, wrap01 } from './kinematics.js';
import { renderStage } from './renderer.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  paceIndex: 1,
  phase: 0.1,
  playing: !prefersReducedMotion,
  playback: 0.35,
  view: 'side',
  lens: 'system',
  contrast: 'overreach',
  overlays: {
    geometry: true,
    forces: true,
    trail: false
  }
};

const elements = Object.fromEntries(
  [
    'runnerCanvas',
    'paceTabs',
    'paceReadout',
    'paceName',
    'playButton',
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

const currentPace = () => PACE_PRESETS[state.paceIndex];

function buildPaceTabs() {
  elements.paceTabs.innerHTML = PACE_PRESETS.map(
    (pace, index) => `
      <button type="button" data-index="${index}" class="${index === state.paceIndex ? 'active' : ''}" aria-pressed="${index === state.paceIndex}">
        ${pace.label}<span>${pace.pace} /km</span>
      </button>`
  ).join('');

  for (const button of elements.paceTabs.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.paceIndex = Number(button.dataset.index);
      updatePaceUI();
    });
  }
}

function buildPhaseButtons() {
  const landmarks = phaseLandmarks(currentPace());
  elements.phaseButtons.innerHTML = landmarks
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
    });
  }
}

function buildPrinciples() {
  elements.principleGrid.innerHTML = PRINCIPLES.map(
    (principle) => `
      <button type="button" class="principle-card ${principle.id === state.lens ? 'active' : ''}" data-lens="${principle.id}" aria-pressed="${principle.id === state.lens}">
        <span>${principle.number}</span>
        <h3>${principle.title}</h3>
        <p>${principle.text}</p>
        <b>${principle.cue}</b>
      </button>`
  ).join('');

  for (const card of elements.principleGrid.querySelectorAll('.principle-card')) {
    card.addEventListener('click', () => {
      setLens(card.dataset.lens);
      document.querySelector('.lab-grid').scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start'
      });
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

function setLens(lens) {
  state.lens = lens;
  for (const button of elements.lensTabs.querySelectorAll('button')) {
    const active = button.dataset.lens === lens;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const card of elements.principleGrid.querySelectorAll('.principle-card')) {
    const active = card.dataset.lens === lens;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
  }
  updateFrameUI();
}

function tracePath(points, xMap, yMap) {
  return points
    .map((point, index) => `${index ? 'L' : 'M'} ${xMap(point).toFixed(2)} ${yMap(point).toFixed(2)}`)
    .join(' ');
}

function updateTrace() {
  const trace = buildTrace(currentPace(), 140);
  const minCom = Math.min(...trace.map((item) => item.comY));
  const maxCom = Math.max(...trace.map((item) => item.comY));
  const maxForce = Math.max(...trace.map((item) => item.force), 1);
  const xMap = (item) => 10 + item.phase * 340;
  const comY = (item) => 49 - ((item.comY - minCom) / (maxCom - minCom || 1)) * 25;
  const forceY = (item) => 101 - (item.force / maxForce) * 29;
  elements.comTracePath.setAttribute('d', tracePath(trace, xMap, comY));
  elements.forceTracePath.setAttribute('d', tracePath(trace, xMap, forceY));
}

function updatePaceUI() {
  const pace = currentPace();
  elements.paceReadout.textContent = pace.pace;
  elements.paceName.textContent = pace.label;
  elements.cadenceMetric.textContent = String(pace.cadence);
  elements.contactMetric.textContent = String(Math.round(pace.contactMs));
  elements.flightMetric.textContent = String(Math.round(pace.flightMs));
  elements.stepMetric.textContent = pace.stepLengthM.toFixed(2);
  elements.dutyMetric.textContent = pace.dutyPercent.toFixed(1);
  elements.bounceMetric.textContent = pace.bounceCm.toFixed(1);
  elements.stanceWindow.style.width = `${pace.stanceFraction * 100}%`;

  for (const button of elements.paceTabs.querySelectorAll('button')) {
    const active = Number(button.dataset.index) === state.paceIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  buildPhaseButtons();
  updateTrace();
  updateFrameUI();
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
  elements.ankleAngleName.textContent = ankle >= 0 ? 'dorsiflexion' : 'plantarflexion';

  const viewLabels = {
    side: 'Sagittal view',
    rear: 'Posterior view',
    contrast: 'Controlled contrast'
  };
  const focusLabels = {
    system: 'Whole system',
    posture: 'Head · ribs · pelvis',
    contact: 'Foot · shin · centre of mass',
    recovery: 'Rear-side lever',
    arms: 'Upper-body rhythm'
  };
  elements.stageViewLabel.textContent = viewLabels[state.view];
  elements.stageFocusLabel.textContent = focusLabels[state.lens];
  elements.canvasDescription.textContent = `${viewLabels[state.view]} model at ${pace.label.toLowerCase()} pace, ${pace.pace} per kilometre. ${phaseInfo.label}. ${focusLabels[state.lens]} focus.`;

  for (const button of elements.phaseButtons.querySelectorAll('button')) {
    const active = button.dataset.phaseId === phaseInfo.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function syncPlayButton() {
  elements.playButton.classList.toggle('paused', !state.playing);
  elements.playButton.setAttribute('aria-pressed', String(state.playing));
  elements.playButton.setAttribute(
    'aria-label',
    state.playing ? 'Pause animation' : 'Play animation'
  );
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
    elements.contrastOptions.hidden = true;
    for (const button of elements.viewTabs.querySelectorAll('button')) {
      const active = button.dataset.view === 'side';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  state.playing = !state.playing;
  syncPlayButton();
});

elements.resetButton.addEventListener('click', () => {
  state.paceIndex = 1;
  state.phase = 0.1;
  state.playback = 0.35;
  state.view = 'side';
  state.lens = 'system';
  state.contrast = 'overreach';
  state.overlays.geometry = true;
  state.overlays.forces = true;
  state.overlays.trail = false;
  state.playing = !prefersReducedMotion;

  for (const button of elements.speedTabs.querySelectorAll('button')) {
    const active = Number(button.dataset.speed) === state.playback;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of elements.viewTabs.querySelectorAll('button')) {
    const active = button.dataset.view === state.view;
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
  elements.contrastOptions.hidden = true;
  setLens('system');
  syncPlayButton();
  updatePaceUI();
});

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
    for (const sibling of elements.viewTabs.querySelectorAll('button')) {
      const active = sibling === button;
      sibling.classList.toggle('active', active);
      sibling.setAttribute('aria-pressed', String(active));
    }
    const isContrast = state.view === 'contrast';
    elements.contrastOptions.hidden = !isContrast;
    if (isContrast) {
      state.playing = false;
      setContrastPhase();
      syncPlayButton();
    }
    updateFrameUI();
  });
}

for (const button of elements.overlayButtons.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    const key = button.dataset.overlay;
    state.overlays[key] = !state.overlays[key];
    button.classList.toggle('active', state.overlays[key]);
    button.setAttribute('aria-pressed', String(state.overlays[key]));
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
  });
}

elements.phaseSlider.addEventListener('input', (event) => {
  state.phase = Number(event.target.value) / 1000;
  state.playing = false;
  syncPlayButton();
  updateFrameUI();
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement
  ) {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    elements.playButton.click();
  } else if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
    state.playing = false;
    state.phase = wrap01(state.phase + (event.code === 'ArrowRight' ? 0.0125 : -0.0125));
    syncPlayButton();
    updateFrameUI();
  }
});

document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
});

let lastTime = performance.now();
function animate(now) {
  const deltaSeconds = Math.min(0.035, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const pace = currentPace();

  if (state.playing && state.view !== 'contrast') {
    const cyclesPerSecond = pace.cadence / 120;
    state.phase = wrap01(state.phase + deltaSeconds * cyclesPerSecond * state.playback);
  }

  renderStage(elements.runnerCanvas, state, pace, PROFILE);
  updateFrameUI();
  requestAnimationFrame(animate);
}

buildPaceTabs();
buildPhaseButtons();
buildPrinciples();
buildEvidence();
updatePaceUI();
syncPlayButton();
requestAnimationFrame(animate);

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // The lab remains fully usable online if service-worker registration is unavailable.
    });
  });
}
