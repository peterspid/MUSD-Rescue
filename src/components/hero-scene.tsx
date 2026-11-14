"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float } from "@react-three/drei";
import * as THREE from "three";
import { hfColor as hfRgb, clearanceHeight } from "./hero-color";

function hfColor(hf: number) {
  const c = hfRgb(hf);
  return new THREE.Color(c.r, c.g, c.b);
}

const planeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const planeFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDanger;
  uniform vec2 uShadow;
  uniform float uShadowSize;
  varying vec3 vPos;
  float grid(vec2 p, float s) {
    vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    vec2 p = vPos.xy;
    float r = length(p);
    float fade = smoothstep(6.0, 1.5, r);
    float g = grid(p, 0.5) * 0.55 + grid(p, 2.0) * 0.6;
    float pulse = 0.55 + 0.45 * sin(uTime * (1.6 + uDanger * 4.0));
    float ring = smoothstep(0.05, 0.0, abs(r - 4.6)) * 0.8;
    vec3 base = vec3(0.94, 0.33, 0.31);
    float glow = (g * 0.9 + ring) * fade * (0.85 + uDanger * 0.65 * pulse);
    float shadow = smoothstep(uShadowSize, 0.0, length(p - uShadow)) * 0.55;
    vec3 col = base * glow + base * shadow * (0.4 + uDanger);
    float alpha = clamp(glow + shadow * 0.6 + fade * 0.06, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

function LiquidationPlane({ danger, height }: { danger: number; height: React.MutableRefObject<number> }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uDanger: { value: 0 }, uShadow: { value: new THREE.Vector2(0, 0) }, uShadowSize: { value: 1.2 } }), []);
  useFrame((s, dt) => {
    if (!mat.current) return;
    mat.current.uniforms.uTime.value += dt;
    mat.current.uniforms.uDanger.value = THREE.MathUtils.lerp(mat.current.uniforms.uDanger.value, danger, 0.08);
    mat.current.uniforms.uShadowSize.value = 0.7 + Math.max(0, height.current) * 0.45;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <circleGeometry args={[6, 96]} />
      <shaderMaterial ref={mat} vertexShader={planeVertex} fragmentShader={planeFragment} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Collateral({ targetHeight, color, heightRef, animate }: { targetHeight: number; color: THREE.Color; heightRef: React.MutableRefObject<number>; animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  const tether = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const k = animate ? 1 - Math.pow(0.002, dt) : 1;
    heightRef.current = THREE.MathUtils.lerp(heightRef.current, targetHeight, k);
    if (group.current) {
      group.current.position.y = heightRef.current;
      if (animate) group.current.rotation.y += dt * 0.35;
    }
    if (mat.current) {
      mat.current.color.lerp(color, k);
      mat.current.emissive.lerp(color, k);
    }
    if (tether.current) {
      const h = Math.max(0.001, heightRef.current - 0.62);
      tether.current.scale.y = h;
      tether.current.position.y = h / 2;
      tether.current.visible = heightRef.current > 0.65;
    }
  });
  return (
    <>
      <mesh ref={tether}>
        <cylinderGeometry args={[0.012, 0.012, 1, 8]} />
        <meshBasicMaterial color="#7fe0d9" transparent opacity={0.5} />
      </mesh>
      <group ref={group}>
        <mesh castShadow>
          <icosahedronGeometry args={[0.62, 6]} />
          <meshPhysicalMaterial ref={mat} color="#4cbf80" emissive="#4cbf80" emissiveIntensity={0.42} metalness={0.25} roughness={0.28} clearcoat={1} clearcoatRoughness={0.15} />
        </mesh>
        {/* Bitcoin-ish band around the sphere: a collateral "coin" edge */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.78, 0.018, 12, 96]} />
          <meshStandardMaterial color="#e8ecef" metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
    </>
  );
}

function Rig({ animate }: { animate: boolean }) {
  useFrame((s) => {
    if (!animate) return;
    const t = s.clock.elapsedTime * 0.12;
    s.camera.position.x = Math.sin(t) * 7.4;
    s.camera.position.z = Math.cos(t) * 7.4;
    s.camera.lookAt(0, 1.2, 0);
  });
  return null;
}

export default function HeroScene({ icrPct, hf }: { icrPct: number; hf: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const heightRef = useRef(clearanceHeight(icrPct));
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener("change", onMq);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    if (wrap.current) io.observe(wrap.current);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mq.removeEventListener("change", onMq);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const color = useMemo(() => hfColor(hf), [hf]);
  const danger = hf <= 1 ? 1 : hf < 1.5 ? (1.5 - hf) / 0.5 : 0;
  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={[1, 1.75]}
        frameloop={visible ? (reduced ? "demand" : "always") : "never"}
        camera={{ position: [0, 3.2, 7.4], fov: 38 }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        onCreated={({ camera }) => camera.lookAt(0, 1.2, 0)}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} />
        <pointLight position={[0, -0.5, 0]} intensity={danger * 6} color="#f0544f" distance={6} />
        <Environment preset="city" environmentIntensity={0.22} />
        <Float enabled={!reduced} speed={1.2} rotationIntensity={0} floatIntensity={0.25} floatingRange={[-0.04, 0.04]}>
          <Collateral targetHeight={clearanceHeight(icrPct)} color={color} heightRef={heightRef} animate={!reduced} />
        </Float>
        <LiquidationPlane danger={danger} height={heightRef} />
        <Rig animate={!reduced} />
      </Canvas>
    </div>
  );
}
