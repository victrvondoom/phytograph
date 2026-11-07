import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ROBOTS, STATE_LABEL, WORKERS, type RobotId, type RobotState } from "../../lib/robots";
import { STATE_COLOR, animateRobot, buildRobot, setRobotState, type RobotRig } from "./robotModel";

interface Props {
  states: Record<RobotId, RobotState>;
  selected: RobotId | null;
  onSelect: (id: RobotId) => void;
  /** When true the workers replay their recorded state in sequence (visual pacing only). */
  replaying: boolean;
}

const ACCENT: Record<RobotId, number> = {
  conductor: 0xa78bfa, intake: 0x7dd3fc, taxonomy: 0x3fd0a5, collector: 0x7fb069, quality: 0xe0a53a, consistency: 0xf2b84b, registry: 0x7dd3fc, dossier: 0xa78bfa,
};

export default function RobotStage({ states, selected, onSelect, replaying }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(true);
  const latest = useRef({ states, selected, replaying, onSelect });
  latest.current = { states, selected, replaying, onSelect };

  useEffect(() => {
    if (!host.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setWebgl(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.current.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "3D stage: a conductor robot and seven worker robots, each showing the state of one audit module.");

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1210, 12, 26);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 4.6, 10.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(0, 1.7, 0);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;

    scene.add(new THREE.HemisphereLight(0xbfe9dc, 0x0b1210, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.PointLight(0x3fd0a5, 1.4, 16);
    rim.position.set(-5, 4, -4);
    scene.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0x0f1d19, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(18, 36, 0x1f3a31, 0x15261f);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    scene.add(grid);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.85, 3.92, 96), new THREE.MeshBasicMaterial({ color: 0x3fd0a5, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);

    const rigs = new Map<RobotId, RobotRig>();
    const positions = new Map<RobotId, THREE.Vector3>();
    const conductor = buildRobot(ACCENT.conductor, 1.35);
    conductor.group.position.set(0, 0, 0);
    scene.add(conductor.group);
    rigs.set("conductor", conductor);
    positions.set("conductor", new THREE.Vector3(0, 0, 0));

    WORKERS.forEach((w, i) => {
      const angle = -Math.PI / 2 + (i / WORKERS.length) * Math.PI * 2;
      const pos = new THREE.Vector3(Math.cos(angle) * 3.9, 0, Math.sin(angle) * 3.9);
      const rig = buildRobot(ACCENT[w.id], 0.82);
      rig.group.position.copy(pos);
      rig.group.lookAt(0, 0, 0);
      scene.add(rig.group);
      rigs.set(w.id, rig);
      positions.set(w.id, pos);
    });

    // Links from the conductor to each worker, and one traveling pulse per worker (the "one voice" channel).
    const pulses = new Map<RobotId, THREE.Mesh>();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3fd0a5, transparent: true, opacity: 0.22 });
    WORKERS.forEach((w) => {
      const p = positions.get(w.id)!;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(p.x, 1.6, p.z)]);
      scene.add(new THREE.Line(geo, lineMat));
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshBasicMaterial({ color: 0x3fd0a5 }));
      scene.add(pulse);
      pulses.set(w.id, pulse);
    });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host.current!;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host.current);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const [id, rig] of rigs) {
        if (hits.some((h) => isDescendant(h.object, rig.group))) {
          latest.current.onSelect(id);
          break;
        }
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const clock = new THREE.Clock();
    const replayOrder = new Map<RobotId, number>();
    WORKERS.forEach((w, i) => replayOrder.set(w.id, i));
    let lastStates: Record<string, RobotState> = {};

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      const { states: st, selected: sel, replaying: rep } = latest.current;
      controls.autoRotate = !sel;
      controls.update();

      for (const [id, rig] of rigs) {
        const s: RobotState = id === "conductor" ? (rep ? "running" : st.conductor) : (rep ? replayState(t, replayOrder.get(id) ?? 0, st[id]) : st[id]);
        if (lastStates[id] !== s) {
          setRobotState(rig, s);
          lastStates[id] = s;
        }
        animateRobot(rig, s, t, (replayOrder.get(id) ?? 0) * 0.9);
        const shadowMat = rig.shadow.material as THREE.MeshBasicMaterial;
        const selectedRing = sel === id;
        shadowMat.color.setHex(selectedRing ? 0x3fd0a5 : 0x000000);
        shadowMat.opacity = selectedRing ? 0.5 : 0.35;
      }

      WORKERS.forEach((w, i) => {
        const pulse = pulses.get(w.id)!;
        const s = lastStates[w.id];
        const active = s === "running" || s === "ok";
        pulse.visible = active;
        if (active) {
          const p = positions.get(w.id)!;
          const k = (t * 0.6 + i * 0.13) % 1;
          pulse.position.set(p.x * k, 1.6 + Math.sin(k * Math.PI) * 0.6, p.z * k);
        }
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Scene is built once; state flows through latest.current each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full min-h-[340px] w-full overflow-hidden rounded-xl border border-[#1f3129] bg-[radial-gradient(ellipse_at_50%_20%,#15261f_0%,#0b1210_70%)]">
      <div ref={host} className="absolute inset-0" />
      {!webgl ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[#8aa398]">
          WebGL is unavailable in this browser. The robot states are listed on the right.
        </div>
      ) : null}
      <ul className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5" aria-label="Robot states">
        {ROBOTS.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-pressed={selected === r.id}
              className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] backdrop-blur ${selected === r.id ? "border-[#3fd0a5] bg-[#3fd0a5]/15 text-[#e6efe9]" : "border-[#1f3129] bg-[#0b1210]/80 text-[#c9d8d0] hover:border-[#2f4a40]"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: `#${STATE_COLOR[states[r.id]].toString(16).padStart(6, "0")}` }} aria-hidden />
              {r.name} · {STATE_LABEL[states[r.id]]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** During replay each worker shows "working" in sequence, then its recorded final state. */
function replayState(t: number, order: number, final: RobotState): RobotState {
  const start = order * 0.9;
  const cycle = t % (WORKERS.length * 0.9 + 2.5);
  if (cycle < start) return "idle";
  if (cycle < start + 0.9) return "running";
  return final;
}

function isDescendant(obj: THREE.Object3D, parent: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o === parent) return true;
    o = o.parent;
  }
  return false;
}
