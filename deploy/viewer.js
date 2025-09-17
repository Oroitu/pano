/**
 * Pannellum Tour Viewer
 * ---------------------
 * Scrip sencillo para reproducir un tour exportado con el builder.
 *
 * Cómo funciona:
 *   ▸ Por defecto intenta cargar `tour.json` (mismo directorio).
 *   ▸ Se puede indicar ?file=URL para un JSON externo.
 *   ▸ También hay un botón "Abrir" (<input type=file>) para cargar localmente.
 *
 * No incluye funciones de edición; solo navegación entre escenas y hotspots.
 * Dependencias: pannellum.js + CSS ya incluidos en index.html.
 * © 2025 GPL‑3.0
 */

// ──────────────────────────── ELEMENTOS DOM ─────────────────────── //

const dom = {
  panorama: /** @type {HTMLDivElement} */ (document.getElementById('pano')),
  sceneList: /** @type {HTMLDivElement} */ (document.getElementById('roomsNav')),
  roomLabel: /** @type {HTMLSpanElement} */ (document.getElementById('roomLabel')),
  zoomIn: /** @type {HTMLButtonElement} */ (document.getElementById('zoomIn')),
  zoomOut: /** @type {HTMLButtonElement} */ (document.getElementById('zoomOut')),
  fullscreen: /** @type {HTMLButtonElement} */ (document.getElementById('btnFS')),
};

const sceneButtons = new Map();

let viewer = null;
let tour = null; // datos JSON

// ──────────────────────────── CARGA DEL TOUR ────────────────────── //

async function fetchTour() {
  const search = new URLSearchParams(location.search);
  const src = search.get('file') || 'tour.json';
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(res.statusText);
    tour = await res.json();
    initViewer();
  } catch (err) {
    console.warn('No se pudo cargar «' + src + '»: ', err);
    showFileOpenFallback();
  }
}

function showFileOpenFallback() {
  dom.sceneList.innerHTML =
    '<div class="fallback">' +
    '<p>No se encontró <code>tour.json</code> ni se especificó un archivo en la URL.</p>' +
    '<label>📁 Abrir tour JSON<input id="viewerFileInput" type="file" accept="application/json"></label>' +
    '</div>';
  sceneButtons.clear();
  if (dom.roomLabel) dom.roomLabel.textContent = 'Selecciona un archivo de tour';
  const input = /** @type {HTMLInputElement} */ (document.getElementById('viewerFileInput'));
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        tour = JSON.parse(ev.target.result);
        initViewer();
      } catch (err) {
        alert('Archivo JSON inválido');
      }
    };
    reader.readAsText(file);
  });
}

// ──────────────────────────── VISOR ─────────────────────────────── //

function initViewer() {
  if (!tour || !tour.scenes || Object.keys(tour.scenes).length === 0) {
    return alert('El tour no contiene escenas.');
  }

  if (viewer) {
    viewer.destroy();
    dom.panorama.innerHTML = '';
  }

  viewer = pannellum.viewer('pano', {
    default: {
      firstScene: tour.startScene || Object.keys(tour.scenes)[0],
      author: tour.meta?.author || '',
      autoLoad: true,
    },
    scenes: tour.scenes,
  });

  renderSceneList();

  dom.zoomIn?.removeAttribute('disabled');
  dom.zoomOut?.removeAttribute('disabled');
  dom.fullscreen?.removeAttribute('disabled');

  viewer.on('scenechange', handleSceneChange);
  viewer.on('load', () => {
    const current = viewer.getScene();
    updateActiveScene(current);
    updateRoomLabel(current);
  });
}

// ──────────────────────────── LISTA DE ESCENAS ──────────────────── //

function renderSceneList() {
  dom.sceneList.innerHTML = '';
  sceneButtons.clear();
  Object.entries(tour.scenes).forEach(([id, scene]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room';
    btn.dataset.sceneId = id;

    if (scene.thumbUrl) {
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      thumb.style.backgroundImage = `url(${scene.thumbUrl})`;
      thumb.setAttribute('aria-hidden', 'true');
      btn.appendChild(thumb);
    }

    const label = document.createElement('span');
    label.className = 'label';

    const title = document.createElement('span');
    title.className = 'room-title';
    title.textContent = scene.title || id;
    label.appendChild(title);

    if (scene.caption) {
      const caption = document.createElement('span');
      caption.className = 'room-caption';
      caption.textContent = scene.caption;
      label.appendChild(caption);
    }

    btn.appendChild(label);

    btn.addEventListener('click', () => {
      if (viewer?.getScene() === id) return;
      viewer?.loadScene(id);
    });

    dom.sceneList.appendChild(btn);
    sceneButtons.set(id, btn);
  });
}

// ──────────────────────────── INICIO ───────────────────────────── //

document.addEventListener('DOMContentLoaded', () => {
  dom.zoomIn?.addEventListener('click', () => adjustZoom(-10));
  dom.zoomOut?.addEventListener('click', () => adjustZoom(10));
  dom.fullscreen?.addEventListener('click', () => viewer?.toggleFullscreen());
  document.addEventListener('keydown', handleShortcuts);
  fetchTour();
});

function handleSceneChange(sceneId) {
  updateActiveScene(sceneId);
  updateRoomLabel(sceneId);
}

function updateActiveScene(sceneId) {
  sceneButtons.forEach((btn, id) => {
    if (id === sceneId) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });
}

function updateRoomLabel(sceneId) {
  if (!dom.roomLabel) return;
  const scene = tour?.scenes?.[sceneId];
  dom.roomLabel.textContent = scene?.title || sceneId || 'Escena';
}

function adjustZoom(delta) {
  if (!viewer) return;
  const current = viewer.getHfov();
  const next = Math.min(120, Math.max(40, current + delta));
  viewer.setHfov(next, 500);
}

function handleShortcuts(event) {
  if (!viewer) return;
  if (event.defaultPrevented) return;
  switch (event.key) {
    case '+':
    case '=':
      adjustZoom(-10);
      break;
    case '-':
    case '_':
      adjustZoom(10);
      break;
    case 'f':
    case 'F':
      viewer.toggleFullscreen();
      break;
    default:
      return;
  }
  event.preventDefault();
}
