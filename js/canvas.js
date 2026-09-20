/**
 * RI Creative - Canvas Studio Engine
 * Wraps Fabric.js v5.3.1 with Canva/Photoshop/Illustrator capabilities:
 * Object management, smart guides, rulers, grid, layers, filters, typography,
 * undo/redo history, high-PPI export (72 - 300 PPI / 4K / 5MB - 50MB).
 */

class CanvasStudio {
  constructor(canvasElementId) {
    this.canvasId = canvasElementId;
    this.canvas = null;
    this.width = 1080;
    this.height = 1080;
    this.zoom = 1;
    this.currentPPI = 72;
    this.snapThreshold = 10;
    this.gridEnabled = false;
    this.rulersEnabled = true;
    this.snapEnabled = true;
    this.activeDesignId = null;
    this.activeDesignTitle = 'Untitled Design';

    // Undo / Redo History Stack
    this.history = [];
    this.historyIndex = -1;
    this.isHistoryProcessing = false;
    this.maxHistorySteps = 50;

    // Clipboard
    this.clipboard = null;

    // Callbacks for UI sync
    this.onSelectionChanged = null;
    this.onCanvasModified = null;
    this.onZoomChanged = null;
  }

  /**
   * Initialize Fabric Canvas
   */
  init() {
    this.canvas = new fabric.Canvas(this.canvasId, {
      width: this.width,
      height: this.height,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: true
    });

    // Custom Control Styling (Canva / Illustrator style)
    fabric.Object.prototype.transparentCorners = false;
    fabric.Object.prototype.cornerColor = '#4f46e5';
    fabric.Object.prototype.cornerStrokeColor = '#ffffff';
    fabric.Object.prototype.borderColor = '#6366f1';
    fabric.Object.prototype.cornerSize = 10;
    fabric.Object.prototype.cornerStyle = 'circle';
    fabric.Object.prototype.borderScaleFactor = 2;
    fabric.Object.prototype.padding = 4;

    // Event Bindings
    this.canvas.on('selection:created', (e) => this._handleSelection(e));
    this.canvas.on('selection:updated', (e) => this._handleSelection(e));
    this.canvas.on('selection:cleared', () => this._handleSelectionCleared());
    this.canvas.on('object:modified', () => this._recordHistory('Modified Object'));
    this.canvas.on('object:added', (e) => {
      if (!this.isHistoryProcessing && !e.target._isGuide) {
        this._recordHistory('Added Object');
      }
    });
    this.canvas.on('object:removed', (e) => {
      if (!this.isHistoryProcessing && !e.target._isGuide) {
        this._recordHistory('Removed Object');
      }
    });

    // Smart Alignment Guides during dragging
    this.canvas.on('object:moving', (e) => this._handleObjectMoving(e));

    // Mouse wheel zoom
    this.canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 5) zoom = 5;
      if (zoom < 0.1) zoom = 0.1;
      this.setZoom(zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Initial state record
    this._recordHistory('Initial State');

    return this;
  }

  /**
   * Set Canvas Dimension
   */
  setDimensions(w, h, ppi = 72) {
    this.width = parseInt(w, 10);
    this.height = parseInt(h, 10);
    this.currentPPI = parseInt(ppi, 10) || 72;

    this.canvas.setWidth(this.width);
    this.canvas.setHeight(this.height);
    this.fitToScreen();
    this._recordHistory(`Resize Canvas to ${this.width}x${this.height}`);

    if (this.onCanvasModified) this.onCanvasModified();
  }

  /**
   * Fit canvas view to current parent container
   */
  fitToScreen() {
    const container = document.getElementById('canvas-viewport');
    if (!container) return;

    const padding = 60;
    const availableW = container.clientWidth - padding;
    const availableH = container.clientHeight - padding;

    const scaleX = availableW / this.width;
    const scaleY = availableH / this.height;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);

    this.setZoom(fitZoom);
  }

  /**
   * Set Zoom Level
   */
  setZoom(zoomLevel) {
    this.zoom = Math.max(0.05, Math.min(5, zoomLevel));
    this.canvas.setZoom(this.zoom);
    this.canvas.setWidth(this.width * this.zoom);
    this.canvas.setHeight(this.height * this.zoom);
    this.canvas.renderAll();

    if (this.onZoomChanged) this.onZoomChanged(this.zoom);
  }

  /**
   * Reset Zoom to 100%
   */
  zoom100() {
    this.setZoom(1);
  }

  /**
   * Selection Handlers
   */
  _handleSelection(e) {
    const selected = this.canvas.getActiveObject();
    if (this.onSelectionChanged) {
      this.onSelectionChanged(selected);
    }
  }

  _handleSelectionCleared() {
    if (this.onSelectionChanged) {
      this.onSelectionChanged(null);
    }
  }

  /**
   * Smart Alignment Guides (Snap to Center & Edges)
   */
  _handleObjectMoving(e) {
    if (!this.snapEnabled) return;
    const obj = e.target;
    const canvasW = this.width;
    const canvasH = this.height;
    const objCenter = obj.getCenterPoint();

    // Snap to Horizontal Center
    if (Math.abs(objCenter.x - canvasW / 2) < this.snapThreshold) {
      obj.setPositionByOrigin(new fabric.Point(canvasW / 2, objCenter.y), 'center', 'center');
    }
    // Snap to Vertical Center
    if (Math.abs(objCenter.y - canvasH / 2) < this.snapThreshold) {
      obj.setPositionByOrigin(new fabric.Point(objCenter.x, canvasH / 2), 'center', 'center');
    }
  }

  /**
   * History / Undo & Redo System
   */
  _recordHistory(actionName = '') {
    if (this.isHistoryProcessing) return;

    // Prune forward history if we made a change after undo
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    const state = JSON.stringify(this.canvas.toJSON([
      'id', 'name', 'isPhotoSlot', 'locked', 'customFilters', 'rx', 'ry'
    ]));

    this.history.push({
      state,
      action: actionName,
      width: this.width,
      height: this.height,
      bg: this.canvas.backgroundColor
    });

    if (this.history.length > this.maxHistorySteps) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }

    if (this.onCanvasModified) this.onCanvasModified();
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this._applyHistoryState(this.history[this.historyIndex]);
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this._applyHistoryState(this.history[this.historyIndex]);
    }
  }

  _applyHistoryState(histItem) {
    if (!histItem) return;
    this.isHistoryProcessing = true;

    this.width = histItem.width;
    this.height = histItem.height;
    this.canvas.setWidth(this.width * this.zoom);
    this.canvas.setHeight(this.height * this.zoom);

    this.canvas.loadFromJSON(histItem.state, () => {
      this.canvas.renderAll();
      this.isHistoryProcessing = false;
      if (this.onCanvasModified) this.onCanvasModified();
      if (this.onSelectionChanged) this.onSelectionChanged(this.canvas.getActiveObject());
    });
  }

  /**
   * Add Text to Canvas
   */
  addText(type = 'heading', customOptions = {}) {
    let textStr = 'Add a heading';
    let fontSize = 48;
    let fontWeight = '700';

    if (type === 'subheading') {
      textStr = 'Add a subheading';
      fontSize = 28;
      fontWeight = '600';
    } else if (type === 'body') {
      textStr = 'Add a little bit of body text for details and descriptions.';
      fontSize = 18;
      fontWeight = '400';
    }

    const defaultOpts = {
      id: `text_${Date.now()}`,
      name: customOptions.name || (type === 'heading' ? 'Heading Text' : type === 'subheading' ? 'Subheading Text' : 'Body Text'),
      left: this.width * 0.1,
      top: this.height * 0.4,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: fontSize,
      fontWeight: fontWeight,
      fill: '#0f172a',
      lineHeight: 1.2,
      charSpacing: 0,
      textAlign: 'left',
      ...customOptions
    };

    const textObj = new fabric.IText(customOptions.text || textStr, defaultOpts);
    this.canvas.add(textObj);
    this.canvas.setActiveObject(textObj);
    this.canvas.renderAll();
    return textObj;
  }

  /**
   * Apply Typography Preset
   */
  applyTypographyPreset(preset) {
    const active = this.canvas.getActiveObject();
    if (active && (active.type === 'text' || active.type === 'i-text')) {
      active.set({
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        fill: preset.fill,
        charSpacing: (preset.letterSpacing || 0) * 10,
        stroke: preset.stroke || null,
        strokeWidth: preset.strokeWidth || 0,
        shadow: preset.shadow ? new fabric.Shadow(preset.shadow) : null,
        fontStyle: preset.fontStyle || 'normal'
      });
      this.canvas.renderAll();
      this._recordHistory(`Applied Font Preset: ${preset.name}`);
      if (this.onSelectionChanged) this.onSelectionChanged(active);
    } else {
      // Add new text with preset
      this.addText('heading', {
        text: preset.name,
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        fill: preset.fill,
        charSpacing: (preset.letterSpacing || 0) * 10,
        stroke: preset.stroke || null,
        strokeWidth: preset.strokeWidth || 0,
        shadow: preset.shadow ? new fabric.Shadow(preset.shadow) : null,
        fontStyle: preset.fontStyle || 'normal',
        name: `${preset.name} Text`
      });
    }
  }

  /**
   * Add Shape to Canvas
   */
  addShape(shapeDef, options = {}) {
    const center = { x: this.width / 2, y: this.height / 2 };
    let obj = null;

    if (shapeDef.type === 'rect') {
      obj = new fabric.Rect({
        left: center.x - (shapeDef.width || 200) / 2,
        top: center.y - (shapeDef.height || 140) / 2,
        width: shapeDef.width || 200,
        height: shapeDef.height || 140,
        rx: shapeDef.rx || 0,
        ry: shapeDef.ry || 0,
        fill: shapeDef.fill || '#4f46e5',
        stroke: shapeDef.stroke || null,
        strokeWidth: shapeDef.strokeWidth || 0,
        name: shapeDef.name || 'Rectangle'
      });
    } else if (shapeDef.type === 'circle') {
      obj = new fabric.Circle({
        left: center.x - (shapeDef.radius || 90),
        top: center.y - (shapeDef.radius || 90),
        radius: shapeDef.radius || 90,
        fill: shapeDef.fill || '#ec4899',
        name: shapeDef.name || 'Circle'
      });
    } else if (shapeDef.type === 'triangle') {
      obj = new fabric.Triangle({
        left: center.x - (shapeDef.width || 180) / 2,
        top: center.y - (shapeDef.height || 160) / 2,
        width: shapeDef.width || 180,
        height: shapeDef.height || 160,
        fill: shapeDef.fill || '#f59e0b',
        name: shapeDef.name || 'Triangle'
      });
    } else if (shapeDef.type === 'polygon') {
      const points = window.RI_DATA.getShapePoints(shapeDef.points, 180);
      obj = new fabric.Polygon(points, {
        left: center.x - 90,
        top: center.y - 90,
        fill: shapeDef.fill || '#10b981',
        name: shapeDef.name || 'Polygon'
      });
    } else if (shapeDef.type === 'path') {
      obj = new fabric.Path(shapeDef.path, {
        left: center.x - 60,
        top: center.y - 60,
        fill: shapeDef.fill || '#3b82f6',
        stroke: shapeDef.stroke || null,
        strokeWidth: shapeDef.strokeWidth || 0,
        scaleX: shapeDef.scale || 5,
        scaleY: shapeDef.scale || 5,
        name: shapeDef.name || 'Path Shape'
      });
    }

    if (obj) {
      obj.id = `shape_${Date.now()}`;
      this.canvas.add(obj);
      this.canvas.setActiveObject(obj);
      this.canvas.renderAll();
      this._recordHistory(`Added Shape: ${shapeDef.name}`);
    }
    return obj;
  }

  /**
   * Add SVG Element to Canvas
   */
  addElementSVG(elementDef) {
    const parser = new DOMParser();
    fabric.loadSVGFromString(elementDef.svg, (objects, options) => {
      const loadedObj = fabric.util.groupSVGElements(objects, options);
      loadedObj.set({
        id: `element_${Date.now()}`,
        name: elementDef.name || 'Vector Element',
        left: this.width / 2 - (loadedObj.width * 2) / 2,
        top: this.height / 2 - (loadedObj.height * 2) / 2,
        scaleX: 2.5,
        scaleY: 2.5
      });
      this.canvas.add(loadedObj);
      this.canvas.setActiveObject(loadedObj);
      this.canvas.renderAll();
      this._recordHistory(`Added Element: ${elementDef.name}`);
    });
  }

  /**
   * Add Image from URL / DataURI
   */
  addImage(url, customOpts = {}) {
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(url, (img) => {
        if (!img || !img.width) {
          reject(new Error('Failed to load image'));
          return;
        }

        // Auto scale to reasonable proportion of canvas
        const targetW = customOpts.width || (this.width * 0.6);
        const scale = targetW / img.width;

        img.set({
          id: customOpts.id || `img_${Date.now()}`,
          name: customOpts.name || 'Image Layer',
          left: customOpts.left !== undefined ? customOpts.left : (this.width - img.width * scale) / 2,
          top: customOpts.top !== undefined ? customOpts.top : (this.height - img.height * scale) / 2,
          scaleX: customOpts.scaleX || scale,
          scaleY: customOpts.scaleY || scale,
          isPhotoSlot: !!customOpts.isPhotoSlot,
          rx: customOpts.rx || 0,
          ry: customOpts.ry || 0,
          ...customOpts
        });

        this.canvas.add(img);
        this.canvas.setActiveObject(img);
        this.canvas.renderAll();
        this._recordHistory('Added Image');
        resolve(img);
      }, { crossOrigin: 'anonymous' });
    });
  }

  /**
   * Replace Active Image or Primary Photo Slot with a new image
   * Supports auto-fit: Cover, Contain, Fill, Smart Crop
   */
  replaceTargetImage(targetObj, newImageUrl, fitMode = 'Cover') {
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(newImageUrl, (newImg) => {
        if (!newImg || !newImg.width) {
          reject(new Error('Invalid image'));
          return;
        }

        const targetW = targetObj.getScaledWidth();
        const targetH = targetObj.getScaledHeight();
        const targetLeft = targetObj.left;
        const targetTop = targetObj.top;
        const targetIdx = this.canvas.getObjects().indexOf(targetObj);

        let scaleX = targetW / newImg.width;
        let scaleY = targetH / newImg.height;

        if (fitMode === 'Cover') {
          const maxScale = Math.max(scaleX, scaleY);
          scaleX = maxScale;
          scaleY = maxScale;
        } else if (fitMode === 'Contain') {
          const minScale = Math.min(scaleX, scaleY);
          scaleX = minScale;
          scaleY = minScale;
        } else if (fitMode === 'Fill') {
          // Stretch to fill
        } else if (fitMode === 'Smart Crop') {
          // Center focus cover
          const maxScale = Math.max(scaleX, scaleY);
          scaleX = maxScale;
          scaleY = maxScale;
        }

        newImg.set({
          id: targetObj.id || `img_${Date.now()}`,
          name: targetObj.name || 'Primary Photo',
          left: targetLeft + (targetW - newImg.width * scaleX) / 2,
          top: targetTop + (targetH - newImg.height * scaleY) / 2,
          scaleX: scaleX,
          scaleY: scaleY,
          isPhotoSlot: true,
          shadow: targetObj.shadow,
          stroke: targetObj.stroke,
          strokeWidth: targetObj.strokeWidth
        });

        this.canvas.remove(targetObj);
        this.canvas.insertAt(newImg, targetIdx > -1 ? targetIdx : 0);
        this.canvas.setActiveObject(newImg);
        this.canvas.renderAll();
        this._recordHistory('Replaced Photo');
        resolve(newImg);
      }, { crossOrigin: 'anonymous' });
    });
  }

  /**
   * Get Primary Photo Slot Layer
   */
  getPrimaryPhotoSlot() {
    const objs = this.canvas.getObjects();
    // Look for layer explicitly tagged as photo slot
    const tagged = objs.find(o => o.isPhotoSlot === true);
    if (tagged) return tagged;
    // Look for any image object
    const anyImage = objs.find(o => o.type === 'image');
    if (anyImage) return anyImage;
    // Look for primary card frame or rect
    return objs.find(o => o.type === 'rect' && o.width > 250) || null;
  }

  /**
   * One-Click Alignment Utilities
   * 'left', 'center-h', 'right', 'top', 'center-v', 'bottom'
   */
  alignObject(alignment) {
    const active = this.canvas.getActiveObject();
    if (!active) return;

    if (alignment === 'left') {
      active.set('left', 0);
    } else if (alignment === 'center-h') {
      active.set('left', (this.width - active.getScaledWidth()) / 2);
    } else if (alignment === 'right') {
      active.set('left', this.width - active.getScaledWidth());
    } else if (alignment === 'top') {
      active.set('top', 0);
    } else if (alignment === 'center-v') {
      active.set('top', (this.height - active.getScaledHeight()) / 2);
    } else if (alignment === 'bottom') {
      active.set('top', this.height - active.getScaledHeight());
    }

    active.setCoords();
    this.canvas.renderAll();
    this._recordHistory(`Aligned ${alignment}`);
    if (this.onSelectionChanged) this.onSelectionChanged(active);
  }

  /**
   * Apply Shape Gradient Fill
   */
  applyShapeGradient(shapeObj, gradientDef) {
    if (!shapeObj) shapeObj = this.canvas.getActiveObject();
    if (!shapeObj) return;

    const stops = gradientDef.stops || [{ offset: 0, color: '#4f46e5' }, { offset: 1, color: '#ec4899' }];
    const angleRad = ((gradientDef.angle || 90) * Math.PI) / 180;
    const w = shapeObj.width;
    const h = shapeObj.height;

    const fabricGrad = new fabric.Gradient({
      type: gradientDef.type === 'radial' ? 'radial' : 'linear',
      coords: gradientDef.type === 'radial' ? {
        r1: 0,
        r2: Math.max(w, h) / 2,
        x1: w / 2,
        y1: h / 2,
        x2: w / 2,
        y2: h / 2
      } : {
        x1: (Math.cos(angleRad + Math.PI) * w) / 2 + w / 2,
        y1: (Math.sin(angleRad + Math.PI) * h) / 2 + h / 2,
        x2: (Math.cos(angleRad) * w) / 2 + w / 2,
        y2: (Math.sin(angleRad) * h) / 2 + h / 2
      },
      colorStops: stops.map(s => ({ offset: s.offset, color: s.color }))
    });

    shapeObj.set('fill', fabricGrad);
    this.canvas.renderAll();
    this._recordHistory('Shape Gradient Fill');
  }

  /**
   * Interactive Image Crop
   */
  cropImage(imgObj, cropArea) {
    if (!imgObj || imgObj.type !== 'image') return;
    const element = imgObj.getElement();
    if (!element) return;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropArea.width;
    cropCanvas.height = cropArea.height;
    const ctx = cropCanvas.getContext('2d');

    // Draw slice of image
    ctx.drawImage(
      element,
      cropArea.x, cropArea.y, cropArea.width, cropArea.height,
      0, 0, cropArea.width, cropArea.height
    );

    const croppedDataUrl = cropCanvas.toDataURL('image/png');
    const oldLeft = imgObj.left;
    const oldTop = imgObj.top;
    const oldIdx = this.canvas.getObjects().indexOf(imgObj);

    fabric.Image.fromURL(croppedDataUrl, (newImg) => {
      newImg.set({
        left: oldLeft,
        top: oldTop,
        id: imgObj.id || `img_${Date.now()}`,
        name: `${imgObj.name || 'Image'} (Cropped)`,
        isPhotoSlot: imgObj.isPhotoSlot
      });
      this.canvas.remove(imgObj);
      this.canvas.insertAt(newImg, oldIdx > -1 ? oldIdx : 0);
      this.canvas.setActiveObject(newImg);
      this.canvas.renderAll();
      this._recordHistory('Cropped Image');
    });
  }

  /**
   * Apply Shape Frame Mask (clipPath) to Image
   */
  applyFrameMask(imgObj, maskDef) {
    if (!imgObj || imgObj.type !== 'image') imgObj = this.canvas.getActiveObject();
    if (!imgObj || imgObj.type !== 'image') return;

    const w = imgObj.width;
    const h = imgObj.height;

    let clipObj = null;
    if (maskDef.type === 'circle') {
      clipObj = new fabric.Circle({
        radius: Math.min(w, h) / 2,
        originX: 'center',
        originY: 'center'
      });
    } else if (maskDef.type === 'rounded') {
      clipObj = new fabric.Rect({
        width: w,
        height: h,
        rx: maskDef.rx || 40,
        ry: maskDef.rx || 40,
        originX: 'center',
        originY: 'center'
      });
    } else if (maskDef.type === 'heart') {
      clipObj = new fabric.Path(maskDef.path, {
        scaleX: w / 24,
        scaleY: h / 24,
        originX: 'center',
        originY: 'center'
      });
    } else if (maskDef.type === 'star') {
      const pts = window.RI_DATA.getShapePoints('star5', Math.min(w, h));
      clipObj = new fabric.Polygon(pts, {
        originX: 'center',
        originY: 'center'
      });
    } else if (maskDef.type === 'hexagon') {
      const pts = window.RI_DATA.getShapePoints('hexagon', Math.min(w, h));
      clipObj = new fabric.Polygon(pts, {
        originX: 'center',
        originY: 'center'
      });
    }

    imgObj.set('clipPath', clipObj);
    this.canvas.renderAll();
    this._recordHistory(`Applied ${maskDef.name || 'Frame Mask'}`);
  }
  setBackground(bgConfig) {
    if (bgConfig.type === 'solid') {
      this.canvas.setBackgroundColor(bgConfig.color || '#ffffff', () => {
        this.canvas.renderAll();
        this._recordHistory('Set Background Color');
      });
    } else if (bgConfig.type === 'gradient') {
      const grad = bgConfig.gradient;
      const angleRad = ((grad.angle || 90) * Math.PI) / 180;
      const x1 = Math.round(50 + Math.sin(angleRad) * 50) / 100 * this.width;
      const y1 = Math.round(50 - Math.cos(angleRad) * 50) / 100 * this.height;
      const x2 = Math.round(50 - Math.sin(angleRad) * 50) / 100 * this.width;
      const y2 = Math.round(50 + Math.cos(angleRad) * 50) / 100 * this.height;

      const fabricGrad = new fabric.Gradient({
        type: grad.type === 'radial' ? 'radial' : 'linear',
        coords: grad.type === 'radial' ? {
          r1: 0,
          r2: Math.max(this.width, this.height) / 2,
          x1: this.width / 2,
          y1: this.height / 2,
          x2: this.width / 2,
          y2: this.height / 2
        } : { x1, y1, x2, y2 },
        colorStops: grad.stops.map(s => ({ offset: s.offset, color: s.color }))
      });

      this.canvas.setBackgroundColor(fabricGrad, () => {
        this.canvas.renderAll();
        this._recordHistory('Set Background Gradient');
      });
    } else if (bgConfig.type === 'transparent') {
      this.canvas.setBackgroundColor('', () => {
        this.canvas.renderAll();
        this._recordHistory('Set Transparent Background');
      });
    }
  }

  /**
   * Apply Image Filters to Active Object
   */
  applyFilter(filterType, value) {
    const active = this.canvas.getActiveObject();
    if (!active || active.type !== 'image') return;

    if (!active.filters) active.filters = [];
    if (!active.customFilters) active.customFilters = {};

    active.customFilters[filterType] = value;

    // Rebuild active image filters
    active.filters = [];

    if (active.customFilters.brightness !== undefined && active.customFilters.brightness !== 0) {
      active.filters.push(new fabric.Image.filters.Brightness({ brightness: active.customFilters.brightness / 100 }));
    }
    if (active.customFilters.contrast !== undefined && active.customFilters.contrast !== 0) {
      active.filters.push(new fabric.Image.filters.Contrast({ contrast: active.customFilters.contrast / 100 }));
    }
    if (active.customFilters.saturation !== undefined && active.customFilters.saturation !== 0) {
      active.filters.push(new fabric.Image.filters.Saturation({ saturation: active.customFilters.saturation / 100 }));
    }
    if (active.customFilters.blur !== undefined && active.customFilters.blur > 0) {
      active.filters.push(new fabric.Image.filters.Blur({ blur: active.customFilters.blur / 100 }));
    }
    if (active.customFilters.grayscale) {
      active.filters.push(new fabric.Image.filters.Grayscale());
    }
    if (active.customFilters.sepia) {
      active.filters.push(new fabric.Image.filters.Sepia());
    }
    if (active.customFilters.invert) {
      active.filters.push(new fabric.Image.filters.Invert());
    }
    if (active.customFilters.hue !== undefined && active.customFilters.hue !== 0) {
      active.filters.push(new fabric.Image.filters.HueRotation({ rotation: (active.customFilters.hue * Math.PI) / 180 }));
    }

    active.applyFilters();
    this.canvas.renderAll();
    this._recordHistory(`Filter ${filterType}`);
  }

  /**
   * Load Template into Current Workspace
   */
  async loadTemplate(template) {
    this.activeDesignTitle = template.title;
    this.setDimensions(template.width, template.height);

    this.canvas.clear();
    this.setBackground(template.background);

    // Sequentially load layers
    for (const layer of template.layers) {
      if (layer.type === 'rect') {
        const rect = new fabric.Rect({
          id: layer.id || `rect_${Date.now()}`,
          name: layer.name || 'Rectangle',
          left: layer.left,
          top: layer.top,
          width: layer.width,
          height: layer.height,
          rx: layer.rx || 0,
          ry: layer.ry || 0,
          fill: layer.fill,
          stroke: layer.stroke || null,
          strokeWidth: layer.strokeWidth || 0,
          shadow: layer.shadow ? new fabric.Shadow(layer.shadow) : null,
          selectable: layer.selectable !== false
        });
        this.canvas.add(rect);
      } else if (layer.type === 'text') {
        const text = new fabric.IText(layer.text, {
          id: layer.id || `text_${Date.now()}`,
          name: layer.name || 'Text',
          left: layer.left,
          top: layer.top,
          fontFamily: layer.fontFamily || 'Inter',
          fontSize: layer.fontSize || 32,
          fontWeight: layer.fontWeight || '400',
          fill: layer.fill || '#000000',
          letterSpacing: layer.letterSpacing ? layer.letterSpacing * 10 : 0,
          shadow: layer.shadow ? new fabric.Shadow(layer.shadow) : null,
          width: layer.width || null
        });
        this.canvas.add(text);
      } else if (layer.type === 'image') {
        try {
          await this.addImage(layer.src, {
            id: layer.id || 'primary-photo-slot',
            name: layer.name || 'Primary Photo Slot',
            left: layer.left,
            top: layer.top,
            width: layer.width,
            height: layer.height,
            isPhotoSlot: layer.isPhotoSlot !== false,
            rx: layer.rx || 0,
            ry: layer.ry || 0,
            stroke: layer.stroke || null,
            strokeWidth: layer.strokeWidth || 0,
            shadow: layer.shadow ? new fabric.Shadow(layer.shadow) : null
          });
        } catch (err) {
          console.warn('Template image load error, adding placeholder rect', err);
          const ph = new fabric.Rect({
            id: layer.id || 'primary-photo-slot',
            name: 'Photo Frame Placeholder',
            left: layer.left,
            top: layer.top,
            width: layer.width,
            height: layer.height,
            fill: '#e2e8f0',
            isPhotoSlot: true
          });
          this.canvas.add(ph);
        }
      }
    }

    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    this._recordHistory(`Loaded Template: ${template.title}`);
  }

  /**
   * Layer Ordering & Management
   */
  getLayersList() {
    const objs = this.canvas.getObjects().slice();
    // Return reversed so top layer is at top of list
    return objs.reverse().map(obj => ({
      id: obj.id || `obj_${Math.random()}`,
      name: obj.name || `${obj.type.toUpperCase()} Layer`,
      type: obj.type,
      visible: obj.visible,
      locked: !!obj.lockMovementX,
      isPhotoSlot: !!obj.isPhotoSlot,
      ref: obj
    }));
  }

  bringForward(obj) {
    if (!obj) obj = this.canvas.getActiveObject();
    if (obj) {
      this.canvas.bringForward(obj);
      this.canvas.renderAll();
      this._recordHistory('Bring Forward');
    }
  }

  sendBackward(obj) {
    if (!obj) obj = this.canvas.getActiveObject();
    if (obj) {
      this.canvas.sendBackwards(obj);
      this.canvas.renderAll();
      this._recordHistory('Send Backward');
    }
  }

  bringToFront(obj) {
    if (!obj) obj = this.canvas.getActiveObject();
    if (obj) {
      this.canvas.bringToFront(obj);
      this.canvas.renderAll();
      this._recordHistory('Bring to Front');
    }
  }

  sendToBack(obj) {
    if (!obj) obj = this.canvas.getActiveObject();
    if (obj) {
      this.canvas.sendToBack(obj);
      this.canvas.renderAll();
      this._recordHistory('Send to Back');
    }
  }

  toggleLock(obj) {
    if (!obj) obj = this.canvas.getActiveObject();
    if (obj) {
      const isLocked = !obj.lockMovementX;
      obj.set({
        lockMovementX: isLocked,
        lockMovementY: isLocked,
        lockRotation: isLocked,
        lockScalingX: isLocked,
        lockScalingY: isLocked,
        hasControls: !isLocked
      });
      this.canvas.renderAll();
      this._recordHistory(isLocked ? 'Locked Object' : 'Unlocked Object');
    }
  }

  toggleVisibility(obj) {
    if (!obj) obj = this.canvas.getActiveObject();
    if (obj) {
      obj.set('visible', !obj.visible);
      this.canvas.renderAll();
      this._recordHistory('Toggled Visibility');
    }
  }

  deleteSelected() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    if (active.type === 'activeSelection') {
      active.forEachObject(o => this.canvas.remove(o));
      this.canvas.discardActiveObject();
    } else {
      this.canvas.remove(active);
    }
    this.canvas.renderAll();
    this._recordHistory('Deleted Object');
  }

  duplicateSelected() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    active.clone((cloned) => {
      cloned.set({
        left: cloned.left + 20,
        top: cloned.top + 20,
        id: `clone_${Date.now()}`,
        name: `${active.name || 'Layer'} (Copy)`
      });
      this.canvas.add(cloned);
      this.canvas.setActiveObject(cloned);
      this.canvas.renderAll();
      this._recordHistory('Duplicated Object');
    });
  }

  /**
   * Clipboard Actions
   */
  copy() {
    const active = this.canvas.getActiveObject();
    if (active) {
      active.clone((cloned) => {
        this.clipboard = cloned;
      });
    }
  }

  paste() {
    if (!this.clipboard) return;
    this.clipboard.clone((clonedObj) => {
      this.canvas.discardActiveObject();
      clonedObj.set({
        left: clonedObj.left + 24,
        top: clonedObj.top + 24,
        evented: true,
        id: `paste_${Date.now()}`
      });
      if (clonedObj.type === 'activeSelection') {
        clonedObj.canvas = this.canvas;
        clonedObj.forEachObject(o => this.canvas.add(o));
        clonedObj.setCoords();
      } else {
        this.canvas.add(clonedObj);
      }
      this.clipboard.top += 24;
      this.clipboard.left += 24;
      this.canvas.setActiveObject(clonedObj);
      this.canvas.renderAll();
      this._recordHistory('Pasted Object');
    });
  }

  /**
   * High-Resolution Export Engine (Supports 72, 96, 150, 300 PPI / 4K / 5MB - 50MB files)
   */
  exportImage(options = {}) {
    const format = (options.format || 'png').toLowerCase();
    const quality = options.quality !== undefined ? options.quality : 0.95;
    const targetPPI = options.ppi || this.currentPPI || 72;

    // Calculate resolution multiplier based on PPI
    // 72 PPI = 1x base
    // 96 PPI = 1.33x
    // 150 PPI = 2.08x
    // 300 PPI = 4.16x (Ultra-HD commercial print ready)
    let multiplier = options.multiplier || 1;
    if (targetPPI === 300) multiplier = 4.166;
    else if (targetPPI === 150) multiplier = 2.083;
    else if (targetPPI === 96) multiplier = 1.333;
    else multiplier = 1;

    // If exporting 4K already, keep scale balanced to prevent GPU texture limits
    if (this.width >= 3840 || this.height >= 3840) {
      multiplier = Math.min(multiplier, 2);
    }

    const dataURL = this.canvas.toDataURL({
      format: format === 'jpg' ? 'jpeg' : format,
      quality: quality,
      multiplier: multiplier
    });

    return {
      dataURL,
      width: Math.round(this.width * multiplier),
      height: Math.round(this.height * multiplier),
      ppi: targetPPI,
      format: format
    };
  }

  /**
   * Generate Small Thumbnail (for My Designs and Bulk Grid)
   */
  generateThumbnail(maxSize = 240) {
    const scale = maxSize / Math.max(this.width, this.height);
    return this.canvas.toDataURL({
      format: 'jpeg',
      quality: 0.75,
      multiplier: scale
    });
  }

  /**
   * Export Canvas as PDF using jsPDF
   */
  async exportPDF(options = {}) {
    const exportResult = this.exportImage({ format: 'jpeg', quality: 0.98, ppi: options.ppi || 300 });
    const JsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || window.jspdf);
    if (!JsPDFConstructor) {
      throw new Error('jsPDF library not available');
    }
    
    // PDF orientation
    const orientation = this.width >= this.height ? 'landscape' : 'portrait';
    const pdf = new JsPDFConstructor({
      orientation: orientation,
      unit: 'px',
      format: [this.width, this.height]
    });

    pdf.addImage(exportResult.dataURL, 'JPEG', 0, 0, this.width, this.height);
    return pdf;
  }
}

// Global CanvasStudio Instance
window.RI_STUDIO = null;
