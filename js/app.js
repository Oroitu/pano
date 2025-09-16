

// app.js – Pannellum Builder v2
// ------------------------------------------------------------
//   ▸ Escenas drag‑and‑drop 360°
//   ▸ Hotspots dinámicos: crear, mover (drag), editar (context‑menu)
//   ▸ Autosave en localStorage (cada cambio ≈600 ms)
// ------------------------------------------------------------

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
let project = createEmptyProject();
const autosaved = localStorage.getItem(AUTOSAVE_KEY);
if (autosaved) {
  try {
    project = JSON.parse(autosaved);
  } catch {
    /* corrupt json – ignore */
  }
}
let viewer = /** @type {pannellum.Viewer | null} */ (null);
let dblClickHandler = null;
let autoSaveTimer = null;
let activeHotspotMenu = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    project.meta.updated = nowISO();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  }, 600);
}

/* ─────────────────────────── DOM ELEMENTS ──────────────────────────────── */
const dom = {
  panorama: /** @type {HTMLDivElement} */ (document.getElementById('panorama')),
  sceneList: /** @type {HTMLDivElement} */ (document.getElementById('sceneList')),
  addSceneInput: /** @type {HTMLInputElement} */ (document.getElementById('addSceneInput')),
  newBtn:      document.getElementById('newProjectBtn'),
  openInput:   /** @type {HTMLInputElement} */ (document.getElementById('openFileInput')),
  saveBtn:     document.getElementById('saveProjectBtn'),
  exportBtn:   document.getElementById('exportProjectBtn'),
  addLinkBtn:  document.getElementById('addLinkBtn'),
  addInfoBtn:  document.getElementById('addInfoBtn'),
  hotspotToolbar: document.getElementById('hotspotToolbar'),
};

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
  if (Object.keys(project.scenes).length === 0) {
    viewer = null;
    return;
  }

  // crear visor
  viewer = pannellum.viewer('panorama', {
    default: {
      firstScene: project.startScene || Object.keys(project.scenes)[0],
      author: project.meta.author,
      autoLoad: true,
    },
    scenes: project.scenes,
  });

  // editor hotspots – doble click crea
  if (dblClickHandler) dom.panorama.removeEventListener('dblclick', dblClickHandler);
  dblClickHandler = handleViewerDoubleClick;
  dom.panorama.addEventListener('dblclick', dblClickHandler);

  // cuando se cambie de escena volvemos a habilitar drag / editar
  viewer.on('scenechange', () => {
    closeHotspotMenu();
    attachHotspotEditors();
  });
  attachHotspotEditors(); // para la primera escena
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
    editHotspot(hotspot, sceneId);
  });
}

function attachHotspotEditors() {
  const sceneId = viewer.getScene();
  const scene = project.scenes[sceneId];
  if (!scene?.hotSpots) return;
  scene.hotSpots.forEach((hs) => {
    if (hs.div) enableDrag(hs.div, hs, sceneId);
  });
}

function editHotspot(hs, sceneId) {
  const action = prompt('Acción del hotspot:\n"editar" – modificar JSON\n"eliminar" – quitar del tour', 'editar');
  if (!action) return;
  if (action.toLowerCase().startsWith('elim')) {
    const scene = project.scenes[sceneId];
    scene.hotSpots = (scene.hotSpots || []).filter((h) => h.id !== hs.id);
    viewer.removeHotSpot(hs.id, sceneId);
    scheduleAutoSave();
    viewer.loadScene(sceneId, viewer.getPitch(), viewer.getYaw(), viewer.getHfov());
    return;
  }

  const json = prompt('Edita las propiedades JSON del hotspot:', JSON.stringify(hs, null, 2));
  if (!json) return;
  try {
    Object.assign(hs, JSON.parse(json));
    viewer.removeHotSpot(hs.id, sceneId);
    viewer.addHotSpot(hs, sceneId);
    attachHotspotEditors();
    scheduleAutoSave();
  } catch {
    alert('JSON inválido');
  }
}

/* ─────────────────────────── CRUD HOTSPOTS ─────────────────────────────── */
function addHotspot(sceneId, hotspot) {
  hotspot.id ||= uid(); // asegúrate de id único (necesario para mover)
  const scene = project.scenes[sceneId];
  scene.hotSpots ||= [];
  scene.hotSpots.push(hotspot);
  viewer.addHotSpot(hotspot, sceneId);
  if (hotspot.div) enableDrag(hotspot.div, hotspot, sceneId);
  scheduleAutoSave();
}

/* doble‑clic dentro visor */
function handleViewerDoubleClick(e) {
  if (!viewer) return;
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
  if (!viewer) return;
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
  if (!viewer) return;
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
  files.forEach(createSceneFromFile);
});

dom.sceneList.addEventListener('dblclick', () => dom.addSceneInput.click());

dom.addSceneInput.addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const files = [...input.files].filter((f) => f.type.startsWith('image/'));
  files.forEach(createSceneFromFile);
  input.value = '';
});

function createSceneFromFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataURL = ev.target.result;
    let base = file.name.replace(/\.[^/.]+$/, '').replace(/\s+/g, '-');
    let id = base, i = 1;
    while (project.scenes[id]) id = `${base}-${i++}`;

    const sceneObj = {
      title: base,
      type: 'equirectangular',
      panorama: dataURL,
      panoramaData: dataURL,
      yaw: 0,
      pitch: 0,
      hfov: 110,
      hotSpots: [],
    };

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 64;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const ratio = Math.max(size / img.width, size / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      sceneObj.thumbUrl = canvas.toDataURL('image/jpeg', 0.6);
      renderSceneList();
    };
    img.src = dataURL;

    project.scenes[id] = sceneObj;
    if (!project.startScene) project.startScene = id;
    buildViewer();
    renderSceneList();
    scheduleAutoSave();
  };
  reader.readAsDataURL(file);
}

/* ─────────────────────────── GUARDAR / CARGAR / EXPORTAR ──────────────── */
function saveProject() {
  project.meta.updated = nowISO();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  saveAs(blob, (project.meta.title || 'tour') + '.json');
}

function loadProject(json) {
  project = json;
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

  const zip = new JSZip();

  // ─────────── 1. index.html (visor) ─────────
  // Copiamos el visor autónomo desde /deploy/
  const indexHtml = await fetch('deploy/index.html').then(r => r.text());
  zip.file('index.html', indexHtml);

  // ─────────── 2. tour.json ──────────────────
  //   • Clonamos el proyecto para no mutar el original
  //   • Sustituimos cada panoramaData por images/ID.jpg
  const exportTour = JSON.parse(JSON.stringify(project));

  Object.entries(exportTour.scenes).forEach(([id, scene]) => {
    scene.panorama = `images/${id}.jpg`; // nueva ruta relativa
    delete scene.panoramaData;           // limpiamos base64
  });

  zip.file('tour.json', JSON.stringify(exportTour, null, 2));

  // ─────────── 3. Imágenes ──────────────────
  const imgFolder = zip.folder('images');

  await Promise.all(
    Object.entries(project.scenes).map(async ([id, scene]) => {
      // panoramaData viene como dataURL base64
      if (scene.panoramaData?.startsWith('data:')) {
        imgFolder.file(
          `${id}.jpg`,
          scene.panoramaData.split(',')[1], // quitamos encabezado dataURL
          { base64: true }
        );
      } else {
        // Si ya es URL externa / local, la saltamos (o podrías fetch + blob si lo necesitas)
        console.warn(`Escena ${id} no contiene panoramaData, se omite en el ZIP`);
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
  project = createEmptyProject();
  buildViewer();
  renderSceneList();
  scheduleAutoSave();
}

/* ─────────────────────────── EVENTOS UI ─────────────────────────────── */
dom.newBtn.addEventListener('click', newProject);
dom.saveBtn.addEventListener('click', saveProject);
dom.exportBtn.addEventListener('click', exportProject);

dom.openInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      loadProject(JSON.parse(ev.target.result));
    } catch {
      alert('Archivo proyecto inválido');
    } finally {
      dom.openInput.value = '';
    }
  };
  reader.readAsText(file);
});

/* ─────────────────────────── INICIO ─────────────────────────────────── */
if (Object.keys(project.scenes).length) {
  buildViewer();
  renderSceneList();
} else {
  document.addEventListener('DOMContentLoaded', () => renderSceneList());
}
