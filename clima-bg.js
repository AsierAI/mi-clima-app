/**
 * Fondo WebGL: túnel galáctico abstracto — Vía Láctea, ondas de color,
 * estrellas en capas y geometría facetada (octaedros) muy sutil.
 */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.179/build/three.module.js";

const vs = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fs = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMotion;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  /* Octaedro regular — siluetas rocosas / cristales */
  float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735027;
  }

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, s, -s, c);
  }

  float rockField(vec3 p) {
    const float cell = 0.52;
    vec3 i = floor(p / cell);
    vec3 q = mod(p, cell) - cell * 0.5;

    float pick = hash13(i + 1.7);
    if (pick < 0.086) return 8.0;

    float hx = hash13(i + vec3(3.1, 9.0, 1.3));
    float hy = hash13(i + vec3(9.0, 1.3, 3.1));
    float hz = hash13(i + vec3(1.3, 3.1, 9.0));
    q.xy *= rot2(hx * 6.28318);
    q.yz *= rot2(hy * 6.28318);
    q.xz *= rot2(hz * 6.28318);

    float sz = 0.07 + 0.09 * pick;
    return sdOctahedron(q, sz);
  }

  float rockMap(vec3 p) {
    float twist = sin(p.z * 0.65 + uTime * uMotion * 0.22) * 0.11;
    p.xy += vec2(twist, twist * 0.55);
    return rockField(p);
  }

  vec3 rockNormal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      rockMap(p + e.xyy) - rockMap(p - e.xyy),
      rockMap(p + e.yxy) - rockMap(p - e.yxy),
      rockMap(p + e.yyx) - rockMap(p - e.yyx)
    ));
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= uResolution.x / max(uResolution.y, 1.0);

    float t = uTime * uMotion;
    float rush = 0.85;
    float zf = t * rush;

    float r = length(uv);
    float a = atan(uv.y, uv.x);
    vec2 sp = uv / max(r, 1e-4);

    /* --- Base: vacío profundo + núcleo lejano --- */
    vec3 col = vec3(0.012, 0.01, 0.038);
    float coreGlow = exp(-r * r * 5.5) * 0.22;
    col += vec3(0.2, 0.12, 0.32) * coreGlow;

    /* --- Banda Vía Láctea (polvo + gas) --- */
    vec2 mwUv = vUv - vec2(0.42, 0.52);
    float mwAng = dot(normalize(mwUv + 1e-5), vec2(0.68, 0.38));
    float band = pow(max(0.0, 1.0 - abs(mwAng) * 3.8), 2.8);
    float wisps = 0.5 + 0.5 * sin(dot(vUv * 1.3, vec2(18.0, 11.0)) + t * 0.12);
    float band2 = pow(max(0.0, 1.0 - abs(dot(normalize(vUv - 0.5 + 1e-5), vec2(-0.5, 0.72))) * 2.2), 4.0) * 0.35;

    vec3 dustA = vec3(0.12, 0.1, 0.28);
    vec3 dustB = vec3(0.28, 0.22, 0.42);
    col += band * dustA * (0.28 + 0.12 * wisps);
    col += band * dustB * 0.12 * sin(t * 0.18 + mwAng * 6.28318);
    col += band2 * vec3(0.08, 0.1, 0.22);

    /* --- Ondas de color muy sutiles --- */
    float depthVis = (1.0 / max(r, 0.14)) * 0.28 + zf * 0.08;
    float w1 = sin(depthVis * 1.4 + a * 2.1 + t * 0.35);
    float w2 = cos(depthVis * 0.9 - a * 1.6 - t * 0.28);
    col += vec3(0.04, 0.06, 0.12) * w1 * 0.12;
    col += vec3(0.06, 0.03, 0.1) * w2 * 0.1;
    col += vec3(0.02, 0.08, 0.09) * sin(depthVis + t * 0.5) * 0.06;

    /* --- Estrellas en capas (parallax / túnel) --- */
    for (int layer = 0; layer < 4; layer++) {
      float L = float(layer);
      float sc = 18.0 + L * 32.0;
      float zl = zf * (0.55 + L * 0.38);
      vec2 off = vec2(0.11, 0.07) * (1.0 + L * 0.2);
      vec2 g = sp * sc + zl * off;
      vec2 cell = floor(g);
      vec2 gv = fract(g) - 0.5;
      float h = hash12(cell + L * 41.7);
      float st = smoothstep(0.988, 1.0, h);
      float tw = 0.55 + 0.45 * sin(t * (2.2 + L * 0.4) + h * 50.0);
      vec3 scol = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.82, 0.65), hash12(cell + 9.0));
      float fall = 1.0 / (0.18 + L * 0.22);
      float dist = length(gv);
      st *= smoothstep(0.08, 0.0, dist) * tw * fall * 0.35;
      col += scol * st;
    }

    /* --- Asteroides: marcha corta, mezcla muy suave --- */
    vec3 ro = vec3(0.0, 0.0, -1.15 - zf * 0.32);
    vec3 rd = normalize(vec3(uv * 0.88, 1.05));
    float td = 0.0;
    vec3 rCol = vec3(0.0);
    float hit = 0.0;
    for (int i = 0; i < 22; i++) {
      vec3 pos = ro + rd * td;
      float d = rockMap(pos);
      if (d < 0.0025) {
        vec3 n = rockNormal(pos);
        vec3 Ldir = normalize(vec3(0.25, 0.55, 0.15));
        float diff = max(dot(n, Ldir), 0.0);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.4);
        rCol = vec3(0.045, 0.05, 0.09);
        rCol += vec3(0.12, 0.1, 0.22) * diff * 0.55;
        rCol += vec3(0.2, 0.16, 0.28) * rim * 0.35;
        hit = (1.0 - smoothstep(0.0, 0.35, td)) * 0.28;
        break;
      }
      td += clamp(d, 0.02, 0.35);
      if (td > 4.5) break;
    }
    col = mix(col, col * 0.88 + rCol * 1.1, hit);

    /* Viñeta + grano fino */
    float vig = 0.88 + 0.12 * (1.0 - smoothstep(0.0, 1.65, r));
    col *= vig;

    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.012;

    col = pow(col, vec3(0.96));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function main() {
  try {
    const canvas = document.getElementById("clima-canvas-bg");
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uMotion: { value: prefersReducedMotion() ? 0.0 : 1.0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vs,
      fragmentShader: fs,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(w, h);
    }

    resize();
    window.addEventListener("resize", resize);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      uniforms.uMotion.value = mq.matches ? 0.0 : 1.0;
    };
    mq.addEventListener("change", onMotion);

    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;

    function tick() {
      if (!running) return;
      uniforms.uTime.value = clock.getElapsedTime();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    tick();

    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running) tick();
      else cancelAnimationFrame(raf);
    });
  } catch {
    document.body.classList.add("clima-bg-fallback");
  }
}

main();
