

// app.js – Pannellum Builder v2
// ------------------------------------------------------------
//   ▸ Escenas drag‑and‑drop 360°
//   ▸ Hotspots dinámicos: crear, mover (drag), editar (context‑menu)
//   ▸ Autosave en localStorage (cada cambio ≈600 ms)
// ------------------------------------------------------------

import { initStorage, saveImage, getImage, deleteImage } from './storage.js';

/* ─────────────────────────── UTILIDADES GENERALES ───────────────────────── */
function nowISO() {
  return new Date().toISOString();
}
function uid(prefix = 'hs') {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/* ─────────────────────────── MODELO PROYECTO ────────────────────────────── */
function createEmptyProject() {
  return {
    meta: {
      title: 'Nuevo tour',
      author: 'Autor desconocido',
      created: nowISO(),
      updated: nowISO(),
    },
    startScene: null,
    scenes: {},
  };
}

/* ─────────────────────────── ESTADO Y AUTOSAVE ──────────────────────────── */
const AUTOSAVE_KEY = 'pnl_editorea_autosave';
const storageReady = initStorage();
const sceneMedia = new Map();

let project = createEmptyProject();
const autosaved = localStorage.getItem(AUTOSAVE_KEY);
if (autosaved) {
  try {
    project = JSON.parse(autosaved);
  } catch {
    /* corrupt json – ignore */
  }
}
project.meta = { ...createEmptyProject().meta, ...project.meta };
if (!project.scenes || typeof project.scenes !== 'object') project.scenes = {};

let viewer = /** @type {pannellum.Viewer | null} */ (null);
let dblClickHandler = null;
let autoSaveTimer = null;
let activeHotspotMenu = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    project.meta.updated = nowISO();
    const minimalProject = {
      ...project,
      scenes: Object.fromEntries(
        Object.entries(project.scenes).map(([id, scene]) => [id, normalizeScene(id, scene)])
      ),
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(minimalProject));
  }, 600);
}

function normalizeScene(id, scene = {}) {
  return {
    id,
    title: scene?.title || id,
    yaw: typeof scene?.yaw === 'number' ? scene.yaw : 0,
    pitch: typeof scene?.pitch === 'number' ? scene.pitch : 0,
    hfov: typeof scene?.hfov === 'number' ? scene.hfov : 110,
    hotSpots: Array.isArray(scene?.hotSpots) ? scene.hotSpots : [],
  };
}

function setSceneMedia(id, media) {
  const current = sceneMedia.get(id);
  if (current?.isObjectUrl && current.objectUrl) {
    URL.revokeObjectURL(current.objectUrl);
  }
  sceneMedia.set(id, media);
}

function removeSceneMedia(id) {
  const current = sceneMedia.get(id);
  if (current?.isObjectUrl && current.objectUrl) {
    URL.revokeObjectURL(current.objectUrl);
  }
  sceneMedia.delete(id);
}

async function createThumbnailFromBlob(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        const ratio = Math.max(size / img.width, size / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => resolve(null);
      img.src = /** @type {string} */ (reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataUrl) {
  try {
    const response = await fetch(dataUrl);
    return await response.blob();
  } catch (error) {
    console.error('No se pudo convertir dataURL a Blob', error);
    return null;
  }
}

async function ensureSceneMedia(id) {
  const scene = project.scenes[id];
  if (!scene) return null;
  const existing = sceneMedia.get(id);
  if (existing?.objectUrl) return existing;

  await storageReady;

  let blob;
  try {
    blob = await getImage(id);
  } catch (error) {
    console.error(`Error al leer la imagen de la escena ${id} en IndexedDB`, error);
  }

  if (!blob && scene?.panoramaData?.startsWith?.('data:')) {
    blob = await dataURLToBlob(scene.panoramaData);
    if (blob) {
      try {
        await saveImage(id, blob);
      } catch (error) {
        console.error(`No se pudo guardar la imagen ${id} en IndexedDB`, error);
      }
    }
  }

  if (!blob && scene?.panorama?.startsWith?.('data:')) {
    blob = await dataURLToBlob(scene.panorama);
    if (blob) {
      try {
        await saveImage(id, blob);
      } catch (error) {
        console.error(`No se pudo guardar la imagen ${id} en IndexedDB`, error);
      }
    }
  }

  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    const thumbUrl = (await createThumbnailFromBlob(blob)) || scene.thumbUrl || null;
    setSceneMedia(id, { objectUrl, thumbUrl, isObjectUrl: true });
  } else if (typeof scene?.panorama === 'string') {
    setSceneMedia(id, { objectUrl: scene.panorama, thumbUrl: scene.thumbUrl || null, isObjectUrl: false });
  } else {
    console.warn(`No se encontró imagen para la escena ${id}`);
    project.scenes[id] = normalizeScene(id, scene);
    return null;
  }

  project.scenes[id] = normalizeScene(id, scene);
  return sceneMedia.get(id);
}

async function ensureAllSceneMedia() {
  const ids = Object.keys(project.scenes);
  for (const id of ids) {
    await ensureSceneMedia(id);
  }
}

async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ─────────────────────────── DOM ELEMENTS ──────────────────────────────── */
const dom = {
  panorama: /** @type {HTMLDivElement} */ (document.getElementById('panorama')),
  sceneList: /** @type {HTMLDivElement} */ (document.getElementById('sceneList')),
  addSceneInput: /** @type {HTMLInputElement} */ (document.getElementById('addSceneInput')),
  newBtn:      document.getElementById('newProjectBtn'),
  openBtn:     document.getElementById('openProjectBtn'),
  saveBtn:     document.getElementById('saveProjectBtn'),
  exportBtn:   document.getElementById('exportProjectBtn'),
  addLinkBtn:  document.getElementById('addLinkBtn'),
  addInfoBtn:  document.getElementById('addInfoBtn'),
  hotspotToolbar: document.getElementById('hotspotToolbar'),
  hotspotEditToggle: /** @type {HTMLInputElement} */ (document.getElementById('hotspotEditToggle')),
};

dom.hotspotEditToggle.addEventListener('change', () => {
  if (!viewer) return;
  if (dom.hotspotEditToggle.checked) {
    attachHotspotEditors();
  } else {
    const sceneId = viewer.getScene();
    viewer.loadScene(sceneId, viewer.getPitch(), viewer.getYaw(), viewer.getHfov());
  }
});

function closeHotspotMenu() {
  if (!activeHotspotMenu) return;
  document.removeEventListener('mousedown', activeHotspotMenu.onOutside);
  document.removeEventListener('keydown', activeHotspotMenu.onKeydown);
  activeHotspotMenu.element.remove();
  activeHotspotMenu = null;
}

/* ─────────────────────────── VISOR PANNELLUM ───────────────────────────── */
function buildViewer() {
  closeHotspotMenu();
  // limpiar visor existente
  if (viewer) {
    try { viewer.destroy?.(); } catch {}
    dom.panorama.innerHTML = '';
  }
  const sceneEntries = Object.entries(project.scenes);
  if (sceneEntries.length === 0) {
    viewer = null;
    return;
  }

  const scenesConfig = {};
  sceneEntries.forEach(([id, scene]) => {
    const media = sceneMedia.get(id);
    if (!media?.objectUrl) return;
    scenesConfig[id] = {
      title: scene.title,
      type: 'equirectangular',
      panorama: media.objectUrl,
      yaw: scene.yaw,
      pitch: scene.pitch,
      hfov: scene.hfov,
      hotSpots: scene.hotSpots,
    };
  });

  const availableIds = Object.keys(scenesConfig);
  if (availableIds.length === 0) {
    viewer = null;
    return;
  }
  const firstScene = availableIds.includes(project.startScene)
    ? project.startScene
    : availableIds[0];
  if (project.startScene !== firstScene) project.startScene = firstScene;

  // crear visor
  viewer = pannellum.viewer('panorama', {
    default: {
      firstScene,
      author: project.meta.author,
      autoLoad: true,
    },
    scenes: scenesConfig,
  });

  // editor hotspots – doble click crea
  if (dblClickHandler) dom.panorama.removeEventListener('dblclick', dblClickHandler);
  dblClickHandler = handleViewerDoubleClick;
  dom.panorama.addEventListener('dblclick', dblClickHandler);

  // cuando se cambie de escena desactivamos la edición
  viewer.on('scenechange', () => {
    closeHotspotMenu();
    dom.hotspotEditToggle.checked = false;
  });
  if (dom.hotspotEditToggle.checked) attachHotspotEditors();
}

/* ─────────────────────────── HOTSPOT DRAG & EDIT ───────────────────────── */
function enableDrag(div, hotspot, sceneId) {
  if (div.dataset.draggable) return; // ya configurado
  div.dataset.draggable = '1';
  div.style.cursor = 'grab';
  let dragging = false;

  const onMove = (ev) => {
    if (!dragging) return;
    const coords = viewer.mouseEventToCoords(ev);
    if (!coords) return;
    [hotspot.pitch, hotspot.yaw] = coords;
    viewer.removeHotSpot(hotspot.id, sceneId);
    viewer.addHotSpot(hotspot, sceneId);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    dom.panorama.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    attachHotspotEditors(); // re‑aplicar listeners al nuevo div
    scheduleAutoSave();
  };
  div.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // solo click izquierdo
    dragging = true;
    dom.panorama.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Context‑menu para editar JSON del hotspot
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editHotspot(hotspot, sceneId, e);
  });
}

function attachHotspotEditors() {
  if (!dom.hotspotEditToggle.checked) return;
  const sceneId = viewer.getScene();
  const scene = project.scenes[sceneId];
  if (!scene?.hotSpots) return;
  scene.hotSpots.forEach((hs) => {
    if (hs.div) enableDrag(hs.div, hs, sceneId);
  });
}

function editHotspot(hs, sceneId, event) {
  closeHotspotMenu();

  const menu = document.createElement('div');
  menu.id = 'hotspotMenu';

  const content = document.createElement('div');
  content.className = 'hotspot-menu-content';
  menu.appendChild(content);

  const handleDelete = () => {
    const scene = project.scenes[sceneId];
    if (!scene?.hotSpots) {
      closeHotspotMenu();
      return;
    }
    const targetId = hs.id;
    viewer.removeHotSpot(targetId, sceneId);
    const index = scene.hotSpots.findIndex((h) => h.id === targetId);
    if (index !== -1) {
      scene.hotSpots.splice(index, 1);
    }
    attachHotspotEditors();
    closeHotspotMenu();
    scheduleAutoSave();
  };

  const showEditForm = () => {
    content.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'hotspot-menu-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'hotspot-menu-text';
    textarea.value = JSON.stringify(hs, null, 2);
    textarea.spellcheck = false;
    form.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'hotspot-menu-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Confirmar';
    confirmBtn.className = 'hotspot-menu-button hotspot-menu-confirm';
    confirmBtn.addEventListener('click', () => {
      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch {
        alert('JSON inválido');
        textarea.focus();
        return;
      }

      viewer.removeHotSpot(hs.id, sceneId);
      Object.assign(hs, parsed);
      viewer.addHotSpot(hs, sceneId);
      attachHotspotEditors();
      scheduleAutoSave();
      closeHotspotMenu();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.className = 'hotspot-menu-button';
    cancelBtn.addEventListener('click', () => {
      showMainOptions();
    });

    actions.append(confirmBtn, cancelBtn);
    form.appendChild(actions);
    content.appendChild(form);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };

  const showMainOptions = () => {
    content.innerHTML = '';
    const actions = document.createElement('div');
    actions.className = 'hotspot-menu-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Editar';
    editBtn.className = 'hotspot-menu-button';
    editBtn.addEventListener('click', showEditForm);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.className = 'hotspot-menu-button';
    deleteBtn.addEventListener('click', handleDelete);

    actions.append(editBtn, deleteBtn);
    content.appendChild(actions);
  };

  showMainOptions();
  dom.panorama.appendChild(menu);

  const rect = dom.panorama.getBoundingClientRect();
  let left = event ? event.clientX - rect.left : rect.width / 2 - menu.offsetWidth / 2;
  let top = event ? event.clientY - rect.top : rect.height / 2 - menu.offsetHeight / 2;
  const maxLeft = Math.max(0, rect.width - menu.offsetWidth);
  const maxTop = Math.max(0, rect.height - menu.offsetHeight);
  left = Math.min(Math.max(left, 0), maxLeft);
  top = Math.min(Math.max(top, 0), maxTop);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onOutside = (ev) => {
    if (!menu.contains(ev.target)) closeHotspotMenu();
  };
  const onKeydown = (ev) => {
    if (ev.key === 'Escape') closeHotspotMenu();
  };

  activeHotspotMenu = { element: menu, onOutside, onKeydown };
  document.addEventListener('mousedown', onOutside);
  document.addEventListener('keydown', onKeydown);
}

/* ─────────────────────────── CRUD HOTSPOTS ─────────────────────────────── */
function addHotspot(sceneId, hotspot) {
  hotspot.id ||= uid(); // asegúrate de id único (necesario para mover)
  const scene = project.scenes[sceneId];
  scene.hotSpots ||= [];
  scene.hotSpots.push(hotspot);
  viewer.addHotSpot(hotspot, sceneId);
  if (hotspot.div) {
    enableDrag(hotspot.div, hotspot, sceneId);
  }
  attachHotspotEditors();
  if (!hotspot.div) setTimeout(attachHotspotEditors, 0);
  scheduleAutoSave();
}

/* doble‑clic dentro visor */
function handleViewerDoubleClick(e) {
  if (!viewer || !dom.hotspotEditToggle.checked) return;
  const coords = viewer.mouseEventToCoords(e);
  if (!coords) return;
  const [pitch, yaw] = coords;
  const currentSceneId = viewer.getScene();
  if (!currentSceneId) return;

  closeHotspotMenu();

  const menu = document.createElement('div');
  menu.id = 'hotspotMenu';
  const content = document.createElement('div');
  content.className = 'hotspot-menu-content';
  menu.appendChild(content);

  const showMainOptions = () => {
    content.innerHTML = '';
    const actions = document.createElement('div');
    actions.className = 'hotspot-menu-actions';

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.textContent = 'Enlace';
    linkBtn.className = 'hotspot-menu-button';
    linkBtn.addEventListener('click', () => showLinkForm());

    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.textContent = 'Info';
    infoBtn.className = 'hotspot-menu-button';
    infoBtn.addEventListener('click', () => showInfoForm());

    actions.append(linkBtn, infoBtn);
    content.appendChild(actions);
  };

  const showLinkForm = () => {
    content.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'hotspot-menu-form';

    const select = document.createElement('select');
    select.className = 'hotspot-menu-select';
    select.innerHTML =
      '<option value="">Escena destino…</option>' +
      Object.entries(project.scenes)
        .map(([id, scene]) => `<option value="${id}">${scene.title || id}</option>`)
        .join('');
    form.appendChild(select);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Confirmar';
    confirmBtn.className = 'hotspot-menu-button hotspot-menu-confirm';
    confirmBtn.addEventListener('click', () => {
      const dest = select.value;
      if (!dest) {
        select.focus();
        return;
      }
      const destScene = project.scenes[dest];
      if (!destScene) {
        alert('Escena destino no válida');
        return;
      }
      const text = destScene.title || dest;
      addHotspot(currentSceneId, {
        pitch,
        yaw,
        type: 'scene',
        sceneId: dest,
        text,
        cssClass: 'link-hotspot',
      });
      closeHotspotMenu();
    });

    form.appendChild(confirmBtn);
    content.appendChild(form);
    select.focus();
  };

  const showInfoForm = () => {
    content.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'hotspot-menu-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'hotspot-menu-text';
    textarea.placeholder = 'Texto informativo…';
    form.appendChild(textarea);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Confirmar';
    confirmBtn.className = 'hotspot-menu-button hotspot-menu-confirm';
    confirmBtn.addEventListener('click', () => {
      const infoText = textarea.value.trim();
      if (!infoText) {
        textarea.focus();
        return;
      }
      addHotspot(currentSceneId, {
        pitch,
        yaw,
        type: 'info',
        text: infoText,
        cssClass: 'info-hotspot',
        createTooltipFunc: (div, { text }) => {
          div.classList.add('info-hotspot');
          div.innerHTML = `<span class="px-2 py-1 bg-black/70 rounded text-xs">${text}</span>`;
        },
        createTooltipArgs: { text: infoText },
      });
      closeHotspotMenu();
    });

    form.appendChild(confirmBtn);
    content.appendChild(form);
    textarea.focus();
  };

  showMainOptions();
  dom.panorama.appendChild(menu);

  const rect = dom.panorama.getBoundingClientRect();
  let left = e.clientX - rect.left;
  let top = e.clientY - rect.top;
  const maxLeft = Math.max(0, rect.width - menu.offsetWidth);
  const maxTop = Math.max(0, rect.height - menu.offsetHeight);
  left = Math.min(Math.max(left, 0), maxLeft);
  top = Math.min(Math.max(top, 0), maxTop);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onOutside = (event) => {
    if (!menu.contains(event.target)) closeHotspotMenu();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') closeHotspotMenu();
  };

  activeHotspotMenu = { element: menu, onOutside, onKeydown };
  document.addEventListener('mousedown', onOutside);
  document.addEventListener('keydown', onKeydown);
}

/* ─────────────────────────── HOTSPOT TOOLBAR ──────────────────────────── */
let cancelPlacement = null;
function startPlacement(placeFn) {
  if (!viewer) return;
  if (cancelPlacement) cancelPlacement();
  const clickHandler = (e) => {
    const coords = viewer.mouseEventToCoords(e);
    if (!coords) return;
    cleanup();
    placeFn(coords);
  };
  const keyHandler = (e) => {
    if (e.key === 'Escape') cleanup();
  };
  function cleanup() {
    dom.panorama.removeEventListener('click', clickHandler);
    document.removeEventListener('keydown', keyHandler);
    cancelPlacement = null;
  }
  dom.panorama.addEventListener('click', clickHandler, { once: true });
  document.addEventListener('keydown', keyHandler, { once: true });
  cancelPlacement = cleanup;
  return cleanup;
}

dom.addLinkBtn.addEventListener('click', () => {
  if (!viewer || !dom.hotspotEditToggle.checked) return;
  const scenes = Object.entries(project.scenes);
  if (scenes.length === 0) return alert('No hay escenas disponibles');
  const menu = document.createElement('select');
  menu.className = 'hotspot-menu';
  menu.innerHTML =
    '<option value="">Escena destino...</option>' +
    scenes.map(([id, s]) => `<option value="${id}">${s.title || id}</option>`).join('');
  dom.hotspotToolbar.appendChild(menu);
  menu.focus();
  const removeMenu = () => {
    menu.remove();
    document.removeEventListener('keydown', escMenu);
  };
  const escMenu = (e) => {
    if (e.key === 'Escape') removeMenu();
  };
  document.addEventListener('keydown', escMenu);
  menu.addEventListener('change', () => {
    const dest = menu.value;
    removeMenu();
    if (!dest) return;
    startPlacement(([pitch, yaw]) => {
      const text = project.scenes[dest].title || dest;
      addHotspot(viewer.getScene(), {
        pitch,
        yaw,
        type: 'scene',
        sceneId: dest,
        text,
        cssClass: 'link-hotspot',
      });
    });
  });
});

dom.addInfoBtn.addEventListener('click', () => {
  if (!viewer || !dom.hotspotEditToggle.checked) return;
  const infoText = prompt('Texto informativo:');
  if (!infoText) return;
  startPlacement(([pitch, yaw]) => {
    addHotspot(viewer.getScene(), {
      pitch,
      yaw,
      type: 'info',
      text: infoText,
      cssClass: 'info-hotspot',
      createTooltipFunc: (div, { text }) => {
        div.classList.add('info-hotspot');
        div.innerHTML = `<span class="px-2 py-1 bg-black/70 rounded text-xs">${text}</span>`;
      },
      createTooltipArgs: { text: infoText },
    });
  });
});

/* ─────────────────────────── LISTA DE ESCENAS / DRAG & DROP ────────────── */
function renderSceneList() {
  dom.sceneList.innerHTML = '';
  const scenes = Object.entries(project.scenes);
  if (scenes.length === 0) {
    dom.sceneList.innerHTML = '<p class="p-4 text-sm text-gray-400">Sin escenas aún. Arrastra aquí imágenes 360°.</p>';
    return;
  }
  scenes.forEach(([id, scene]) => {
    const row = document.createElement('div');
    row.className = 'scene-item flex items-center gap-2 mb-2';

    const btn = document.createElement('button');
    btn.className = 'scene-load flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-gray-700 focus:bg-gray-700';
    btn.dataset.sceneId = id;

    const media = sceneMedia.get(id);
    if (media?.thumbUrl) {
      const img = document.createElement('img');
      img.src = media.thumbUrl;
      img.alt = scene.title || id;
      img.className = 'h-8 w-8 object-cover rounded';
      btn.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = scene.title || id;
    btn.appendChild(span);

    const load = () => viewer?.loadScene(id);
    btn.addEventListener('click', load);
    btn.addEventListener('dblclick', load);

    row.appendChild(btn);

    const startBtn = document.createElement('button');
    startBtn.className = 'scene-action start';
    startBtn.textContent = '★';
    startBtn.title = 'Marcar como escena inicial';
    if (project.startScene === id) startBtn.classList.add('active');
    startBtn.addEventListener('click', () => {
      project.startScene = id;
      buildViewer();
      renderSceneList();
      scheduleAutoSave();
    });
    row.appendChild(startBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'scene-action delete';
    delBtn.textContent = '✖';
    delBtn.title = 'Eliminar escena';
    delBtn.addEventListener('click', () => {
      if (!confirm('¿Eliminar esta escena?')) return;
      delete project.scenes[id];
      removeSceneMedia(id);
      storageReady.then(() => deleteImage(id)).catch((error) => {
        console.error(`No se pudo eliminar la imagen ${id} de IndexedDB`, error);
      });
      if (project.startScene === id) {
        project.startScene = Object.keys(project.scenes)[0] || null;
      }
      buildViewer();
      renderSceneList();
      scheduleAutoSave();
    });
    row.appendChild(delBtn);

    dom.sceneList.appendChild(row);
  });
}

// drag imágenes → crear escena
'dragenter dragover'.split(' ').forEach((ev) => {
  dom.sceneList.addEventListener(ev, (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dom.sceneList.classList.add('ring', 'ring-indigo-500/50');
  });
});

dom.sceneList.addEventListener('dragleave', () => dom.sceneList.classList.remove('ring', 'ring-indigo-500/50'));

dom.sceneList.addEventListener('drop', (e) => {
  e.preventDefault();
  dom.sceneList.classList.remove('ring', 'ring-indigo-500/50');
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) return alert('Arrastra solo imágenes.');
  files.forEach((file) => {
    createSceneFromFile(file).catch((error) => console.error('No se pudo crear la escena', error));
  });
});

dom.sceneList.addEventListener('dblclick', () => dom.addSceneInput.click());

dom.addSceneInput.addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const files = [...input.files].filter((f) => f.type.startsWith('image/'));
  files.forEach((file) => {
    createSceneFromFile(file).catch((error) => console.error('No se pudo crear la escena', error));
  });
  input.value = '';
});

async function createSceneFromFile(file) {
  await storageReady;
  let base = file.name.replace(/\.[^/.]+$/, '').replace(/\s+/g, '-');
  if (!base) base = 'escena';
  let id = base, i = 1;
  while (project.scenes[id]) id = `${base}-${i++}`;

  const sceneObj = normalizeScene(id, { title: base, hotSpots: [] });
  project.scenes[id] = sceneObj;

  try {
    await saveImage(id, file);
  } catch (error) {
    console.error(`No se pudo guardar la imagen ${id} en IndexedDB`, error);
  }

  let thumbUrl = null;
  try {
    thumbUrl = await createThumbnailFromBlob(file);
  } catch (error) {
    console.error('No se pudo generar la miniatura', error);
  }

  const objectUrl = URL.createObjectURL(file);
  setSceneMedia(id, { objectUrl, thumbUrl, isObjectUrl: true });

  if (!project.startScene) project.startScene = id;
  buildViewer();
  renderSceneList();
  scheduleAutoSave();
}

/* ─────────────────────────── GUARDAR / CARGAR / EXPORTAR ──────────────── */
async function saveProject() {
  project.meta.updated = nowISO();
  await storageReady;
  const scenes = {};
  for (const [id, scene] of Object.entries(project.scenes)) {
    const exportScene = { ...scene, type: 'equirectangular' };
    let dataUrl = null;
    try {
      const blob = await getImage(id);
      if (blob) dataUrl = await blobToDataURL(blob);
    } catch (error) {
      console.error(`No se pudo obtener la imagen ${id} para guardar`, error);
    }
    const media = sceneMedia.get(id);
    if (dataUrl) {
      exportScene.panorama = dataUrl;
      exportScene.panoramaData = dataUrl;
    } else if (media?.objectUrl && media.isObjectUrl === false) {
      exportScene.panorama = media.objectUrl;
    }
    if (media?.thumbUrl) exportScene.thumbUrl = media.thumbUrl;
    scenes[id] = exportScene;
  }
  const exportProject = { ...project, scenes };
  const blob = new Blob([JSON.stringify(exportProject, null, 2)], { type: 'application/json' });
  saveAs(blob, (project.meta.title || 'tour') + '.json');
}

async function loadProject(json) {
  const previousIds = Object.keys(project.scenes);
  previousIds.forEach((id) => removeSceneMedia(id));
  await storageReady;
  await Promise.all(previousIds.map((id) => deleteImage(id).catch(() => {})));

  project = {
    ...createEmptyProject(),
    ...json,
    meta: { ...createEmptyProject().meta, ...json.meta },
    scenes: { ...(json.scenes || {}) },
  };

  await ensureAllSceneMedia();
  buildViewer();
  renderSceneList();
  scheduleAutoSave();
}


// ──────────────────────────── EXPORTAR ZIP ─────────────────────── //
async function exportProject () {
  // ─────────── Librerías dinámicas ───────────
  if (typeof JSZip === 'undefined') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  }
  if (typeof saveAs === 'undefined') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js');
  }

  await storageReady;

  const zip = new JSZip();

  // ─────────── 1. index.html (visor) ─────────
  // Copiamos el visor autónomo desde /deploy/
  const indexHtml = await fetch('deploy/index.html').then(r => r.text());
  zip.file('index.html', indexHtml);

  // ─────────── 2. tour.json ──────────────────
  const tourScenes = {};
  Object.entries(project.scenes).forEach(([id, scene]) => {
    tourScenes[id] = {
      ...scene,
      type: 'equirectangular',
      panorama: `images/${id}.jpg`,
    };
  });
  const exportTour = { ...project, scenes: tourScenes };
  zip.file('tour.json', JSON.stringify(exportTour, null, 2));

  // ─────────── 3. Imágenes ──────────────────
  const imgFolder = zip.folder('images');

  await Promise.all(
    Object.keys(project.scenes).map(async (id) => {
      try {
        const blob = await getImage(id);
        if (!blob) {
          console.warn(`Escena ${id} no contiene imagen en IndexedDB, se omite en el ZIP`);
          return;
        }
        const dataUrl = await blobToDataURL(blob);
        const base64 = dataUrl.split(',')[1];
        imgFolder.file(`${id}.jpg`, base64, { base64: true });
      } catch (error) {
        console.error(`No se pudo exportar la imagen ${id}`, error);
      }
    })
  );

  // ─────────── 4. Generar y descargar ZIP ───
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, (project?.meta?.title || 'tour') + '.zip');
}

/* Utilidad para cargar scripts en caliente */
function loadScript (src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
/* ─────────────────────────── NUEVO PROYECTO ─────────────────────────── */
function newProject() {
  if (!confirm('¿Descartar el proyecto actual y empezar uno nuevo?')) return;
  const previousIds = Object.keys(project.scenes);
  previousIds.forEach((id) => removeSceneMedia(id));
  storageReady
    .then(() => Promise.all(previousIds.map((id) => deleteImage(id).catch(() => {}))))
    .catch((error) => console.error('No se pudieron limpiar las imágenes del proyecto', error));
  project = createEmptyProject();
  buildViewer();
  renderSceneList();
  scheduleAutoSave();
}

async function openProject() {
  const handleFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      await loadProject(JSON.parse(text));
    } catch {
      alert('Archivo proyecto inválido');
    }
  };

  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Proyecto JSON',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      if (!handle) return;
      const file = await handle.getFile();
      await handleFile(file);
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('No se pudo abrir el proyecto con showOpenFilePicker', error);
    }
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener(
    'change',
    async () => {
      const file = input.files?.[0];
      if (!file) return;
      await handleFile(file);
    },
    { once: true }
  );
  input.click();
}

/* ─────────────────────────── EVENTOS UI ─────────────────────────────── */
dom.newBtn.addEventListener('click', newProject);
dom.openBtn.addEventListener('click', () => {
  openProject().catch((error) => console.error('No se pudo abrir el proyecto', error));
});
dom.saveBtn.addEventListener('click', () => {
  saveProject().catch((error) => console.error('No se pudo guardar el proyecto', error));
});
dom.exportBtn.addEventListener('click', () => {
  exportProject().catch((error) => console.error('No se pudo exportar el proyecto', error));
});

/* ─────────────────────────── INICIO ─────────────────────────────────── */
(async () => {
  try {
    await storageReady;
    await ensureAllSceneMedia();
  } catch (error) {
    console.error('Error inicializando el almacenamiento', error);
  }
  if (Object.keys(project.scenes).length) {
    buildViewer();
    renderSceneList();
  } else {
    renderSceneList();
  }
})();
