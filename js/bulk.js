/**
 * RI Creative - Bulk Design Automation Engine
 * Supports 1 to 50 Images batch upload, Auto-Fit modes (Cover, Contain, Fill, Smart Crop),
 * Asynchronous chunked generation, Progress tracking, Error resilience,
 * Bulk Gallery with Edit/Preview/Delete, and ZIP batch export.
 */

class BulkDesignEngine {
  constructor(canvasStudio) {
    this.studio = canvasStudio;
    this.uploadedImages = []; // Array of { id, name, file, dataUrl, selected: true }
    this.maxBatchSize = 50;
    this.generatedDesigns = []; // Array of saved design objects from latest batch
    this.failedItems = [];
    this.isProcessing = false;
    this.fitMode = 'Cover'; // Cover | Contain | Fill | Smart Crop | Manual
    this.namingScheme = 'auto-number'; // auto-number | original-filename | custom-prefix
    this.customPrefix = 'Design';
    this.batchId = null;

    // Callbacks for UI updates
    this.onImagesListChanged = null;
    this.onProgress = null;
    this.onBatchComplete = null;
  }

  /**
   * Add files from input or drag-and-drop (up to 50 total)
   */
  async addFiles(fileList) {
    const remainingSlots = this.maxBatchSize - this.uploadedImages.length;
    if (remainingSlots <= 0) {
      this._notify('Maximum batch limit of 50 images reached.', 'warning');
      return;
    }

    const filesToProcess = Array.from(fileList).slice(0, remainingSlots);

    for (const file of filesToProcess) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await this._readFileAsDataURL(file);
        this.uploadedImages.push({
          id: `bulk_img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          file: file,
          dataUrl: dataUrl,
          selected: true
        });
      } catch (err) {
        console.error('Error reading file:', file.name, err);
      }
    }

    if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
  }

  /**
   * Load Demo Sample Images (e.g. 10, 25, or 50 images instantly)
   */
  async loadSampleImages(count = 50) {
    const targetCount = Math.min(count, this.maxBatchSize);
    const samples = window.RI_DATA.SAMPLE_BULK_IMAGES.slice(0, targetCount);

    this.uploadedImages = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.uploadedImages.push({
        id: `sample_${i + 1}`,
        name: s.name,
        file: null,
        dataUrl: s.url,
        selected: true
      });
    }

    this._notify(`Loaded ${this.uploadedImages.length} sample product images for bulk automation!`, 'success');
    if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
  }

  /**
   * Reorder image in queue
   */
  moveImageUp(index) {
    if (index > 0) {
      const temp = this.uploadedImages[index];
      this.uploadedImages[index] = this.uploadedImages[index - 1];
      this.uploadedImages[index - 1] = temp;
      if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
    }
  }

  moveImageDown(index) {
    if (index < this.uploadedImages.length - 1) {
      const temp = this.uploadedImages[index];
      this.uploadedImages[index] = this.uploadedImages[index + 1];
      this.uploadedImages[index + 1] = temp;
      if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
    }
  }

  /**
   * Replace single image in queue with new file
   */
  async replaceImage(index, file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await this._readFileAsDataURL(file);
      this.uploadedImages[index] = {
        ...this.uploadedImages[index],
        name: file.name.replace(/\.[^/.]+$/, ''),
        file: file,
        dataUrl: dataUrl
      };
      if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
      this._notify(`Replaced image ${index + 1} with ${file.name}`, 'info');
    } catch (err) {
      console.error('Error replacing image:', err);
    }
  }

  /**
   * Card Management in Bulk Gallery
   */
  renameGeneratedDesign(designId, newTitle) {
    const d = this.generatedDesigns.find(item => item.id === designId);
    if (d) {
      d.title = newTitle;
      window.RI_STORAGE.saveDesign(d);
      this._notify(`Renamed to "${newTitle}"`, 'info');
    }
  }

  duplicateGeneratedDesign(designId) {
    const original = this.generatedDesigns.find(item => item.id === designId);
    if (original) {
      const copy = {
        ...original,
        id: `design_bulk_copy_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        title: `${original.title} (Copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.generatedDesigns.push(copy);
      window.RI_STORAGE.saveDesign(copy);
      this._notify(`Duplicated ${original.title}`, 'info');
      if (this.onBatchComplete) {
        this.onBatchComplete({
          total: this.generatedDesigns.length,
          successful: this.generatedDesigns.length,
          failed: this.failedItems.length,
          designs: this.generatedDesigns,
          failedItems: this.failedItems
        });
      }
    }
  }

  deleteGeneratedDesign(designId) {
    const idx = this.generatedDesigns.findIndex(item => item.id === designId);
    if (idx > -1) {
      this.generatedDesigns.splice(idx, 1);
      window.RI_STORAGE.deleteDesign(designId);
      this._notify('Deleted design from gallery', 'info');
      if (this.onBatchComplete) {
        this.onBatchComplete({
          total: this.generatedDesigns.length,
          successful: this.generatedDesigns.length,
          failed: this.failedItems.length,
          designs: this.generatedDesigns,
          failedItems: this.failedItems
        });
      }
    }
  }

  /**
   * Remove a single uploaded image from the batch list
   */
  removeImage(index) {
    if (index < 0 || index >= this.uploadedImages.length) return;

    const removed = this.uploadedImages.splice(index, 1)[0];
    if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);

    if (removed) {
      this._notify(`Removed image: ${removed.name || 'Selected item'}`, 'info');
    }
  }

  /**
   * Clear all uploaded images
   */
  clearAllImages() {
    this.uploadedImages = [];
    if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
  }

  /**
   * Toggle image selection
   */
  toggleSelection(index) {
    if (this.uploadedImages[index]) {
      this.uploadedImages[index].selected = !this.uploadedImages[index].selected;
      if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
    }
  }

  /**
   * Select or Deselect All
   */
  setAllSelected(isSelected) {
    this.uploadedImages.forEach(img => img.selected = isSelected);
    if (this.onImagesListChanged) this.onImagesListChanged(this.uploadedImages);
  }

  /**
   * Core Workflow: Apply Current Design/Template to All Uploaded Images
   * Generates up to 50 independent designs asynchronously without locking UI!
   */
  async applyDesignToAll(options = {}) {
    if (this.isProcessing) return;

    const itemsToProcess = this.uploadedImages.filter(img => img.selected !== false);
    if (itemsToProcess.length === 0) {
      this._notify('No images selected. Please upload or select images first.', 'warning');
      return;
    }

    this.isProcessing = true;
    this.failedItems = [];
    this.generatedDesigns = [];
    this.batchId = `batch_${Date.now()}`;

    const fitMode = options.fitMode || this.fitMode || 'Cover';
    const namingScheme = options.namingScheme || this.namingScheme || 'auto-number';
    const customPrefix = options.customPrefix || this.customPrefix || 'Design';

    // Capture base canvas template JSON representation
    const baseCanvasJSON = JSON.stringify(this.studio.canvas.toJSON([
      'id', 'name', 'isPhotoSlot', 'rx', 'ry', 'shadow', 'stroke', 'strokeWidth', 'customFilters'
    ]));
    const canvasWidth = this.studio.width;
    const canvasHeight = this.studio.height;
    const canvasBg = this.studio.canvas.backgroundColor;

    // Find photo slot in current canvas
    const targetSlot = this.studio.getPrimaryPhotoSlot();
    const targetBounds = targetSlot ? {
      left: targetSlot.left,
      top: targetSlot.top,
      width: targetSlot.getScaledWidth(),
      height: targetSlot.getScaledHeight(),
      slotId: targetSlot.id || 'primary-photo-slot'
    } : {
      left: canvasWidth * 0.1,
      top: canvasHeight * 0.2,
      width: canvasWidth * 0.8,
      height: canvasHeight * 0.5,
      slotId: 'primary-photo-slot'
    };

    const total = itemsToProcess.length;

    // Async chunked loop via setTimeout so DOM updates & browser stays responsive
    for (let i = 0; i < total; i++) {
      const item = itemsToProcess[i];
      const indexStr = String(i + 1).padStart(2, '0');

      // Determine design title
      let title = `${customPrefix} ${indexStr}`;
      if (namingScheme === 'original-filename') {
        title = `${item.name} Design`;
      } else if (namingScheme === 'custom-prefix') {
        title = `${customPrefix} - ${item.name || indexStr}`;
      }

      // Notify progress
      if (this.onProgress) {
        this.onProgress({
          current: i + 1,
          total: total,
          percentage: Math.round(((i + 1) / total) * 100),
          statusText: `Creating ${title}...`,
          item: item
        });
      }

      try {
        // Generate single design instance on off-screen static canvas
        const designInstance = await this._renderSingleDesignInstance({
          baseCanvasJSON,
          canvasWidth,
          canvasHeight,
          canvasBg,
          targetBounds,
          imageUrl: item.dataUrl,
          title: title,
          fitMode: fitMode,
          batchId: this.batchId,
          sourceImageId: item.id
        });

        this.generatedDesigns.push(designInstance);
      } catch (err) {
        console.error(`Failed to generate design for item ${i + 1}:`, err);
        this.failedItems.push({
          item: item,
          index: i + 1,
          error: err.message || 'Image rendering error'
        });
      }

      // Yield main thread for 20ms to allow UI render & smooth progress animation
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    // Save all successfully generated designs into IndexedDB in one batch
    if (this.generatedDesigns.length > 0) {
      await window.RI_STORAGE.saveBatchDesigns(this.generatedDesigns);
    }

    this.isProcessing = false;

    const summary = {
      total: total,
      successful: this.generatedDesigns.length,
      failed: this.failedItems.length,
      designs: this.generatedDesigns,
      failedItems: this.failedItems
    };

    if (this.onBatchComplete) {
      this.onBatchComplete(summary);
    }

    this._notify(`Bulk Automation Complete: ${summary.successful} designs created, ${summary.failed} failed.`, summary.failed > 0 ? 'warning' : 'success');
  }

  /**
   * Render single design instance off-screen using Fabric.StaticCanvas
   */
  _renderSingleDesignInstance(params) {
    return new Promise((resolve, reject) => {
      // Create hidden offscreen canvas element
      const offscreenEl = document.createElement('canvas');
      offscreenEl.width = params.canvasWidth;
      offscreenEl.height = params.canvasHeight;

      const staticCanvas = new fabric.StaticCanvas(offscreenEl, {
        width: params.canvasWidth,
        height: params.canvasHeight,
        backgroundColor: params.canvasBg
      });

      staticCanvas.loadFromJSON(params.baseCanvasJSON, () => {
        // Find photo slot in this canvas instance
        const objs = staticCanvas.getObjects();
        let slotObj = objs.find(o => o.isPhotoSlot === true || o.id === params.targetBounds.slotId);
        if (!slotObj) {
          slotObj = objs.find(o => o.type === 'image') || objs.find(o => o.type === 'rect');
        }

        fabric.Image.fromURL(params.imageUrl, (newImg) => {
          if (!newImg || !newImg.width) {
            reject(new Error('Could not load image resource'));
            return;
          }

          const targetW = params.targetBounds.width;
          const targetH = params.targetBounds.height;
          const targetLeft = params.targetBounds.left;
          const targetTop = params.targetBounds.top;

          let scaleX = targetW / newImg.width;
          let scaleY = targetH / newImg.height;

          if (params.fitMode === 'Cover' || params.fitMode === 'Smart Crop') {
            const maxScale = Math.max(scaleX, scaleY);
            scaleX = maxScale;
            scaleY = maxScale;
          } else if (params.fitMode === 'Contain') {
            const minScale = Math.min(scaleX, scaleY);
            scaleX = minScale;
            scaleY = minScale;
          }

          newImg.set({
            left: targetLeft + (targetW - newImg.width * scaleX) / 2,
            top: targetTop + (targetH - newImg.height * scaleY) / 2,
            scaleX: scaleX,
            scaleY: scaleY,
            isPhotoSlot: true
          });

          if (slotObj) {
            const idx = objs.indexOf(slotObj);
            staticCanvas.remove(slotObj);
            staticCanvas.insertAt(newImg, idx > -1 ? idx : 0);
          } else {
            staticCanvas.add(newImg);
          }

          staticCanvas.renderAll();

          // Generate high quality preview and small thumbnail (with CORS fallback)
          let thumbnail = '';
          try {
            thumbnail = staticCanvas.toDataURL({ format: 'jpeg', quality: 0.8, multiplier: 0.25 });
          } catch (e) {
            console.warn('Thumbnail generation fallback for CORS:', e);
            thumbnail = params.imageUrl;
          }

          const canvasJSON = JSON.stringify(staticCanvas.toJSON([
            'id', 'name', 'isPhotoSlot', 'rx', 'ry', 'shadow', 'stroke', 'strokeWidth'
          ]));

          const designRecord = {
            id: `design_bulk_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: params.title,
            thumbnail: thumbnail,
            canvasJSON: canvasJSON,
            width: params.canvasWidth,
            height: params.canvasHeight,
            ppi: 72,
            batchId: params.batchId,
            isBulkBatch: true
          };

          // Clean up offscreen canvas
          staticCanvas.dispose();
          resolve(designRecord);
        }, { crossOrigin: 'anonymous' });
      });
    });
  }

  /**
   * Retry processing failed items
   */
  async retryFailed() {
    if (this.failedItems.length === 0) return;
    const itemsToRetry = this.failedItems.map(f => f.item);
    this.uploadedImages = itemsToRetry;
    await this.applyDesignToAll();
  }

  /**
   * Export All or Selected Generated Designs as a ZIP file using JSZip
   */
  async exportBulkZIP(selectedDesignIds = null, format = 'png', ppi = 72) {
    const listToExport = selectedDesignIds
      ? this.generatedDesigns.filter(d => selectedDesignIds.includes(d.id))
      : this.generatedDesigns;

    if (listToExport.length === 0) {
      this._notify('No designs available to export.', 'warning');
      return;
    }

    this._notify(`Packaging ${listToExport.length} designs into ZIP archive...`, 'info');

    const zip = new JSZip();
    const folder = zip.folder('RI-Creative-Designs');

    // Multiplier based on PPI
    let multiplier = 1;
    if (ppi === 300) multiplier = 3.125;
    else if (ppi === 150) multiplier = 2;

    for (let i = 0; i < listToExport.length; i++) {
      const design = listToExport[i];
      const safeTitle = (design.title || `Design_${i + 1}`).replace(/[^a-z0-9_-]/gi, '_');

      // Render design to dataURL
      const imgDataUrl = await this._renderDesignToDataURL(design, format, multiplier);
      const base64Data = imgDataUrl.split(',')[1];
      const ext = format === 'jpg' ? 'jpeg' : format;
      folder.file(`${safeTitle}.${ext}`, base64Data, { base64: true });
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const timestamp = new Date().toISOString().slice(0, 10);
    const zipFilename = `RI-Creative-Batch_${timestamp}.zip`;

    if (typeof window.saveAs === 'function') {
      window.saveAs(content, zipFilename);
    } else {
      const blobUrl = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = zipFilename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    this._notify(`Successfully downloaded ZIP archive with ${listToExport.length} designs!`, 'success');
  }

  /**
   * Helper: Render a stored design JSON to dataURL
   */
  _renderDesignToDataURL(design, format = 'png', multiplier = 1) {
    return new Promise((resolve) => {
      const offscreenEl = document.createElement('canvas');
      offscreenEl.width = design.width;
      offscreenEl.height = design.height;

      const sc = new fabric.StaticCanvas(offscreenEl, {
        width: design.width,
        height: design.height
      });

      sc.loadFromJSON(design.canvasJSON, () => {
        sc.renderAll();
        try {
          const dataURL = sc.toDataURL({
            format: format === 'jpg' ? 'jpeg' : format,
            quality: 0.95,
            multiplier: multiplier
          });
          sc.dispose();
          resolve(dataURL);
        } catch (e) {
          console.warn('Canvas export fallback for CORS:', e);
          sc.dispose();
          resolve(design.thumbnail);
        }
      });
    });
  }

  _readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  _notify(msg, type = 'info') {
    if (window.RI_APP && window.RI_APP.toast) {
      window.RI_APP.toast(msg, type);
    } else {
      console.log(`[BulkEngine ${type}]: ${msg}`);
    }
  }
}

// Global Bulk Engine Instance
window.RI_BULK = null;
