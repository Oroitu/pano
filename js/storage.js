const DB_NAME = 'pano-editor';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no soportado en este navegador'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Error abriendo IndexedDB'));
  });
  return dbPromise;
}

export function initStorage() {
  return openDB().catch((error) => {
    console.error('No fue posible inicializar IndexedDB', error);
    return null;
  });
}

export async function saveImage(id, blob) {
  const db = await openDB();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(blob, id);
  });
}

export async function getImage(id) {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteImage(id) {
  const db = await openDB();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).delete(id);
  });
}
