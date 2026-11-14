// main.js — rendering and interaction only. Every number shown here is produced by
// src/core.mjs, the same module bench/verify.mjs runs in node, so the on-screen
// certificate can be compared bit-for-bit with data/reference.json.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  buildScene, makeSamples, analyticGradient, fdGradient, compareVectors,
  fit, energy, meanAbsF, bboxDiag, relDrop,
} from './src/core.mjs';

const $ = (id) => document.getElementById(id);
const errBox = $('err');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 500);
camera.position.set(2.6, 2.0, 3.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xbfe4ff, 1.4); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xffb27a, 0.7); rim.position.set(-4, -2, -3); scene.add(rim);
scene.add(new THREE.GridHelper(8, 16, 0x1b2433, 0x141b26));

const mat = new THREE.MeshStandardMaterial({
  color: 0x59d3a5, metalness: 0.15, roughness: 0.42,
  flatShading: false, wireframe: false, side: THREE.DoubleSide,
});
const wire = new THREE.MeshBasicMaterial({ color: 0x2d5f7a, wireframe: true, transparent: true, opacity: 0.35 });

let meshObj = null, wireObj = null, geo = null, states = null, refData = null, active = 0;

function buildGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(mesh.vertices.flat()), 3));
  g.setIndex(mesh.faces.flat());
  g.computeVertexNormals();
  return g;
}

function setIteration(k) {
  const st = states[active];
  const snap = st.snaps[Math.min(k, st.snaps.length - 1)];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(snap.vertices.flat()), 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const h = st.history[Math.min(k, st.history.length - 1)];
  $('iterLabel').textContent = String(h.iter);
  $('energy').textContent = h.energy.toExponential(6);
  $('meanabs').textContent = st.meanAbs[h.iter].toFixed(6);
  $('drop').textContent = (100 * relDrop(st.e0, h.energy)).toFixed(4) + ' %';
  const refE = refData.scenes[st.name].optEnergyEnd;
  $('refe').textContent = (h.iter === 60 ? refE : st.refHistory[h.iter]).toExponential(6);
}

function selectScene(i) {
  active = i;
  const st = states[i];
  const mesh = st.scene.mesh;
  if (geo) geo.dispose();
  geo = buildGeometry(mesh);
  if (!meshObj) {
    meshObj = new THREE.Mesh(geo, mat);
    wireObj = new THREE.Mesh(geo, wire);
    scene.add(meshObj, wireObj);
  } else {
    meshObj.geometry = geo; wireObj.geometry = geo;
  }
  const bs = geo.boundingSphere || (geo.computeBoundingSphere(), geo.boundingSphere);
  const r = Math.max(bs.radius, 1e-6);
  camera.position.set(2.0 * r, 1.6 * r, 2.2 * r);
  camera.near = r * 0.01; camera.far = r * 100; camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0); controls.update();
  $('iter').max = String(st.snaps.length - 1);
  $('iter').value = '0';
  setIteration(0);
  $('verdict').textContent = st.verdict;
  $('verdict').className = st.ok ? 'ok' : 'bad';
  $('verdict').style.background = st.ok ? '#10221c' : '#241016';
  $('verdict').style.borderColor = st.ok ? '#1d4a3a' : '#5a2230';
}

async function boot() {
  const res = await fetch('./data/scenes.json');
  const data = await res.json();
  const refRes = await fetch('./data/reference.json');
  refData = await refRes.json();

  states = data.scenes.map((spec) => {
    const { mesh, field, order } = buildScene(spec);
    const samples = makeSamples(mesh, order);
    const h = refData.hRel * bboxDiag(mesh);
    const res60 = fit(mesh, field, samples, { iters: 60, keepMeshes: true });
    const snaps = res60.snapshots;
    const e0 = energy(mesh, field, samples);
    const meanAbs = [0];
    for (let k = 1; k < snaps.length; k++) meanAbs.push(meanAbsF(snaps[k], field, samples));
    // in-browser gradient certificate against the finite-difference oracle
    const cmp = compareVectors(analyticGradient(mesh, field, samples), fdGradient(mesh, field, samples, h));
    const refE = refData.scenes[spec.name].optEnergyEnd;
    const same = res60.energyEnd === refE;
    const refHistory = res60.history.map((x) => x.energy);
    return {
      scene: { mesh }, field, samples, name: spec.name, snaps, history: res60.history,
      e0, meanAbs, refHistory, ok: same && cmp.cosine >= 0.999999,
      verdict: same
        ? `certificate OK — browser E(60)=${refE.toExponential(6)} matches node bit-for-bit; grad cosine ${cmp.cosine.toFixed(12)}, relErr ${cmp.relErr.toExponential(2)}`
        : `MISMATCH — browser E(60)=${res60.energyEnd} vs node ${refE}; grad cosine ${cmp.cosine}`,
    };
  });

  const sel = $('scene');
  data.scenes.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = s.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => selectScene(Number(sel.value)));
  $('iter').addEventListener('input', (e) => setIteration(Number(e.target.value)));
  selectScene(0);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

boot().catch((e) => { errBox.textContent = String(e && e.stack || e); });
