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
  panorama: /** @type {HTMLDivElement} */ (document.getElementById('panorama')),
  sceneList: /** @type {HTMLDivElement} */ (document.getElementById('sceneList')),
};

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
    '<div class="p-4 space-y-2 text-sm text-gray-300">' +
    '<p>No se encontró <code>tour.json</code> ni se especificó un archivo en la URL.</p>' +
    '<p><label class="btn cursor-pointer">Abrir archivo JSON<input id="viewerFileInput" type="file" accept="application/json" class="hidden"></label></p>' +
    '</div>';
  document.getElementById('viewerFileInput').addEventListener('change', (e) => {
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

  viewer = pannellum.viewer('panorama', {
    default: {
      firstScene: tour.startScene || Object.keys(tour.scenes)[0],
      author: tour.meta?.author || '',
      autoLoad: true,
    },
    scenes: tour.scenes,
  });

  renderSceneList();
}

// ──────────────────────────── LISTA DE ESCENAS ──────────────────── //

function renderSceneList() {
  dom.sceneList.innerHTML = '';
  Object.entries(tour.scenes).forEach(([id, scene]) => {
    const btn = document.createElement('button');
    btn.className = 'flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-gray-700 focus:bg-gray-700';

    if (scene.thumbUrl) {
      const img = document.createElement('img');
      img.src = scene.thumbUrl;
      img.alt = scene.title || id;
      img.className = 'h-8 w-8 object-cover rounded';
      btn.appendChild(img);
    }

    const span = document.createElement('span');
    span.textContent = scene.title || id;
    btn.appendChild(span);

    btn.addEventListener('click', () => viewer.loadScene(id));
    dom.sceneList.appendChild(btn);
  });
}

// ──────────────────────────── INICIO ───────────────────────────── //

document.addEventListener('DOMContentLoaded', fetchTour);
