/**
 * RI Creative - IndexedDB Storage Engine
 * Persistent storage for My Designs, Bulk Batches, Favorites & User Settings.
 */

class StorageEngine {
  constructor() {
    this.dbName = 'RICreativeDB_v1';
    this.dbVersion = 1;
    this.db = null;
    this.initPromise = this.init();
  }

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Object store for Designs
        if (!db.objectStoreNames.contains('designs')) {
          const designStore = db.createObjectStore('designs', { keyPath: 'id' });
          designStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          designStore.createIndex('batchId', 'batchId', { unique: false });
          designStore.createIndex('favorite', 'favorite', { unique: false });
        }
        // Object store for Template Favorites
        if (!db.objectStoreNames.contains('templateFavorites')) {
          db.createObjectStore('templateFavorites', { keyPath: 'id' });
        }
        // Object store for User Settings & Recent
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB init error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  async ensureReady() {
    if (!this.db) {
      await this.initPromise;
    }
  }

  /**
   * Save or update a design
   */
  async saveDesign(design) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('designs', 'readwrite');
      const store = tx.objectStore('designs');
      
      const record = {
        id: design.id || `design_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title: design.title || 'Untitled Design',
        thumbnail: design.thumbnail || '',
        canvasJSON: design.canvasJSON || null,
        width: design.width || 1080,
        height: design.height || 1080,
        ppi: design.ppi || 72,
        isBulkBatch: !!design.isBulkBatch,
        batchId: design.batchId || null,
        favorite: !!design.favorite,
        sourceTemplateId: design.sourceTemplateId || null,
        createdAt: design.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Batch save multiple designs (used by Bulk Design Generator)
   */
  async saveBatchDesigns(designsList) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('designs', 'readwrite');
      const store = tx.objectStore('designs');
      const saved = [];

      designsList.forEach(design => {
        const record = {
          id: design.id || `design_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: design.title || 'Bulk Design',
          thumbnail: design.thumbnail || '',
          canvasJSON: design.canvasJSON || null,
          width: design.width || 1080,
          height: design.height || 1080,
          ppi: design.ppi || 72,
          isBulkBatch: true,
          batchId: design.batchId || `batch_${Date.now()}`,
          favorite: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        store.put(record);
        saved.push(record);
      });

      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get single design by ID
   */
  async getDesign(id) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('designs', 'readonly');
      const store = tx.objectStore('designs');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get all saved designs (sorted newest first)
   */
  async getAllDesigns() {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('designs', 'readonly');
      const store = tx.objectStore('designs');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Delete a design
   */
  async deleteDesign(id) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('designs', 'readwrite');
      const store = tx.objectStore('designs');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Duplicate a design
   */
  async duplicateDesign(id) {
    const original = await this.getDesign(id);
    if (!original) return null;
    const copy = {
      ...original,
      id: `design_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      title: `${original.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return await this.saveDesign(copy);
  }

  /**
   * Toggle Template Favorite
   */
  async toggleTemplateFavorite(templateId) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('templateFavorites', 'readwrite');
      const store = tx.objectStore('templateFavorites');
      const getReq = store.get(templateId);

      getReq.onsuccess = () => {
        if (getReq.result) {
          store.delete(templateId);
          resolve(false); // now unfavorited
        } else {
          store.put({ id: templateId, favoritedAt: Date.now() });
          resolve(true); // now favorited
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Get all template favorite IDs
   */
  async getTemplateFavorites() {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('templateFavorites', 'readonly');
      const store = tx.objectStore('templateFavorites');
      const req = store.getAll();
      req.onsuccess = () => {
        const ids = new Set((req.result || []).map(r => r.id));
        resolve(ids);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Store setting value
   */
  async setSetting(key, value) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, value, updatedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get setting value
   */
  async getSetting(key, defaultValue = null) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Alias: saveSetting (same as setSetting)
   */
  saveSetting(key, value) {
    return this.setSetting(key, value);
  }
}

// Global Storage Instance
window.RI_STORAGE = new StorageEngine();
