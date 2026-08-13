import { PROFILE } from './data.js';
import {
  clamp,
  computeRearPose,
  computeSidePose,
  radians,
  wrap01
} from './kinematics.js';

const DESKTOP_STAGE = Object.freeze({ width: 1000, height: 640 });
const PORTRAIT_STAGE = Object.freeze({ width: 620, height: 780 });
let activeStage = DESKTOP_STAGE;
let activeFit = 1;
const annotationScale = () => Math.max(1, 1 / activeFit);

const COLOURS = {
  paper: '#f5f1e8',
  ink: '#18243d',
  rust: '#c45a2c',
  rustMuted: '#c45a2c',
  blue: '#b9c0c8',
  blueSoft: 'rgba(185, 192, 200, 0.34)',
  grid: 'rgba(242, 238, 228, 0.12)',
  gridSoft: 'rgba(242, 238, 228, 0.07)',
  skinLead: '#8f5a40',
  skinLight: '#b77955',
  skinFar: '#5a4039',
  skinLine: '#4c302d',
  hair: '#241d1e',
  singlet: '#9b4529',
  singletLight: '#9b4529',
  shorts: '#18243d',
  shortsFar: '#121c30',
  shoe: '#ded8cc',
  shoeDark: '#758092',
  sole: '#f7f1e7',
  farBone: 'rgba(180, 195, 210, 0.36)',
  leadBone: 'rgba(232, 237, 235, 0.76)'
};

function prepareCanvas(canvas) {
  const bounds = canvas.getBoundingClientRect();
  activeStage = bounds.width <= 640 && bounds.height > bounds.width
    ? PORTRAIT_STAGE
    : DESKTOP_STAGE;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  const fit = Math.min(
    bounds.width / activeStage.width,
    bounds.height / activeStage.height
  );
  activeFit = fit;
  const offsetX = (bounds.width - activeStage.width * fit) / 2;
  const offsetY = (bounds.height - activeStage.height * fit) / 2;
  context.setTransform(dpr * fit, 0, 0, dpr * fit, dpr * offsetX, dpr * offsetY);
  context.clearRect(0, 0, activeStage.width, activeStage.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  return context;
}

function mapWorld(originX, groundY, scale) {
  return (point) => ({
    x: originX + point.x * scale,
    y: groundY - point.y * scale
  });
}

function mixAlpha(context, alpha, draw) {
  context.save();
  context.globalAlpha *= alpha;
  draw();
  context.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
}

function drawLine(context, a, b, colour, width = 1, dash = []) {
  context.save();
  context.beginPath();
  context.setLineDash(dash);
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.stroke();
  context.restore();
}

function between(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount
  };
}

function drawArrow(context, start, end, colour, width = 2.2) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = 8;
  drawLine(context, start, end, colour, width);
  context.save();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - Math.cos(angle - Math.PI / 6) * head,
    end.y - Math.sin(angle - Math.PI / 6) * head
  );
  context.lineTo(
    end.x - Math.cos(angle + Math.PI / 6) * head,
    end.y - Math.sin(angle + Math.PI / 6) * head
  );
  context.closePath();
  context.fillStyle = colour;
  context.fill();
  context.restore();
}

function taperedLimb(
  context,
  from,
  to,
  startWidth,
  endWidth,
  fill,
  edge = COLOURS.skinLine,
  highlight = null
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  context.save();
  context.beginPath();
  context.moveTo(from.x + nx * startWidth * 0.5, from.y + ny * startWidth * 0.5);
  context.bezierCurveTo(
    from.x + dx * 0.3 + nx * startWidth * 0.52,
    from.y + dy * 0.3 + ny * startWidth * 0.52,
    from.x + dx * 0.72 + nx * endWidth * 0.53,
    from.y + dy * 0.72 + ny * endWidth * 0.53,
    to.x + nx * endWidth * 0.5,
    to.y + ny * endWidth * 0.5
  );
  context.lineTo(to.x - nx * endWidth * 0.5, to.y - ny * endWidth * 0.5);
  context.bezierCurveTo(
    from.x + dx * 0.72 - nx * endWidth * 0.5,
    from.y + dy * 0.72 - ny * endWidth * 0.5,
    from.x + dx * 0.3 - nx * startWidth * 0.48,
    from.y + dy * 0.3 - ny * startWidth * 0.48,
    from.x - nx * startWidth * 0.5,
    from.y - ny * startWidth * 0.5
  );
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = edge;
  context.lineWidth = 0.75;
  context.stroke();

  context.beginPath();
  context.moveTo(from.x + nx * startWidth * 0.18, from.y + ny * startWidth * 0.18);
  context.lineTo(to.x + nx * endWidth * 0.13, to.y + ny * endWidth * 0.13);
  context.strokeStyle = 'rgba(255,255,255,0.12)';
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function jointBlend(context, point, radius, fill, edge = COLOURS.skinLine) {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = edge;
  context.lineWidth = 0.6;
  context.stroke();
  context.restore();
}

function drawShoe(context, leg, map, far = false) {
  const heel = map(leg.foot.heel);
  const toe = map(leg.foot.toe);
  const ankle = map(leg.ankle);
  const dx = toe.x - heel.x;
  const dy = toe.y - heel.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) {
    nx *= -1;
    ny *= -1;
  }
  const upper = (point, amount) => ({ x: point.x + nx * amount, y: point.y + ny * amount });
  const heelUpper = upper(heel, 7);
  const toeUpper = upper(toe, 5.2);
  const quarter = {
    x: ankle.x * 0.66 + heel.x * 0.34,
    y: ankle.y * 0.66 + heel.y * 0.34
  };

  context.save();
  context.beginPath();
  context.moveTo(heel.x, heel.y);
  context.lineTo(toe.x, toe.y);
  context.quadraticCurveTo(toeUpper.x + 3, toeUpper.y - 1, toeUpper.x, toeUpper.y);
  context.lineTo(quarter.x, quarter.y);
  context.lineTo(heelUpper.x, heelUpper.y);
  context.closePath();
  context.fillStyle = far ? '#7d8290' : COLOURS.shoe;
  context.fill();
  context.strokeStyle = far ? '#525b6b' : '#777b82';
  context.lineWidth = 1;
  context.stroke();

  drawLine(context, heel, toe, far ? '#9da3ad' : COLOURS.sole, 3.2);
  drawLine(
    context,
    { x: quarter.x - 2, y: quarter.y + 2 },
    { x: toeUpper.x - 7, y: toeUpper.y + 2 },
    far ? 'rgba(236,238,237,.38)' : 'rgba(64,70,81,.6)',
    1.1
  );
  context.restore();
}

function drawTorso(context, pose, map, ghost = false) {
  const pelvis = map(pose.pelvis);
  const waist = map(pose.waist);
  const shoulder = map(pose.shoulderCenter);
  const dx = shoulder.x - pelvis.x;
  const dy = shoulder.y - pelvis.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const hipWidth = 19;
  const waistWidth = 15.5;
  const shoulderWidth = 23.5;

  context.save();
  context.beginPath();
  context.moveTo(pelvis.x + nx * hipWidth, pelvis.y + ny * hipWidth);
  context.quadraticCurveTo(
    waist.x + nx * waistWidth,
    waist.y + ny * waistWidth,
    shoulder.x + nx * shoulderWidth,
    shoulder.y + ny * shoulderWidth
  );
  context.quadraticCurveTo(
    shoulder.x + dx * 0.06,
    shoulder.y + dy * 0.04 - 7,
    shoulder.x - nx * shoulderWidth * 0.82,
    shoulder.y - ny * shoulderWidth * 0.82
  );
  context.quadraticCurveTo(
    waist.x - nx * waistWidth,
    waist.y - ny * waistWidth,
    pelvis.x - nx * hipWidth,
    pelvis.y - ny * hipWidth
  );
  context.closePath();
  context.fillStyle = ghost ? '#69778a' : COLOURS.singlet;
  context.fill();
  context.strokeStyle = ghost ? 'rgba(220,228,234,.24)' : '#733321';
  context.lineWidth = 1;
  context.stroke();

  if (!ghost) {
    drawLine(
      context,
      { x: waist.x - nx * waistWidth * 0.85, y: waist.y - ny * waistWidth * 0.85 },
      { x: waist.x + nx * waistWidth * 0.85, y: waist.y + ny * waistWidth * 0.85 },
      'rgba(255,255,255,.13)',
      1
    );
  }
  context.restore();
}

function drawShorts(context, pose, map, ghost = false) {
  const pelvis = map(pose.pelvis);
  const hipLead = map(pose.lead.hip);
  const hipFar = map(pose.far.hip);
  const leadUpper = {
    x: hipLead.x + (map(pose.lead.knee).x - hipLead.x) * 0.22,
    y: hipLead.y + (map(pose.lead.knee).y - hipLead.y) * 0.22
  };
  const farUpper = {
    x: hipFar.x + (map(pose.far.knee).x - hipFar.x) * 0.22,
    y: hipFar.y + (map(pose.far.knee).y - hipFar.y) * 0.22
  };

  context.save();
  context.beginPath();
  context.moveTo(pelvis.x - 20, pelvis.y - 14);
  context.quadraticCurveTo(pelvis.x + 1, pelvis.y - 22, pelvis.x + 21, pelvis.y - 9);
  context.lineTo(leadUpper.x + 12, leadUpper.y + 3);
  context.lineTo(leadUpper.x - 10, leadUpper.y + 7);
  context.lineTo(pelvis.x, pelvis.y + 5);
  context.lineTo(farUpper.x - 10, farUpper.y + 5);
  context.lineTo(farUpper.x + 10, farUpper.y + 2);
  context.closePath();
  context.fillStyle = ghost ? '#607087' : COLOURS.shorts;
  context.fill();
  context.strokeStyle = ghost ? 'rgba(220,228,234,.2)' : '#0d1728';
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawHead(context, pose, map, ghost = false) {
  const head = map(pose.head);
  const neck = map(pose.neck);
  const shoulder = map(pose.shoulderCenter);
  taperedLimb(
    context,
    shoulder,
    neck,
    15,
    10,
    ghost ? '#667588' : COLOURS.skinLead,
    ghost ? 'rgba(220,228,234,.2)' : COLOURS.skinLine
  );
  context.save();
  context.translate(head.x, head.y);
  context.rotate(radians(pose.posture?.upperTorsoLeanDeg || 0) * 0.35);
  context.beginPath();
  context.ellipse(0, 0, 17.2, 21.6, 0, 0, Math.PI * 2);
  context.fillStyle = ghost ? '#69788b' : COLOURS.skinLead;
  context.fill();
  context.strokeStyle = ghost ? 'rgba(220,228,234,.2)' : COLOURS.skinLine;
  context.lineWidth = 0.9;
  context.stroke();

  if (!ghost) {
    context.beginPath();
    context.arc(-2, -6, 15.8, Math.PI * 1.08, Math.PI * 1.9);
    context.lineTo(12, -11);
    context.quadraticCurveTo(4, -23, -8, -20);
    context.closePath();
    context.fillStyle = COLOURS.hair;
    context.fill();
    context.beginPath();
    context.arc(10, -1, 1.4, 0, Math.PI * 2);
    context.fillStyle = '#1f1b1c';
    context.fill();
  }
  context.restore();
}

function drawArm(context, arm, map, far = false, ghost = false) {
  const shoulder = map(arm.shoulder);
  const elbow = map(arm.elbow);
  const wrist = map(arm.wrist);
  const fill = ghost ? '#68778a' : far ? COLOURS.skinFar : COLOURS.skinLead;
  const edge = ghost ? 'rgba(220,228,234,.2)' : far ? '#382c2d' : COLOURS.skinLine;
  const upperMid = between(shoulder, elbow, 0.52);
  const forearmMid = between(elbow, wrist, 0.48);
  taperedLimb(context, shoulder, upperMid, 16.5, 17.5, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, upperMid, elbow, 17.5, 11.5, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, elbow, 6.1, fill, edge);
  taperedLimb(context, elbow, forearmMid, 11.8, 13.2, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, forearmMid, wrist, 13.2, 7.2, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, wrist, 4.8, fill, edge);
}

function drawLeg(context, leg, map, far = false, ghost = false) {
  const hip = map(leg.hip);
  const knee = map(leg.knee);
  const ankle = map(leg.ankle);
  const fill = ghost ? '#68778a' : far ? COLOURS.skinFar : COLOURS.skinLead;
  const edge = ghost ? 'rgba(220,228,234,.2)' : far ? '#382c2d' : COLOURS.skinLine;
  const thighMid = between(hip, knee, 0.48);
  const calf = between(knee, ankle, 0.53);
  taperedLimb(context, hip, thighMid, 31, 35, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, thighMid, knee, 35, 21, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, knee, 10.4, fill, edge);
  taperedLimb(context, knee, calf, 20, 24.5, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, calf, ankle, 24.5, 11.5, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, ankle, 6.2, fill, edge);
  drawShoe(context, leg, map, far || ghost);
}

function drawSkeleton(context, pose, map) {
  const groups = [
    { leg: pose.far, arm: pose.farArm, colour: COLOURS.farBone },
    { leg: pose.lead, arm: pose.leadArm, colour: COLOURS.leadBone }
  ];

  for (const group of groups) {
    const hip = map(group.leg.hip);
    const knee = map(group.leg.knee);
    const ankle = map(group.leg.ankle);
    const shoulder = map(group.arm.shoulder);
    const elbow = map(group.arm.elbow);
    const wrist = map(group.arm.wrist);
    drawLine(context, hip, knee, group.colour, 0.95);
    drawLine(context, knee, ankle, group.colour, 0.95);
    drawLine(context, shoulder, elbow, group.colour, 0.9);
    drawLine(context, elbow, wrist, group.colour, 0.9);
    for (const joint of [hip, knee, ankle, shoulder, elbow, wrist]) {
      context.beginPath();
      context.arc(joint.x, joint.y, 2.7, 0, Math.PI * 2);
      context.fillStyle = COLOURS.ink;
      context.fill();
      context.strokeStyle = group.colour;
      context.lineWidth = 1.05;
      context.stroke();
    }
  }
  drawLine(context, map(pose.pelvis), map(pose.waist), COLOURS.leadBone, 1.15);
  drawLine(context, map(pose.waist), map(pose.shoulderCenter), COLOURS.leadBone, 1.15);
}

function drawTag(context, anchor, text, side = 'right', accent = COLOURS.blue) {
  const ui = annotationScale();
  context.save();
  context.font = `650 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = 'middle';
  const width = context.measureText(text).width + 24 * ui;
  const height = 32 * ui;
  const gap = 20 * ui;
  const margin = 8 * ui;
  const preferredX = side === 'right' ? anchor.x + gap : anchor.x - gap - width;
  const x = clamp(
    preferredX,
    margin,
    Math.max(margin, activeStage.width - margin - width)
  );
  const y = clamp(
    anchor.y - height / 2,
    margin,
    Math.max(margin, activeStage.height - margin - height)
  );
  const lineX = anchor.x <= x ? x : anchor.x >= x + width ? x + width : side === 'right' ? x : x + width;
  drawLine(
    context,
    anchor,
    { x: lineX, y: clamp(anchor.y, y + 4 * ui, y + height - 4 * ui) },
    accent,
    1
  );
  roundedRect(context, x, y, width, height, 6 * ui);
  context.fillStyle = 'rgba(14, 23, 40, .88)';
  context.fill();
  context.strokeStyle = 'rgba(242, 238, 228, .14)';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = COLOURS.paper;
  context.fillText(text, x + 12 * ui, y + height / 2 + 0.5);
  context.beginPath();
  context.arc(anchor.x, anchor.y, 3.1, 0, Math.PI * 2);
  context.fillStyle = accent;
  context.fill();
  context.restore();
}

function drawJointArc(context, center, radius, start, end, label) {
  const ui = annotationScale();
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, start, end);
  context.strokeStyle = COLOURS.blue;
  context.lineWidth = 1.4;
  context.stroke();
  context.font = `650 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = '#b6c9d6';
  context.fillText(label, center.x + radius + 4 * ui, center.y - radius * 0.2);
  context.restore();
}

export function groundPatternAt(phase, preset, scale) {
  const stridePixels = preset.strideLengthM * 100 * scale;
  const repeatsPerStride = Math.max(3, Math.round(stridePixels / 70));
  const spacing = stridePixels / repeatsPerStride;
  return {
    stridePixels,
    repeatsPerStride,
    spacing,
    offset: (wrap01(phase) * stridePixels) % spacing
  };
}

function drawGround(context, phase, groundY, preset, scale) {
  const ui = annotationScale();
  const pattern = groundPatternAt(phase, preset, scale);
  drawLine(
    context,
    { x: 42, y: groundY },
    { x: activeStage.width - 42, y: groundY },
    'rgba(242, 238, 228, .28)',
    1.15
  );
  context.save();
  context.strokeStyle = 'rgba(242, 238, 228, .12)';
  context.lineWidth = 1;
  for (
    let x = 28 - pattern.offset;
    x < activeStage.width - 20;
    x += pattern.spacing
  ) {
    context.beginPath();
    context.moveTo(x, groundY + 5);
    context.lineTo(x + Math.min(22, pattern.spacing * 0.32), groundY + 5);
    context.stroke();
  }
  context.font = `600 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = 'rgba(242, 238, 228, .72)';
  context.fillText('Ground reference', 48, groundY - 12 * ui);
  context.restore();
}

function drawShadow(context, x, groundY, width = 115, alpha = 0.26) {
  context.save();
  context.fillStyle = `rgba(0,0,0,${alpha * 0.42})`;
  context.beginPath();
  context.ellipse(x, groundY + 7, width / 2, 8, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSideOverlays(context, pose, map, options, preset) {
  const com = map(pose.com);
  const pelvis = map(pose.pelvis);
  const head = map(pose.head);
  const foot = pose.contactPoint ? map(pose.contactPoint) : null;

  if (options.geometry) {
    drawLine(
      context,
      { x: pelvis.x, y: 72 },
      { x: pelvis.x, y: 563 },
      'rgba(121,168,197,.28)',
      1,
      [5, 6]
    );
    drawLine(context, pelvis, head, 'rgba(121,168,197,.7)', 1.35, [4, 5]);
    context.save();
    context.beginPath();
    context.arc(com.x, com.y, 9, 0, Math.PI * 2);
    context.strokeStyle = COLOURS.rust;
    context.lineWidth = 1.5;
    context.stroke();
    drawLine(context, { x: com.x - 13, y: com.y }, { x: com.x + 13, y: com.y }, COLOURS.rust, 1);
    drawLine(context, { x: com.x, y: com.y - 13 }, { x: com.x, y: com.y + 13 }, COLOURS.rust, 1);
    context.restore();
    drawJointArc(
      context,
      map(pose.lead.knee),
      17,
      Math.PI * 0.1,
      Math.PI * 0.72,
      `${Math.round(pose.lead.angles.kneeFlexion)}°`
    );
  }

  if (options.forces && foot && pose.force.magnitudeBw > 0.03) {
    const ui = annotationScale();
    const end = {
      x: foot.x + pose.force.horizontalBw * 175,
      y: foot.y - pose.force.verticalBw * 54
    };
    drawArrow(context, foot, end, COLOURS.rust, 2.5);
    context.save();
    context.font = `650 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = '#e9a07a';
    context.fillText(`${pose.force.verticalBw.toFixed(1)}× BW`, end.x + 8 * ui, end.y - 4 * ui);
    context.restore();
  }

  const lens = options.lens;
  if (lens === 'posture') {
    drawTag(
      context,
      map(pose.shoulderCenter),
      pose.variant === 'waist' ? 'Waist fold' : 'Stacked column',
      'left',
      pose.variant === 'waist' ? COLOURS.rust : COLOURS.blue
    );
  } else if (lens === 'contact') {
    const anchor = foot || map(pose.lead.foot.toe);
    const stanceLeg = pose.lead.isStance
      ? pose.lead
      : pose.far.isStance
        ? pose.far
        : pose.lead;
    const ankleOffsetCm = Math.round(stanceLeg.ankle.x - stanceLeg.hip.x);
    const offsetLabel = `${ankleOffsetCm >= 0 ? '+' : '−'}${Math.abs(ankleOffsetCm)}`;
    drawTag(
      context,
      anchor,
      `Ankle ${offsetLabel} cm`,
      'right',
      COLOURS.rust
    );
  } else if (lens === 'recovery') {
    const recovered = pose.lead.isStance ? pose.far : pose.lead;
    drawTag(context, map(recovered.ankle), 'Short lever', 'left');
  } else if (lens === 'arms') {
    drawTag(context, map(pose.leadArm.elbow), 'Elbow path', 'right');
  } else {
    drawTag(context, com, 'Centre of mass', 'right', COLOURS.rust);
  }
}

function drawSideFigure(
  context,
  pose,
  { originX = 480, groundY = 555, scale = 2.5, ghost = false, overlays = null, preset = null } = {}
) {
  const map = mapWorld(originX, groundY, scale);
  if (!ghost) drawShadow(context, originX + 4, groundY, 124, 0.3);
  drawLeg(context, pose.far, map, true, ghost);
  drawArm(context, pose.farArm, map, true, ghost);
  drawTorso(context, pose, map, ghost);
  drawShorts(context, pose, map, ghost);
  drawLeg(context, pose.lead, map, false, ghost);
  drawArm(context, pose.leadArm, map, false, ghost);
  drawHead(context, pose, map, ghost);

  if (!ghost && overlays?.geometry) drawSkeleton(context, pose, map);
  if (!ghost && overlays && preset) drawSideOverlays(context, pose, map, overlays, preset);
}

function drawFlowGuides(context, state, pose, map, rear = false) {
  if (state.mode !== 'flow' || state.flowStep !== 'see') return;
  if (state.flowNeed === 'arms' && rear) {
    const center = map({ x: 0, y: 0 }).x;
    const shoulderTop = map(pose.shoulderCenter).y - 20;
    const hipBottom = map(pose.pelvis).y + 120;
    drawLine(context, { x: center, y: shoulderTop }, { x: center, y: hipBottom }, 'rgba(245,241,232,.34)', 1, [5, 6]);
    for (const sign of [-1, 1]) {
      context.save();
      context.beginPath();
      context.setLineDash([8, 8]);
      context.moveTo(center + sign * 62, shoulderTop + 18);
      context.quadraticCurveTo(
        center + sign * 10,
        (shoulderTop + hipBottom) / 2,
        center - sign * 20,
        hipBottom
      );
      context.strokeStyle = 'rgba(245,241,232,.18)';
      context.lineWidth = 2;
      context.stroke();
      context.restore();
      context.save();
      context.beginPath();
      context.moveTo(center + sign * 62, shoulderTop + 18);
      context.quadraticCurveTo(
        center + sign * 38,
        (shoulderTop + hipBottom) / 2,
        center + sign * 24,
        hipBottom
      );
      context.strokeStyle = 'rgba(196,90,44,.78)';
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }
  } else if (state.flowNeed === 'knees' && rear) {
    for (const x of [pose.lead.ankle.x, pose.far.ankle.x]) {
      const mapped = map({ x, y: 0 });
      drawLine(
        context,
        { x: mapped.x, y: Math.max(90, mapped.y - 480) },
        { x: mapped.x, y: mapped.y },
        'rgba(196,90,44,.7)',
        2
      );
    }
  } else if (state.flowNeed === 'reach' && !rear) {
    const hip = map(pose.lead.hip);
    const foot = map(pose.lead.ankle);
    drawLine(context, { x: hip.x, y: hip.y - 26 }, { x: hip.x, y: foot.y + 8 }, 'rgba(245,241,232,.38)', 1, [5, 6]);
    drawArrow(context, { x: foot.x, y: foot.y - 22 }, { x: hip.x, y: foot.y - 22 }, COLOURS.rust, 2.2);
  } else if (state.flowNeed === 'sit' && !rear) {
    drawLine(context, map(pose.pelvis), map(pose.head), COLOURS.rust, 2);
  }
}

function drawRearShoe(context, leg, map, far = false) {
  const ankle = map(leg.ankle);
  const soleY = map({ x: 0, y: Math.max(0, leg.foot.toe.y) }).y;
  context.save();
  roundedRect(context, ankle.x - 9, soleY - 7, 18, 11, 5);
  context.fillStyle = far ? '#747b88' : COLOURS.shoe;
  context.fill();
  context.strokeStyle = far ? '#505868' : '#767b84';
  context.lineWidth = 1;
  context.stroke();
  drawLine(context, { x: ankle.x - 9, y: soleY + 3 }, { x: ankle.x + 9, y: soleY + 3 }, COLOURS.sole, 2.4);
  context.restore();
}

function drawRearLeg(context, leg, map, far = false, ghost = false) {
  const hip = map(leg.hip);
  const knee = map(leg.knee);
  const ankle = map(leg.ankle);
  const fill = ghost ? '#68778a' : far ? COLOURS.skinFar : COLOURS.skinLead;
  const edge = ghost ? 'rgba(220,228,234,.2)' : far ? '#382c2d' : COLOURS.skinLine;
  const thighMid = between(hip, knee, 0.48);
  const calf = between(knee, ankle, 0.53);
  taperedLimb(context, hip, thighMid, 29, 34, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, thighMid, knee, 34, 20.5, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, knee, 10, fill, edge);
  taperedLimb(context, knee, calf, 19, 23.5, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, calf, ankle, 23.5, 11, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, ankle, 5.8, fill, edge);
  drawRearShoe(context, leg, map, far || ghost);
}

function drawRearTorso(context, pose, map, ghost = false) {
  const shoulderLead = map(pose.shoulderLead);
  const shoulderFar = map(pose.shoulderFar);
  const hipLead = map(pose.hipLead);
  const hipFar = map(pose.hipFar);
  const shoulderY = (shoulderLead.y + shoulderFar.y) / 2;
  const hipY = (hipLead.y + hipFar.y) / 2;
  const waistY = shoulderY * 0.44 + hipY * 0.56;
  const waistHalf = Math.abs(hipLead.x - hipFar.x) * 0.37;
  const centerX = (shoulderLead.x + shoulderFar.x) / 2;

  context.save();
  context.beginPath();
  context.moveTo(shoulderFar.x, shoulderFar.y);
  context.bezierCurveTo(
    shoulderFar.x + 6,
    shoulderFar.y + 30,
    centerX - waistHalf - 4,
    waistY - 8,
    centerX - waistHalf,
    waistY
  );
  context.quadraticCurveTo(centerX - waistHalf - 3, hipY - 14, hipFar.x, hipFar.y);
  context.lineTo(hipLead.x, hipLead.y);
  context.quadraticCurveTo(centerX + waistHalf + 3, hipY - 14, centerX + waistHalf, waistY);
  context.bezierCurveTo(
    centerX + waistHalf + 4,
    waistY - 8,
    shoulderLead.x - 6,
    shoulderLead.y + 30,
    shoulderLead.x,
    shoulderLead.y
  );
  context.quadraticCurveTo(centerX, shoulderY - 12, shoulderFar.x, shoulderFar.y);
  context.closePath();
  context.fillStyle = ghost ? '#68778a' : COLOURS.singlet;
  context.fill();
  context.strokeStyle = ghost ? 'rgba(220,228,234,.2)' : '#733321';
  context.lineWidth = 1;
  context.stroke();

  if (!ghost) {
    drawLine(
      context,
      { x: shoulderFar.x + 10, y: shoulderFar.y + 10 },
      { x: shoulderLead.x - 10, y: shoulderLead.y + 10 },
      'rgba(255,255,255,.14)',
      1
    );
  }

  context.beginPath();
  context.moveTo(hipFar.x - 5, hipFar.y - 3);
  context.lineTo(hipLead.x + 5, hipLead.y - 3);
  context.lineTo(hipLead.x + 8, hipLead.y + 16);
  context.lineTo(centerX, Math.max(hipLead.y, hipFar.y) + 12);
  context.lineTo(hipFar.x - 8, hipFar.y + 16);
  context.closePath();
  context.fillStyle = ghost ? '#5f6f84' : COLOURS.shorts;
  context.fill();
  context.strokeStyle = ghost ? 'rgba(220,228,234,.2)' : '#0c1728';
  context.stroke();
  context.restore();
}

function drawRearArm(context, arm, map, far = false, ghost = false) {
  const fill = ghost ? '#68778a' : far ? COLOURS.skinFar : COLOURS.skinLead;
  const edge = ghost ? 'rgba(220,228,234,.2)' : far ? '#382c2d' : COLOURS.skinLine;
  const shoulder = map(arm.shoulder);
  const elbow = map(arm.elbow);
  const wrist = map(arm.wrist);
  const upperMid = between(shoulder, elbow, 0.52);
  const forearmMid = between(elbow, wrist, 0.48);
  taperedLimb(context, shoulder, upperMid, 16, 17, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, upperMid, elbow, 17, 11.3, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, elbow, 5.8, fill, edge);
  taperedLimb(context, elbow, forearmMid, 11.5, 13, fill, edge, far ? fill : COLOURS.skinLight);
  taperedLimb(context, forearmMid, wrist, 13, 7, fill, edge, far ? fill : COLOURS.skinLight);
  jointBlend(context, wrist, 4.6, fill, edge);
}

function drawRearHead(context, pose, map, ghost = false) {
  const head = map(pose.head);
  const neck = map(pose.neck);
  const shoulder = map(pose.shoulderCenter);
  taperedLimb(
    context,
    shoulder,
    neck,
    16,
    10.5,
    ghost ? '#667588' : COLOURS.skinLead,
    ghost ? 'rgba(220,228,234,.2)' : COLOURS.skinLine
  );
  context.save();
  context.beginPath();
  context.ellipse(head.x, head.y, 18, 22, 0, 0, Math.PI * 2);
  context.fillStyle = ghost ? '#69788b' : COLOURS.skinLead;
  context.fill();
  context.strokeStyle = ghost ? 'rgba(220,228,234,.2)' : COLOURS.skinLine;
  context.lineWidth = 1;
  context.stroke();
  context.beginPath();
  context.arc(head.x, head.y - 5, 17, Math.PI, Math.PI * 2);
  context.fillStyle = ghost ? '#5d6d82' : COLOURS.hair;
  context.fill();
  context.restore();
}

function drawRearOverlays(context, pose, map, options, preset) {
  const centerX = map({ x: 0, y: 0 }).x;
  const groundY = map({ x: 0, y: 0 }).y;
  if (options.geometry) {
    const halfCorridor = (preset.stepWidthCm / 2) * 2.5;
    context.save();
    context.fillStyle = 'rgba(121,168,197,.055)';
    context.fillRect(centerX - halfCorridor, 88, halfCorridor * 2, groundY - 88);
    drawLine(context, { x: centerX, y: 72 }, { x: centerX, y: groundY }, 'rgba(121,168,197,.44)', 1, [5, 6]);
    drawLine(context, map(pose.hipFar), map(pose.hipLead), COLOURS.blue, 1.6);
    for (const leg of [pose.far, pose.lead]) {
      drawLine(context, map(leg.hip), map(leg.knee), 'rgba(232,237,235,.64)', 1.1);
      drawLine(context, map(leg.knee), map(leg.ankle), 'rgba(232,237,235,.64)', 1.1);
      for (const point of [leg.hip, leg.knee, leg.ankle]) {
        const p = map(point);
        context.beginPath();
        context.arc(p.x, p.y, 3, 0, Math.PI * 2);
        context.fillStyle = COLOURS.ink;
        context.fill();
        context.strokeStyle = COLOURS.leadBone;
        context.lineWidth = 1.2;
        context.stroke();
      }
    }
    context.restore();
  }

  if (options.forces && pose.contactPoint && pose.force.magnitudeBw > 0.03) {
    const foot = map(pose.contactPoint);
    const end = { x: foot.x, y: foot.y - pose.force.verticalBw * 54 };
    drawArrow(context, foot, end, COLOURS.rust, 2.5);
  }

  if (options.lens === 'posture') {
    drawTag(context, map(pose.pelvis), `Pelvis ${pose.pelvisTiltDeg.toFixed(1)}°`, 'right');
  } else if (options.lens === 'contact') {
    const stance = pose.lead.isStance ? pose.lead : pose.far;
    drawTag(context, map(stance.ankle), 'Own narrow track', stance.ankle.x > 0 ? 'right' : 'left', COLOURS.rust);
  } else if (options.lens === 'arms') {
    for (const arm of [pose.leadArm, pose.farArm]) {
      drawLine(
        context,
        map(arm.shoulder),
        map(arm.wrist),
        'rgba(185,192,200,.46)',
        1,
        [4, 5]
      );
    }
    drawTag(
      context,
      map(pose.leadArm.wrist),
      'Inward hand path',
      pose.leadArm.wrist.x > 0 ? 'right' : 'left'
    );
  } else {
    const stance = pose.lead.isStance ? pose.lead : pose.far;
    drawTag(context, map(stance.knee), 'Knee stays in its lane', stance.knee.x > 0 ? 'right' : 'left');
  }
}

function drawRearFigure(
  context,
  pose,
  { originX = 500, groundY = 555, scale = 2.5, ghost = false, overlays = null, preset = null } = {}
) {
  const map = mapWorld(originX, groundY, scale);
  if (!ghost) drawShadow(context, originX, groundY, 92, 0.28);
  const arms = [
    { arm: pose.farArm, far: true },
    { arm: pose.leadArm, far: false }
  ];
  const armDepth = ({ arm }) =>
    ((arm.depth?.elbow || 0) + (arm.depth?.wrist || 0)) / 2;
  const behind = arms.filter((item) => armDepth(item) >= 0);
  const inFront = arms.filter((item) => armDepth(item) < 0);
  drawRearLeg(context, pose.far, map, true, ghost);
  behind.forEach(({ arm, far }) => drawRearArm(context, arm, map, far, ghost));
  drawRearTorso(context, pose, map, ghost);
  drawRearLeg(context, pose.lead, map, false, ghost);
  inFront.forEach(({ arm, far }) => drawRearArm(context, arm, map, far, ghost));
  drawRearHead(context, pose, map, ghost);
  if (!ghost && overlays && preset) drawRearOverlays(context, pose, map, overlays, preset);
}

function drawSideScene(context, state, preset, profile) {
  const pose = computeSidePose(state.phase, preset, profile);
  const portrait = activeStage === PORTRAIT_STAGE;
  const camera = portrait
    ? { originX: 310, groundY: 730, scale: 3.25 }
    : { originX: 480, groundY: 555, scale: 2.5 };
  drawGround(context, state.phase, camera.groundY, preset, camera.scale);
  const isFlow = state.mode === 'flow';
  const overlays = isFlow
    ? { geometry: false, forces: false, trail: false }
    : state.overlays;

  if (overlays.trail) {
    [0.06, 0.12, 0.18].forEach((offset, index) => {
      const ghost = computeSidePose(wrap01(state.phase - offset), preset, profile);
      mixAlpha(context, 0.15 - index * 0.027, () => {
        drawSideFigure(context, ghost, { ghost: true });
      });
    });
  }

  drawSideFigure(context, pose, {
    ...camera,
    overlays:
      isFlow && state.flowStep !== 'see'
        ? null
        : { ...overlays, lens: state.lens },
    preset
  });
  drawFlowGuides(context, state, pose, mapWorld(camera.originX, camera.groundY, camera.scale), false);
}

function drawRearScene(context, state, preset, profile) {
  const pose = computeRearPose(state.phase, preset, profile);
  const portrait = activeStage === PORTRAIT_STAGE;
  const camera = portrait
    ? { originX: 310, groundY: 730, scale: 3.25 }
    : { originX: 500, groundY: 555, scale: 2.5 };
  drawGround(context, state.phase, camera.groundY, preset, camera.scale);
  const isFlow = state.mode === 'flow';
  const overlays = isFlow
    ? { geometry: false, forces: false, trail: false }
    : state.overlays;
  if (overlays.trail) {
    [0.07, 0.14].forEach((offset, index) => {
      const ghost = computeRearPose(wrap01(state.phase - offset), preset, profile);
      mixAlpha(context, 0.13 - index * 0.035, () => {
        drawRearFigure(context, ghost, { ghost: true });
      });
    });
  }
  drawRearFigure(context, pose, {
    ...camera,
    overlays:
      isFlow && state.flowStep !== 'see'
        ? null
        : { ...overlays, lens: state.lens },
    preset
  });
  drawFlowGuides(context, state, pose, mapWorld(camera.originX, camera.groundY, camera.scale), true);
}

function drawContrastLabels(context, mode) {
  const ui = annotationScale();
  context.save();
  context.font = `650 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.fillStyle = '#8f9cad';
  context.fillText('Reference relationship', 260, 74);
  context.fillStyle = '#e19a77';
  const labels = {
    overreach: 'Over-reach pattern',
    waist: 'Waist-fold pattern',
    crossover: 'Crossover pattern'
  };
  context.fillText(labels[mode], 740, 74);
  context.font = `500 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.fillStyle = '#8f9cad';
  context.fillText('Quiet stack · soft knee · modest reach', 260, 98);
  const captions = {
    overreach: 'Foot farther ahead · straighter knee · more braking',
    waist: 'Ribs ahead of pelvis · broken stack · extra demand',
    crossover: 'Foot crosses centre · knee follows inward · pelvis drops'
  };
  context.fillText(captions[mode], 740, 98);
  drawLine(context, { x: 500, y: 52 }, { x: 500, y: 578 }, 'rgba(242,238,228,.13)', 1);
  context.restore();
}

function drawPortraitContrastLabel(context, title, caption, y, variant = false) {
  const ui = annotationScale();
  context.save();
  context.textAlign = 'center';
  context.fillStyle = variant ? '#e19a77' : '#b9c0c8';
  context.font = `650 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.fillText(title, 310, y);
  context.fillStyle = '#aab1ba';
  context.font = `500 ${13 * ui}px ui-sans-serif, system-ui, sans-serif`;
  context.fillText(caption, 310, y + 16 * ui);
  context.restore();
}

function drawContrastScene(context, state, preset, profile) {
  const mode = state.contrast;
  if (activeStage === PORTRAIT_STAGE) {
    const labels = {
      overreach: ['Over-reach pattern', 'Foot farther ahead · more braking'],
      waist: ['Waist-fold pattern', 'Ribs ahead of pelvis · broken stack'],
      crossover: ['Crossover pattern', 'Foot crosses centre · knee follows inward']
    };
    drawPortraitContrastLabel(
      context,
      'Reference relationship',
      'Quiet stack · soft knee · modest reach',
      32,
      false
    );
    drawPortraitContrastLabel(context, labels[mode][0], labels[mode][1], 414, true);
    drawLine(context, { x: 38, y: 390 }, { x: 582, y: 390 }, 'rgba(242,238,228,.16)', 1);
    if (mode === 'crossover') {
      const phase = preset.stanceFraction * 0.56;
      drawRearFigure(context, computeRearPose(phase, preset, profile), {
        originX: 310,
        groundY: 374,
        scale: 1.55,
        overlays: { geometry: true, forces: false, lens: 'contact' },
        preset
      });
      drawRearFigure(
        context,
        computeRearPose(phase, preset, profile, { variant: 'crossover' }),
        {
          originX: 310,
          groundY: 756,
          scale: 1.55,
          overlays: { geometry: true, forces: false, lens: 'posture' },
          preset
        }
      );
    } else {
      const phase = mode === 'overreach' ? 0.012 : 0.1;
      drawSideFigure(context, computeSidePose(phase, preset, profile), {
        originX: 310,
        groundY: 374,
        scale: 1.55,
        overlays: { geometry: true, forces: state.overlays.forces, lens: 'contact' },
        preset
      });
      drawSideFigure(
        context,
        computeSidePose(phase, preset, profile, { variant: mode }),
        {
          originX: 310,
          groundY: 756,
          scale: 1.55,
          overlays: {
            geometry: true,
            forces: state.overlays.forces,
            lens: mode === 'waist' ? 'posture' : 'contact'
          },
          preset
        }
      );
    }
    return;
  }
  drawContrastLabels(context, mode);
  if (mode === 'crossover') {
    const phase = preset.stanceFraction * 0.56;
    const reference = computeRearPose(phase, preset, profile);
    const error = computeRearPose(phase, preset, profile, { variant: 'crossover' });
    drawLine(context, { x: 52, y: 553 }, { x: 948, y: 553 }, 'rgba(242,238,228,.25)', 1);
    drawRearFigure(context, reference, {
      originX: 255,
      groundY: 553,
      scale: 2.2,
      overlays: { geometry: true, forces: false, lens: 'contact' },
      preset
    });
    drawRearFigure(context, error, {
      originX: 745,
      groundY: 553,
      scale: 2.2,
      overlays: { geometry: true, forces: false, lens: 'posture' },
      preset
    });
  } else {
    const phase = mode === 'overreach' ? 0.012 : 0.1;
    const reference = computeSidePose(phase, preset, profile);
    const error = computeSidePose(phase, preset, profile, { variant: mode });
    drawLine(context, { x: 52, y: 553 }, { x: 948, y: 553 }, 'rgba(242,238,228,.25)', 1);
    drawSideFigure(context, reference, {
      originX: 248,
      groundY: 553,
      scale: 2.16,
      overlays: { geometry: true, forces: state.overlays.forces, lens: 'contact' },
      preset
    });
    drawSideFigure(context, error, {
      originX: 735,
      groundY: 553,
      scale: 2.16,
      overlays: { geometry: true, forces: state.overlays.forces, lens: mode === 'waist' ? 'posture' : 'contact' },
      preset
    });
  }
}

export function renderStage(canvas, state, preset, profile = PROFILE) {
  const context = prepareCanvas(canvas);
  context.save();
  if (state.view === 'rear') drawRearScene(context, state, preset, profile);
  else if (state.view === 'contrast') drawContrastScene(context, state, preset, profile);
  else drawSideScene(context, state, preset, profile);
  context.restore();
}
