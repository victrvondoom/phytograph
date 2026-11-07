import * as THREE from "three";
import type { RobotState } from "../../lib/robots";

export const STATE_COLOR: Record<RobotState, number> = {
  idle: 0x4b5d66,
  running: 0xf2b84b,
  ok: 0x3fd0a5,
  attention: 0xe4705a,
  failed: 0xff4d6d,
  skipped: 0x6b7b86,
};

export interface RobotRig {
  group: THREE.Group;
  chest: THREE.Mesh;
  visor: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  body: THREE.Group;
  shadow: THREE.Mesh;
  scale: number;
}

const shell = new THREE.MeshStandardMaterial({ color: 0xd9e4df, metalness: 0.35, roughness: 0.32 });
const joint = new THREE.MeshStandardMaterial({ color: 0x2a3b35, metalness: 0.6, roughness: 0.4 });
const visorMat = new THREE.MeshStandardMaterial({ color: 0x0d1714, emissive: 0x3fd0a5, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.1 });

/** A humanoid robot built from primitives: torso, head with visor, articulated arms and legs, status chest light. */
export function buildRobot(accent: number, scale = 1): RobotRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.56), shell);
  torso.position.y = 1.9;
  torso.castShadow = true;
  body.add(torso);

  const chest = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 24, 16),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.6 }),
  );
  chest.position.set(0, 1.95, 0.29);
  body.add(chest);

  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.5), joint);
  hip.position.y = 1.19;
  body.add(hip);

  const head = new THREE.Group();
  head.position.y = 2.7;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.56, 0.56), shell);
  skull.castShadow = true;
  head.add(skull);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.02), visorMat);
  visor.position.set(0, 0.04, 0.29);
  head.add(visor);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), joint);
  antenna.position.y = 0.38;
  head.add(antenna);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4 }));
  antennaTip.position.y = 0.52;
  head.add(antennaTip);

  const makeArm = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.6, 2.2, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.62, 14), shell);
    upper.position.y = -0.31;
    upper.castShadow = true;
    pivot.add(upper);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.56, 14), joint);
    forearm.position.y = -0.84;
    pivot.add(forearm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), shell);
    hand.position.y = -1.16;
    pivot.add(hand);
    body.add(pivot);
    return pivot;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  const makeLeg = (side: 1 | -1) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.22, 1.02, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.62, 14), shell);
    thigh.position.y = -0.31;
    thigh.castShadow = true;
    leg.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.6, 14), joint);
    shin.position.y = -0.92;
    leg.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.4), shell);
    foot.position.set(0, -1.28, 0.08);
    leg.add(foot);
    body.add(leg);
  };
  makeLeg(-1);
  makeLeg(1);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 36),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  group.add(shadow);

  group.scale.setScalar(scale);
  return { group, chest, visor, armL, armR, head, body, shadow, scale };
}

export function setRobotState(rig: RobotRig, state: RobotState): void {
  const color = STATE_COLOR[state];
  const mat = rig.chest.material as THREE.MeshStandardMaterial;
  mat.color.setHex(color);
  mat.emissive.setHex(color);
  const vm = rig.visor.material as THREE.MeshStandardMaterial;
  vm.emissive.setHex(state === "failed" ? 0xff4d6d : state === "attention" ? 0xf2b84b : state === "ok" ? 0x3fd0a5 : 0x5b6f78);
  vm.emissiveIntensity = state === "idle" || state === "skipped" ? 0.25 : 0.95;
}

/** Per-frame motion: idle breathing, working arm swing, done nod, failure shake. */
export function animateRobot(rig: RobotRig, state: RobotState, t: number, phase: number): void {
  const bob = Math.sin(t * 1.6 + phase) * 0.03;
  rig.body.position.y = bob;
  if (state === "running") {
    rig.armR.rotation.x = Math.sin(t * 6 + phase) * 0.9 - 0.4;
    rig.armL.rotation.x = Math.sin(t * 6 + phase + Math.PI) * 0.5 - 0.2;
    rig.head.rotation.y = Math.sin(t * 2 + phase) * 0.25;
  } else if (state === "ok") {
    rig.armR.rotation.x = -0.15;
    rig.armL.rotation.x = -0.15;
    rig.head.rotation.x = Math.sin(t * 1.2 + phase) * 0.06;
  } else if (state === "failed") {
    rig.head.rotation.y = Math.sin(t * 18) * 0.2;
    rig.armR.rotation.x = -0.9;
    rig.armL.rotation.x = -0.9;
  } else if (state === "attention") {
    rig.armR.rotation.x = -1.2 + Math.sin(t * 2 + phase) * 0.08;
    rig.armL.rotation.x = -0.2;
    rig.head.rotation.y = Math.sin(t * 0.7 + phase) * 0.15;
  } else {
    rig.armR.rotation.x = Math.sin(t * 1.2 + phase) * 0.05;
    rig.armL.rotation.x = -Math.sin(t * 1.2 + phase) * 0.05;
    rig.head.rotation.y = Math.sin(t * 0.5 + phase) * 0.1;
    rig.head.rotation.x = 0;
  }
  const pulse = state === "running" ? 1 + Math.sin(t * 6 + phase) * 0.15 : 1;
  rig.shadow.scale.setScalar(pulse);
}
