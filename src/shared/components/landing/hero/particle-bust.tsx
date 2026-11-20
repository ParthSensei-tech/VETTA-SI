import { useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";

const VERT = /* glsl */ `
attribute vec2 aUv;
attribute float aSeed;
uniform float uTime;
uniform float uForm;
uniform float uSize;
uniform float uPixelRatio;
uniform sampler2D uBust;
varying float vAlpha;
varying float vSeed;

void main() {
  float mask = texture2D(uBust, aUv).r;
  float inside = smoothstep(0.25, 0.6, mask);
  vec3 target = vec3((aUv.x - 0.5) * 2.7, (aUv.y - 0.5) * 3.3, (aSeed - 0.5) * 0.45);

  float f = clamp((uForm - aSeed * 0.35) / 0.65, 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);

  vec3 scatter = position;
  scatter.x += sin(uTime * 0.12 + aSeed * 31.0) * 0.4;
  scatter.y += cos(uTime * 0.10 + aSeed * 17.0) * 0.32;
  scatter.z += sin(uTime * 0.08 + aSeed * 23.0) * 0.3;

  vec3 pos = mix(scatter, target, f * inside);
  vAlpha = mix(0.1, 1.0, f * inside);
  vSeed = aSeed;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uSize * uPixelRatio * (0.7 + aSeed * 0.9) * (3.4 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uMint;
uniform vec3 uGlacier;
varying float vAlpha;
varying float vSeed;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  if (a < 0.015) discard;
  vec3 col = mix(uMint, uGlacier, step(0.86, vSeed));
  gl_FragColor = vec4(col, a);
}
`;

/** 14s cycle: converge 0-3, hold 3-8, partial disperse 8-10, re-form 10-14. */
function formAt(t: number): number {
  const p = t % 14;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (p < 3) return ease(p / 3);
  if (p < 8) return 1;
  if (p < 10) return 1 - 0.45 * ease((p - 8) / 2);
  return 0.55 + 0.45 * ease((p - 10) / 4);
}

function BustPoints({ count, active }: { count: number; active: boolean }) {
  const bust = useLoader(THREE.TextureLoader, "/bust-mask.webp");
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * 6.4;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
      uv[i * 2] = Math.random();
      uv[i * 2 + 1] = Math.random();
      seed[i] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aUv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return geo;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uForm: { value: 0 },
      uSize: { value: 2.6 },
      uPixelRatio: { value: 1 },
      uBust: { value: bust },
      uMint: { value: new THREE.Color("#7cf2c0") },
      uGlacier: { value: new THREE.Color("#8fb8d9") },
    }),
    [bust],
  );

  useFrame((state, delta) => {
    if (!active || !material.current) return;
    const m = material.current;
    m.uniforms.uTime.value = state.clock.elapsedTime;
    m.uniforms.uForm.value = formAt(state.clock.elapsedTime);
    m.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
    if (group.current) {
      const damp = 1 - Math.exp(-3 * delta);
      group.current.rotation.y += (state.pointer.x * 0.14 - group.current.rotation.y) * damp;
      group.current.rotation.x += (-state.pointer.y * 0.07 - group.current.rotation.x) * damp;
    }
  });

  return (
    <group ref={group}>
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          vertexShader={VERT}
          fragmentShader={FRAG}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export default function ParticleBust({
  count,
  active,
}: {
  count: number;
  active: boolean;
}) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 4.4], fov: 45 }}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      frameloop={active ? "always" : "never"}
      aria-hidden="true"
    >
      <BustPoints count={count} active={active} />
    </Canvas>
  );
}