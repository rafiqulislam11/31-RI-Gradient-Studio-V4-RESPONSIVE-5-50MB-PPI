/**
 * RI Creative - Main Application Controller
 * Handles UI interactions, tab switching, dynamic properties inspection,
 * bulk generation workflow, modals, keyboard shortcuts, and export.
 */

class RICreativeApp {
  constructor() {
    this.studio = null;
    this.bulkEngine = null;
    this.currentTab = 'templates';
    this.activeCategory = 'All';
    this.templateFilter = 'all'; // 'all' | 'favorites' | 'recent'
    this.searchQuery = '';
    this.favoritesSet = new Set();
    this.recentTemplates = []; // array of template IDs most recently used
    this.selectedBulkDesigns = new Set();
    this._cropObj = null;       // active fabric image being cropped
    this._renameCallback = null; // callback on rename confirm
    this._cropArea = { x: 0, y: 0, w: 1, h: 1 }; // relative crop area
  }

  async init() {
    // 1. Initialize Canvas Studio
    this.studio = new CanvasStudio('main-canvas');
    this.studio.init();
    window.RI_STUDIO = this.studio;

    // 2. Initialize Bulk Design Engine
    this.bulkEngine = new BulkDesignEngine(this.studio);
    window.RI_BULK = this.bulkEngine;

    // 3. Load user favorites from storage
    try {
      this.favoritesSet = await window.RI_STORAGE.getTemplateFavorites();
    } catch (err) {
      console.warn('Could not load favorites:', err);
    }

    // 4. Bind Studio callbacks to UI
    this.studio.onSelectionChanged = (obj) => this.syncPropertiesPanel(obj);
    this.studio.onCanvasModified = () => this.updateLayersList();
    this.studio.onZoomChanged = (zoom) => this.updateZoomUI(zoom);

    // 5. Bind Bulk callbacks to UI
    this.bulkEngine.onImagesListChanged = (list) => this.renderBulkThumbnailsGrid(list);
    this.bulkEngine.onProgress = (prog) => this.updateBulkProgressUI(prog);
    this.bulkEngine.onBatchComplete = (summary) => this.renderBulkGallery(summary);

    // 6. Setup DOM Event Listeners
    this.setupEventListeners();

    // 7. Load default initial template (e.g. Template 01)
    const initialTemplate = window.RI_DATA.TEMPLATES_DATABASE[0];
    if (initialTemplate) {
      await this.studio.loadTemplate(initialTemplate);
    }

    // 8. Render Initial Drawer (Templates)
    this.renderActiveDrawer();

    // 9. Check canvas dimensions and fit
    setTimeout(() => {
      this.studio.fitToScreen();
      this.updateStatusbar();
    }, 100);

    this.toast('Welcome to RI Creative! Professional single-page design studio ready.', 'info');
  }

  /**
   * DOM Event Listeners Setup
   */
  setupEventListeners() {
    // Tool Strip Tab Switching
    document.querySelectorAll('.tool-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabId = tab.dataset.tab;
        if (tabId === 'bulk-hub') {
          this.openBulkModal();
        } else {
          this.switchTab(tabId);
        }
      });
    });

    // Drawer Close
    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    if (closeDrawerBtn) {
      closeDrawerBtn.addEventListener('click', () => {
        document.getElementById('drawer-panel').classList.add('collapsed');
        document.querySelectorAll('.tool-tab').forEach(t => t.classList.remove('active'));
      });
    }

    // Header Actions
    document.getElementById('btn-new-design')?.addEventListener('click', () => this.openNewDesignModal());
    document.getElementById('btn-save-design')?.addEventListener('click', () => this.saveCurrentDesign());
    document.getElementById('btn-save-as')?.addEventListener('click', () => this.saveAsNewDesign());
    document.getElementById('btn-open-design')?.addEventListener('click', () => this.switchTab('my-designs'));
    document.getElementById('btn-undo')?.addEventListener('click', () => this.studio.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.studio.redo());
    document.getElementById('btn-preview-fullscreen')?.addEventListener('click', () => this.openPreviewModal());
    document.getElementById('btn-header-bulk')?.addEventListener('click', () => this.openBulkModal());
    document.getElementById('btn-shortcuts-modal')?.addEventListener('click', () => this.openShortcutsModal());
    document.getElementById('btn-header-export')?.addEventListener('click', () => this.openExportModal());
    document.getElementById('btn-header-profile')?.addEventListener('click', () => this.openProfileModal());

    // Canvas Viewport — Drag & Drop from drawer cards
    const viewport = document.getElementById('canvas-viewport');
    if (viewport) {
      viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('drag-over'); });
      viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
      viewport.addEventListener('drop', async (e) => {
        e.preventDefault();
        viewport.classList.remove('drag-over');
        const type = e.dataTransfer.getData('ri-drop-type');
        const id   = e.dataTransfer.getData('ri-drop-id');
        const rect = this.studio.canvas.getElement().getBoundingClientRect();
        const dropX = (e.clientX - rect.left) / this.studio.zoom;
        const dropY = (e.clientY - rect.top)  / this.studio.zoom;
        if (type === 'element') {
          const def = window.RI_DATA.ELEMENT_PRESETS.find(el => el.id === id);
          if (def) { this.studio.addElementSVG(def, dropX, dropY); this.toast(`Added ${def.name}`, 'info'); }
        } else if (type === 'shape') {
          const def = window.RI_DATA.SHAPE_DEFINITIONS.find(s => s.id === id);
          if (def) { this.studio.addShape(def, dropX, dropY); this.toast(`Added ${def.name}`, 'info'); }
        } else if (type === 'text') {
          this.studio.addText(id, dropX, dropY);
          this.toast('Added text', 'info');
        } else if (type === 'image') {
          await this.studio.addImage(id, { name: 'Stock Image', left: dropX, top: dropY });
          this.toast('Added image', 'info');
        }
      });
    }

    // Design Title input in Header
    const titleInput = document.getElementById('header-design-title');
    if (titleInput) {
      titleInput.addEventListener('change', (e) => {
        this.studio.activeDesignTitle = e.target.value.trim() || 'Untitled Design';
      });
    }

    // Zoom Controls
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.studio.setZoom(this.studio.zoom * 1.15));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.studio.setZoom(this.studio.zoom / 1.15));
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.studio.fitToScreen());
    document.getElementById('btn-zoom-100')?.addEventListener('click', () => this.studio.zoom100());

    // Grid and Rulers Toggle
    document.getElementById('btn-toggle-grid')?.addEventListener('click', (e) => {
      const grid = document.getElementById('canvas-grid-overlay');
      grid.classList.toggle('active');
      e.currentTarget.classList.toggle('active');
      this.toast(`Grid ${grid.classList.contains('active') ? 'Enabled' : 'Disabled'}`, 'info');
    });

    // Bulk Mode Modal Actions
    document.getElementById('btn-close-bulk-modal')?.addEventListener('click', () => this.closeBulkModal());
    document.getElementById('bulk-file-input')?.addEventListener('change', (e) => {
      this.bulkEngine.addFiles(e.target.files);
      e.target.value = ''; // reset
    });

    // Bulk Dropzone Drag and Drop
    const dropzone = document.getElementById('bulk-dropzone');
    if (dropzone) {
      dropzone.addEventListener('click', () => document.getElementById('bulk-file-input').click());
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files) {
          this.bulkEngine.addFiles(e.dataTransfer.files);
        }
      });
    }

    // Demo Sample Batch Loaders (10, 25, 50 images)
    document.getElementById('btn-load-10-samples')?.addEventListener('click', () => this.bulkEngine.loadSampleImages(10));
    document.getElementById('btn-load-25-samples')?.addEventListener('click', () => this.bulkEngine.loadSampleImages(25));
    document.getElementById('btn-load-50-samples')?.addEventListener('click', () => this.bulkEngine.loadSampleImages(50));
    document.getElementById('btn-clear-bulk-images')?.addEventListener('click', () => this.bulkEngine.clearAllImages());

    // APPLY DESIGN TO ALL HERO BUTTON
    document.getElementById('btn-apply-design-all')?.addEventListener('click', () => {
      const fitMode = document.getElementById('bulk-fit-mode').value;
      const namingScheme = document.getElementById('bulk-naming-mode').value;
      const customPrefix = document.getElementById('bulk-custom-prefix').value;
      this.bulkEngine.applyDesignToAll({ fitMode, namingScheme, customPrefix });
    });

    // Bulk Export All ZIP
    document.getElementById('btn-bulk-export-zip')?.addEventListener('click', () => {
      const format = document.getElementById('bulk-export-format').value;
      this.bulkEngine.exportBulkZIP(null, format);
    });

    // Bulk Retry Failed
    document.getElementById('btn-retry-failed')?.addEventListener('click', () => this.bulkEngine.retryFailed());

    // Setup Properties Inspector Listeners
    this.setupPropertiesListeners();

    // Setup Keyboard Shortcuts
    this.setupKeyboardShortcuts();
  }

  /**
   * Switch Left Tool Strip Tab
   */
  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.tool-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });

    const drawer = document.getElementById('drawer-panel');
    drawer.classList.remove('collapsed');

    this.renderActiveDrawer();
  }

  /**
   * Render Active Drawer Content based on currentTab
   */
  renderActiveDrawer() {
    const titleEl = document.getElementById('drawer-header-title');
    const bodyEl = document.getElementById('drawer-body-content');
    if (!titleEl || !bodyEl) return;

    if (this.currentTab === 'templates') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg> Design Templates`;
      this.renderTemplatesDrawer(bodyEl);
    } else if (this.currentTab === 'ai-studio') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="8"/></svg> AI Design Studio`;
      this.renderAiStudioDrawer(bodyEl);
    } else if (this.currentTab === 'elements') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/></svg> Vector Elements`;
      this.renderElementsDrawer(bodyEl);
    } else if (this.currentTab === 'text') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> Typography & Presets`;
      this.renderTextDrawer(bodyEl);
    } else if (this.currentTab === 'shapes') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Geometric Shapes`;
      this.renderShapesDrawer(bodyEl);
    } else if (this.currentTab === 'images') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Images & Media`;
      this.renderImagesDrawer(bodyEl);
    } else if (this.currentTab === 'background') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg> Background & Gradients`;
      this.renderBackgroundDrawer(bodyEl);
    } else if (this.currentTab === 'layers') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> Canvas Layers`;
      this.renderLayersDrawer(bodyEl);
    } else if (this.currentTab === 'my-designs') {
      titleEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> My Saved Designs`;
      this.renderMyDesignsDrawer(bodyEl);
    }
  }

  /**
   * AI Design Studio (prompt-driven generation)
   */
  renderAiStudioDrawer(container) {
    const savedKey = localStorage.getItem('ri-ai-api-key') || '';
    const savedProvider = localStorage.getItem('ri-ai-provider') || 'openrouter';
    const savedModel = localStorage.getItem('ri-ai-model') || this.getDefaultAiModel(savedProvider);

    container.innerHTML = `
      <div class="ai-studio-panel">
        <div class="ai-prompt-box">
          <label class="inspector-label">AI DESIGN PROMPT</label>
          <textarea id="ai-design-prompt" class="ai-prompt-input" rows="4" placeholder="e.g. Luxury black gold smartwatch campaign for premium audience">Luxury black gold smartwatch campaign for premium audience</textarea>
        </div>

        <div class="ai-style-picker">
          <label class="inspector-label">STYLE MIX</label>
          <div class="ai-style-grid">
            <button class="ai-style-btn active" data-ai-style="luxury">Luxury</button>
            <button class="ai-style-btn" data-ai-style="minimal">Minimal</button>
            <button class="ai-style-btn" data-ai-style="tech">Tech</button>
            <button class="ai-style-btn" data-ai-style="sale">Sale</button>
            <button class="ai-style-btn" data-ai-style="fashion">Fashion</button>
            <button class="ai-style-btn" data-ai-style="food">Food</button>
          </div>
        </div>

        <div class="ai-config-box">
          <label class="inspector-label">PROVIDER</label>
          <select id="ai-provider-select" class="ai-model-select">
            <option value="openrouter" ${savedProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
            <option value="openai" ${savedProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="gemini" ${savedProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
            <option value="claude" ${savedProvider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
            <option value="grok" ${savedProvider === 'grok' ? 'selected' : ''}>xAI Grok</option>
          </select>
        </div>

        <div class="ai-config-box">
          <label class="inspector-label">API KEY</label>
          <div class="ai-key-row">
            <input id="ai-api-key" class="ai-api-input" type="password" value="${savedKey}" placeholder="Paste your ${savedProvider} API key" />
            <button type="button" id="btn-ai-create-key" class="btn-secondary ai-key-btn">Create Key</button>
          </div>
        </div>

        <div class="ai-config-box">
          <label class="inspector-label">MODEL</label>
          <select id="ai-model-select" class="ai-model-select">
            <option value="openai/gpt-4o-mini" ${savedModel === 'openai/gpt-4o-mini' ? 'selected' : ''}>OpenAI GPT-4o Mini</option>
            <option value="google/gemini-2.5-flash" ${savedModel === 'google/gemini-2.5-flash' ? 'selected' : ''}>Google Gemini 2.5 Flash</option>
            <option value="google/gemini-2.5-pro" ${savedModel === 'google/gemini-2.5-pro' ? 'selected' : ''}>Google Gemini 2.5 Pro</option>
            <option value="google/gemini-3.5-flash" ${savedModel === 'google/gemini-3.5-flash' ? 'selected' : ''}>Google Gemini 3.5 Flash</option>
            <option value="google/gemini-3.8-pro" ${savedModel === 'google/gemini-3.8-pro' ? 'selected' : ''}>Google Gemini 3.8 Pro</option>
            <option value="anthropic/claude-3.5-sonnet" ${savedModel === 'anthropic/claude-3.5-sonnet' ? 'selected' : ''}>Anthropic Claude 3.5 Sonnet</option>
            <option value="xai/grok-2-latest" ${savedModel === 'xai/grok-2-latest' ? 'selected' : ''}>xAI Grok 2 Latest</option>
            <option value="gpt-4o-mini" ${savedModel === 'gpt-4o-mini' ? 'selected' : ''}>Direct OpenAI GPT-4o Mini</option>
            <option value="gemini-2.5-flash" ${savedModel === 'gemini-2.5-flash' ? 'selected' : ''}>Direct Gemini 2.5 Flash</option>
            <option value="gemini-2.5-pro" ${savedModel === 'gemini-2.5-pro' ? 'selected' : ''}>Direct Gemini 2.5 Pro</option>
            <option value="gemini-3.5-flash" ${savedModel === 'gemini-3.5-flash' ? 'selected' : ''}>Direct Gemini 3.5 Flash</option>
            <option value="gemini-3.8-pro" ${savedModel === 'gemini-3.8-pro' ? 'selected' : ''}>Direct Gemini 3.8 Pro</option>
            <option value="claude-3-5-sonnet-20241022" ${savedModel === 'claude-3-5-sonnet-20241022' ? 'selected' : ''}>Direct Claude 3.5 Sonnet</option>
            <option value="grok-2-latest" ${savedModel === 'grok-2-latest' ? 'selected' : ''}>Direct Grok 2 Latest</option>
          </select>
        </div>

        <div class="ai-actions">
          <button class="btn-primary" id="btn-ai-generate">Generate Design</button>
          <button class="btn-secondary" id="btn-ai-random">Random Mix</button>
        </div>

        <div class="ai-insight-grid">
          <div class="ai-insight-card">
            <span>Recommended Layout</span>
            <strong id="ai-layout-label">Luxury Hero Banner</strong>
          </div>
          <div class="ai-insight-card">
            <span>Suggested CTA</span>
            <strong id="ai-cta-label">Shop Now</strong>
          </div>
        </div>
      </div>
    `;

    let activeAiStyle = 'luxury';

    const providerSelect = container.querySelector('#ai-provider-select');
    const keyInput = container.querySelector('#ai-api-key');

    providerSelect?.addEventListener('change', () => {
      const nextProvider = providerSelect.value;
      const nextModel = this.getDefaultAiModel(nextProvider);
      const modelSelect = container.querySelector('#ai-model-select');
      if (modelSelect) {
        modelSelect.value = nextModel;
        localStorage.setItem('ri-ai-model', nextModel);
      }
      localStorage.setItem('ri-ai-provider', nextProvider);
      if (keyInput) {
        keyInput.placeholder = `Paste your ${nextProvider} API key`;
      }
      const createButton = container.querySelector('#btn-ai-create-key');
      if (createButton) {
        createButton.title = `Create ${nextProvider} API key`;
      }
    });

    container.querySelector('#btn-ai-create-key')?.addEventListener('click', () => {
      const activeProvider = container.querySelector('#ai-provider-select')?.value || 'openrouter';
      const url = this.getProviderApiUrl(activeProvider);
      window.open(url, '_blank', 'noopener,noreferrer');
      this.toast(`Open ${activeProvider.toUpperCase()} key page`, 'info');
    });

    container.querySelectorAll('.ai-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeAiStyle = btn.dataset.aiStyle;
        container.querySelectorAll('.ai-style-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    container.querySelector('#btn-ai-random')?.addEventListener('click', () => {
      const styles = ['luxury', 'minimal', 'tech', 'sale', 'fashion', 'food'];
      const next = styles[Math.floor(Math.random() * styles.length)];
      activeAiStyle = next;
      const btn = container.querySelector(`[data-ai-style="${next}"]`);
      if (btn) {
        container.querySelectorAll('.ai-style-btn').forEach(b => b.classList.toggle('active', b === btn));
      }
      const promptPool = [
        'Luxury premium product campaign for smart watch',
        'Minimal modern restaurant banner',
        'Tech startup launch design for SaaS product',
        'Fashion sale hero banner for summer collection',
        'High-conversion food promo poster',
        'Bold product launch poster for cosmetic brand'
      ];
      const promptInput = document.getElementById('ai-design-prompt');
      if (promptInput) promptInput.value = promptPool[Math.floor(Math.random() * promptPool.length)];
    });

    container.querySelector('#btn-ai-generate')?.addEventListener('click', async () => {
      const promptInput = document.getElementById('ai-design-prompt');
      const apiKeyInput = document.getElementById('ai-api-key');
      const providerSelect = document.getElementById('ai-provider-select');
      const modelSelect = document.getElementById('ai-model-select');
      const prompt = (promptInput?.value || '').trim() || 'Premium modern product launch campaign';

      if (apiKeyInput) {
        const value = apiKeyInput.value.trim();
        if (value) {
          localStorage.setItem('ri-ai-api-key', value);
        } else {
          localStorage.removeItem('ri-ai-api-key');
        }
      }

      if (providerSelect) {
        localStorage.setItem('ri-ai-provider', providerSelect.value);
      }

      if (modelSelect) {
        localStorage.setItem('ri-ai-model', modelSelect.value);
      }

      const generated = await this.generateAiDesign(prompt, activeAiStyle);
      if (generated) {
        this.toast(generated.isRealAi ? 'Real AI concept generated and applied to canvas' : 'AI concept generated and applied to canvas', generated.isRealAi ? 'success' : 'info');
      }
    });
  }

  getProviderApiUrl(provider = 'openrouter') {
    const map = {
      openrouter: 'https://openrouter.ai/keys',
      openai: 'https://platform.openai.com/api-keys',
      gemini: 'https://aistudio.google.com/app/apikey',
      claude: 'https://console.anthropic.com/settings/keys',
      grok: 'https://console.x.ai/'
    };
    return map[provider] || map.openrouter;
  }

  getDefaultAiModel(provider = 'openrouter') {
    const map = {
      openrouter: 'openai/gpt-4o-mini',
      openai: 'gpt-4o-mini',
      gemini: 'gemini-3.8-pro',
      claude: 'claude-3-5-sonnet-20241022',
      grok: 'grok-2-latest'
    };
    return map[provider] || map.openrouter;
  }

  async generateAiDesign(prompt, style = 'luxury') {
    const apiResult = await this.tryGenerateDesignFromApi(prompt, style);
    if (apiResult) {
      this.applyGeneratedDesignSpec(apiResult, true);
      return { isRealAi: true };
    }

    const normalized = (prompt || '').toLowerCase();
    const cleanPrompt = (prompt || '').replace(/\s+/g, ' ').trim();
    const title = this.aiTitleFromPrompt(cleanPrompt);
    const layout = this.aiLayoutFromPrompt(normalized, style);
    const palette = this.aiPaletteFromPrompt(normalized, style);
    this.applyGeneratedDesignSpec({ title, subtitle: layout.subtitle, cta: layout.cta, price: layout.price, palette }, false);
    return { isRealAi: false };
  }

  applyGeneratedDesignSpec(spec, isRealAi = false) {
    const title = spec.title || 'AI Premium Design';
    const subtitle = spec.subtitle || 'Creative concept generated for your campaign';
    const cta = spec.cta || 'Shop Now';
    const price = spec.price || '$99';
    const palette = spec.palette || { bg1: '#0f172a', bg2: '#4f46e5', bg3: '#ec4899' };

    const canvas = this.studio.canvas;
    canvas.clear();
    this.studio.setBackground({
      type: 'gradient',
      gradient: {
        angle: 135,
        type: 'linear',
        stops: [
          { offset: 0, color: palette.bg1 },
          { offset: 0.5, color: palette.bg2 },
          { offset: 1, color: palette.bg3 }
        ]
      }
    });

    const accent = new fabric.Rect({
      left: 0,
      top: 0,
      width: this.studio.width,
      height: this.studio.height * 0.18,
      fill: 'rgba(255,255,255,0.08)',
      selectable: false
    });
    canvas.add(accent);

    const badge = new fabric.Rect({
      left: this.studio.width * 0.08,
      top: this.studio.height * 0.08,
      width: 180,
      height: 36,
      rx: 18,
      ry: 18,
      fill: 'rgba(255,255,255,0.14)',
      selectable: false
    });
    canvas.add(badge);

    const badgeText = new fabric.IText(isRealAi ? 'REAL AI' : 'AI EDITION', {
      left: this.studio.width * 0.1,
      top: this.studio.height * 0.09,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 14,
      fontWeight: '700',
      fill: '#ffffff',
      letterSpacing: 2,
      selectable: false
    });
    canvas.add(badgeText);

    const heroText = new fabric.IText(title, {
      left: this.studio.width * 0.08,
      top: this.studio.height * 0.42,
      fontFamily: 'Poppins',
      fontSize: Math.min(this.studio.width * 0.06, 62),
      fontWeight: '800',
      fill: '#ffffff',
      lineHeight: 1,
      width: this.studio.width * 0.52,
      selectable: false
    });
    canvas.add(heroText);

    const subtitleText = new fabric.IText(subtitle, {
      left: this.studio.width * 0.08,
      top: this.studio.height * 0.62,
      fontFamily: 'Inter',
      fontSize: 22,
      fill: 'rgba(255,255,255,0.9)',
      width: this.studio.width * 0.5,
      selectable: false
    });
    canvas.add(subtitleText);

    const ctaBox = new fabric.Rect({
      left: this.studio.width * 0.08,
      top: this.studio.height * 0.72,
      width: 180,
      height: 52,
      rx: 26,
      ry: 26,
      fill: '#ffffff',
      selectable: false
    });
    canvas.add(ctaBox);

    const ctaText = new fabric.IText(cta, {
      left: this.studio.width * 0.12,
      top: this.studio.height * 0.74,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 16,
      fontWeight: '800',
      fill: palette.bg1,
      selectable: false
    });
    canvas.add(ctaText);

    const productCard = new fabric.Rect({
      left: this.studio.width * 0.64,
      top: this.studio.height * 0.21,
      width: this.studio.width * 0.24,
      height: this.studio.height * 0.54,
      rx: 28,
      ry: 28,
      fill: 'rgba(255,255,255,0.12)',
      stroke: 'rgba(255,255,255,0.35)',
      strokeWidth: 2,
      selectable: false
    });
    canvas.add(productCard);

    const productGlow = new fabric.Rect({
      left: this.studio.width * 0.67,
      top: this.studio.height * 0.24,
      width: this.studio.width * 0.19,
      height: this.studio.height * 0.47,
      rx: 24,
      ry: 24,
      fill: 'rgba(15,23,42,0.18)',
      selectable: false
    });
    canvas.add(productGlow);

    const priceTag = new fabric.Rect({
      left: this.studio.width * 0.65,
      top: this.studio.height * 0.76,
      width: this.studio.width * 0.18,
      height: 42,
      rx: 21,
      ry: 21,
      fill: '#ffffff',
      selectable: false
    });
    canvas.add(priceTag);

    const priceText = new fabric.IText(price, {
      left: this.studio.width * 0.69,
      top: this.studio.height * 0.775,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 18,
      fontWeight: '800',
      fill: palette.bg1,
      selectable: false
    });
    canvas.add(priceText);

    canvas.discardActiveObject();
    canvas.renderAll();
    this.studio.activeDesignTitle = title;
    const titleInput = document.getElementById('header-design-title');
    if (titleInput) titleInput.value = title;
    this.updateStatusbar();
  }

  parseAiJsonResponse(rawText) {
    const cleaned = (rawText || '').replace(/```json|```/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
    return JSON.parse(jsonText);
  }

  async tryGenerateDesignFromApi(prompt, style = 'luxury') {
    const apiKey = localStorage.getItem('ri-ai-api-key')?.trim();
    if (!apiKey) return null;

    const provider = localStorage.getItem('ri-ai-provider') || 'openrouter';
    const model = localStorage.getItem('ri-ai-model') || this.getDefaultAiModel(provider);
    const promptText = `Create a premium social ad hero banner for: ${prompt}. Style: ${style}. The design should feel modern, premium, sales-focused, and conversion friendly.`;

    try {
      let response;
      let payload;

      if (provider === 'gemini') {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
            contents: [{ parts: [{ text: `You are a premium marketing designer. Return valid JSON only with keys: title, subtitle, cta, price, palette. palette must include bg1, bg2, bg3 as hex colors. Keep title short, catchy, and under 6 words. subtitle under 90 characters. cta under 16 chars.\n\n${promptText}` }] }]
          })
        });
        payload = await response.json();
        const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text).join('') || '';
        const parsed = this.parseAiJsonResponse(text);
        if (!parsed || !parsed.title) throw new Error('Invalid Gemini response format');
        const palette = parsed.palette || {};
        return {
          title: parsed.title,
          subtitle: parsed.subtitle || 'Conversion-focused creative for your audience.',
          cta: parsed.cta || 'Shop Now',
          price: parsed.price || '$99',
          palette: { bg1: palette.bg1 || '#0f172a', bg2: palette.bg2 || '#4f46e5', bg3: palette.bg3 || '#ec4899' }
        };
      }

      if (provider === 'claude') {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: 400,
            temperature: 0.7,
            system: 'You are a premium marketing designer. Return valid JSON only with keys: title, subtitle, cta, price, palette. palette must include bg1, bg2, bg3 as hex colors. Keep title short, catchy, and under 6 words. subtitle under 90 characters. cta under 16 chars.',
            messages: [{ role: 'user', content: promptText }]
          })
        });
        payload = await response.json();
        const text = payload?.content?.[0]?.text || '';
        const parsed = this.parseAiJsonResponse(text);
        if (!parsed || !parsed.title) throw new Error('Invalid Claude response format');
        const palette = parsed.palette || {};
        return {
          title: parsed.title,
          subtitle: parsed.subtitle || 'Conversion-focused creative for your audience.',
          cta: parsed.cta || 'Shop Now',
          price: parsed.price || '$99',
          palette: { bg1: palette.bg1 || '#0f172a', bg2: palette.bg2 || '#4f46e5', bg3: palette.bg3 || '#ec4899' }
        };
      }

      if (provider === 'grok') {
        response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            messages: [
              { role: 'system', content: 'You are a premium marketing designer. Return valid JSON only with keys: title, subtitle, cta, price, palette. palette must include bg1, bg2, bg3 as hex colors. Keep title short, catchy, and under 6 words. subtitle under 90 characters. cta under 16 chars.' },
              { role: 'user', content: promptText }
            ]
          })
        });
        payload = await response.json();
        const text = payload?.choices?.[0]?.message?.content || '';
        const parsed = this.parseAiJsonResponse(text);
        if (!parsed || !parsed.title) throw new Error('Invalid Grok response format');
        const palette = parsed.palette || {};
        return {
          title: parsed.title,
          subtitle: parsed.subtitle || 'Conversion-focused creative for your audience.',
          cta: parsed.cta || 'Shop Now',
          price: parsed.price || '$99',
          palette: { bg1: palette.bg1 || '#0f172a', bg2: palette.bg2 || '#4f46e5', bg3: palette.bg3 || '#ec4899' }
        };
      }

      if (provider === 'openai') {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You are a premium marketing designer. Return valid JSON only with keys: title, subtitle, cta, price, palette. palette must include bg1, bg2, bg3 as hex colors. Keep title short, catchy, and under 6 words. subtitle under 90 characters. cta under 16 chars.' },
              { role: 'user', content: promptText }
            ]
          })
        });
      } else {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': window.location.origin || 'https://localhost',
            'X-Title': 'RI Creative AI Studio'
          },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You are a premium marketing designer. Return valid JSON only with keys: title, subtitle, cta, price, palette. palette must include bg1, bg2, bg3 as hex colors. Keep title short, catchy, and under 6 words. subtitle under 90 characters. cta under 16 chars.' },
              { role: 'user', content: promptText }
            ]
          })
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI request failed: ${response.status} ${errorText}`);
      }

      payload = await response.json();
      const raw = payload?.choices?.[0]?.message?.content || '';
      const parsed = this.parseAiJsonResponse(raw);

      if (!parsed || !parsed.title) {
        throw new Error('Invalid AI response format');
      }

      const palette = parsed.palette || {};
      return {
        title: parsed.title,
        subtitle: parsed.subtitle || 'Conversion-focused creative for your audience.',
        cta: parsed.cta || 'Shop Now',
        price: parsed.price || '$99',
        palette: {
          bg1: palette.bg1 || '#0f172a',
          bg2: palette.bg2 || '#4f46e5',
          bg3: palette.bg3 || '#ec4899'
        }
      };
    } catch (error) {
      console.error('Real AI generation failed:', error);
      this.toast('Selected AI provider key is invalid or request failed. Using local fallback design.', 'warning');
      return null;
    }
  }

  aiTitleFromPrompt(prompt) {
    const cleaned = (prompt || '').replace(/^(create|design|make|generate|an|a|for|with|about)/gi, '').trim();
    const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4);
    if (!words.length) return 'AI Premium Design';
    return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  aiLayoutFromPrompt(normalized, style) {
    const saleKeywords = ['sale', 'offer', 'discount', 'promo', 'launch'];
    const luxuryKeywords = ['luxury', 'premium', 'gold', 'elegant', 'fashion'];
    const techKeywords = ['tech', 'app', 'saas', 'startup', 'digital'];
    const foodKeywords = ['food', 'restaurant', 'coffee', 'bakery', 'cafe'];
    const minimalKeywords = ['minimal', 'clean', 'modern', 'studio'];

    if (saleKeywords.some(word => normalized.includes(word)) || style === 'sale') {
      return { subtitle: 'Limited-time offer designed to convert attention into action.', cta: 'Shop Offer', price: '$49.99' };
    }
    if (luxuryKeywords.some(word => normalized.includes(word)) || style === 'luxury') {
      return { subtitle: 'Crafted for high-end positioning and premium brand perception.', cta: 'Explore Now', price: '$299' };
    }
    if (techKeywords.some(word => normalized.includes(word)) || style === 'tech') {
      return { subtitle: 'UI-ready launch visual for modern software and digital products.', cta: 'Try Demo', price: '$39' };
    }
    if (foodKeywords.some(word => normalized.includes(word)) || style === 'food') {
      return { subtitle: 'Fresh, irresistible, and built to sell in a crowded market.', cta: 'Order Today', price: '$18' };
    }
    if (minimalKeywords.some(word => normalized.includes(word)) || style === 'minimal') {
      return { subtitle: 'Soft contrast, balanced whitespace, and clean conversion-focused layout.', cta: 'Learn More', price: '$79' };
    }
    return { subtitle: 'Conversion-oriented creative with a polished premium finish.', cta: 'Get Started', price: '$99' };
  }

  aiPaletteFromPrompt(normalized, style) {
    if (style === 'sale' || normalized.includes('sale') || normalized.includes('offer')) {
      return { bg1: '#dc2626', bg2: '#f97316', bg3: '#fb7185' };
    }
    if (style === 'tech' || normalized.includes('tech') || normalized.includes('saas') || normalized.includes('app')) {
      return { bg1: '#0f172a', bg2: '#0ea5e9', bg3: '#312e81' };
    }
    if (style === 'minimal' || normalized.includes('minimal') || normalized.includes('clean')) {
      return { bg1: '#334155', bg2: '#94a3b8', bg3: '#e2e8f0' };
    }
    if (style === 'food' || normalized.includes('food') || normalized.includes('restaurant')) {
      return { bg1: '#f97316', bg2: '#fb923c', bg3: '#facc15' };
    }
    if (style === 'fashion' || normalized.includes('fashion') || normalized.includes('beauty')) {
      return { bg1: '#7c3aed', bg2: '#ec4899', bg3: '#f9a8d4' };
    }
    return { bg1: '#0f172a', bg2: '#4f46e5', bg3: '#ec4899' };
  }

  /**
   * 1. TEMPLATES DRAWER (100+ Ready Templates)
   */
  renderTemplatesDrawer(container) {
    container.innerHTML = `
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="template-search-input" class="search-input" placeholder="Search 100+ templates..." value="${this.searchQuery}">
      </div>

      <div class="category-pills" id="template-filter-pills" style="margin-bottom:4px;">
        <button class="pill-btn ${this.templateFilter==='all'?'active':''}" data-tfilter="all">🏠 All</button>
        <button class="pill-btn ${this.templateFilter==='favorites'?'active':''}" data-tfilter="favorites">★ Favorites</button>
        <button class="pill-btn ${this.templateFilter==='recent'?'active':''}" data-tfilter="recent">🕒 Recent</button>
      </div>

      <div class="category-pills" id="template-category-pills" style="padding-top:0;">
        ${window.RI_DATA.TEMPLATE_CATEGORIES.map(cat => `
          <button class="pill-btn ${this.activeCategory === cat ? 'active' : ''}" data-cat="${cat}">${cat}</button>
        `).join('')}
      </div>

      <div class="templates-grid" id="templates-grid-list"></div>
    `;

    // Search
    const searchInput = container.querySelector('#template-search-input');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.updateTemplatesList();
    });

    // Smart filter pills (all / favorites / recent)
    container.querySelectorAll('[data-tfilter]').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('[data-tfilter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.templateFilter = btn.dataset.tfilter;
        this.updateTemplatesList();
      });
    });

    // Category pills
    container.querySelectorAll('.pill-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        container.querySelectorAll('.pill-btn[data-cat]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.activeCategory = e.currentTarget.dataset.cat;
        this.updateTemplatesList();
      });
    });

    this.updateTemplatesList();
  }

  updateTemplatesList() {
    const grid = document.getElementById('templates-grid-list');
    if (!grid) return;

    let list = window.RI_DATA.TEMPLATES_DATABASE;

    // Filter by smart filter
    if (this.templateFilter === 'favorites') {
      list = list.filter(t => this.favoritesSet.has(t.id));
    } else if (this.templateFilter === 'recent') {
      const recentIds = this.recentTemplates;
      list = list.filter(t => recentIds.includes(t.id));
      // Sort by recency
      list.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
    }

    // Filter by Category
    if (this.activeCategory && this.activeCategory !== 'All') {
      list = list.filter(t => t.category === this.activeCategory || (t.subcategories && t.subcategories.includes(this.activeCategory)));
    }

    // Filter by Search Query
    if (this.searchQuery) {
      list = list.filter(t => {
        const searchableText = [
          t.id,
          t.title,
          t.category,
          ...(Array.isArray(t.subcategories) ? t.subcategories : [])
        ].filter(Boolean).join(' ').toLowerCase();
        return searchableText.includes(this.searchQuery);
      });
    }

    if (list.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: span 2; text-align: center; padding: 30px 10px; color: var(--text-muted);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.5;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <div style="font-size:13px; font-weight:700;">No templates found</div>
          <div style="font-size:11px; margin-top:4px;">Try searching for "Social", "Instagram", "Sale", or clear filters.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = list.map(t => {
      const isFav = this.favoritesSet.has(t.id);
      const photoLayer = t.layers.find(l => l.type === 'image');
      const thumbSrc = photoLayer ? photoLayer.src : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300';
      return `
        <div class="template-card" data-template-id="${t.id}">
          <div class="template-thumb-box" style="background:${t.previewColor || '#f1f5f9'}">
            <img src="${thumbSrc}" alt="${t.title}" loading="lazy">
            <button class="template-fav-btn ${isFav ? 'active' : ''}" data-fav-id="${t.id}" title="Toggle Favorite">
              ★
            </button>
          </div>
          <div class="template-card-info">
            <div class="template-card-title">${t.title}</div>
            <div class="template-card-cat">${t.category} • ${t.width}×${t.height}</div>
          </div>
        </div>
      `;
    }).join('');

    // Click handler to load template
    grid.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.template-fav-btn')) return;
        const tId = card.dataset.templateId;
        const found = window.RI_DATA.TEMPLATES_DATABASE.find(t => t.id === tId);
        if (found) {
          this.studio.loadTemplate(found);
          document.getElementById('header-design-title').value = found.title;
          // Track recent
          this.recentTemplates = [tId, ...this.recentTemplates.filter(id => id !== tId)].slice(0, 20);
          this.toast(`Loaded Template: ${found.title}`, 'success');
        }
      });
    });

    // Favorite handler
    grid.querySelectorAll('.template-fav-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tId = btn.dataset.favId;
        const nowFav = await window.RI_STORAGE.toggleTemplateFavorite(tId);
        if (nowFav) {
          this.favoritesSet.add(tId);
          btn.classList.add('active');
          this.toast('Added template to favorites!', 'info');
        } else {
          this.favoritesSet.delete(tId);
          btn.classList.remove('active');
          this.toast('Removed from favorites.', 'info');
        }
      });
    });
  }

  /**
   * 2. ELEMENTS DRAWER (50+ Vector Assets)
   */
  renderElementsDrawer(container) {
    container.innerHTML = `
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="element-search-input" class="search-input" placeholder="Search features and elements...">
      </div>
      <div style="font-size:12px; color:var(--text-muted);">Click any element to add it directly to the canvas:</div>
      <div class="elements-grid" id="elements-grid-list"></div>
    `;

    const searchInput = container.querySelector('#element-search-input');
    const grid = container.querySelector('#elements-grid-list');
    const renderElements = (query = '') => {
      const normalizedQuery = query.toLowerCase().trim();
      const elements = window.RI_DATA.ELEMENT_PRESETS.filter(element => {
        const searchableText = [element.id, element.name, element.type].filter(Boolean).join(' ').toLowerCase();
        return !normalizedQuery || searchableText.includes(normalizedQuery);
      });

      if (!elements.length) {
        grid.innerHTML = '<div style="grid-column:1 / -1; text-align:center; padding:30px 10px; color:var(--text-muted); font-size:12px;">No features found. Try another search.</div>';
        return;
      }

      grid.innerHTML = elements.map(el => `
        <div class="element-item" data-element-id="${el.id}" draggable="true">
          ${el.svg}
          <div class="element-label">${el.name}</div>
        </div>
      `).join('');

      grid.querySelectorAll('.element-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('ri-drop-type', 'element');
          e.dataTransfer.setData('ri-drop-id', item.dataset.elementId);
        });
        item.addEventListener('click', () => {
          const elId = item.dataset.elementId;
          const def = window.RI_DATA.ELEMENT_PRESETS.find(e => e.id === elId);
          if (def) {
            this.studio.addElementSVG(def);
            this.toast(`Added ${def.name}`, 'info');
          }
        });
      });
    };

    searchInput.addEventListener('input', (event) => renderElements(event.target.value));
    renderElements();
  }

  /**
   * 3. TEXT & TYPOGRAPHY DRAWER (20+ Presets)
   */
  renderTextDrawer(container) {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn-secondary" id="btn-add-heading" draggable="true" data-text-type="heading" style="padding:12px; font-size:18px; font-weight:800;">
          + Add a Heading
        </button>
        <button class="btn-secondary" id="btn-add-subheading" draggable="true" data-text-type="subheading" style="padding:10px; font-size:14px; font-weight:600;">
          + Add a Subheading
        </button>
        <button class="btn-secondary" id="btn-add-body" draggable="true" data-text-type="body" style="padding:8px; font-size:12px;">
          + Add a Little Bit of Body Text
        </button>
      </div>

      <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-top:8px;">
        TYPOGRAPHY PRESETS
      </div>

      <div class="typography-presets-list">
        ${window.RI_DATA.TYPOGRAPHY_PRESETS.map((tp, idx) => `
          <div class="typography-preset-card" data-preset-index="${idx}">
            <div class="typography-preview-text" style="font-family:'${tp.fontFamily}', sans-serif; color:${tp.fill}; font-weight:${tp.fontWeight}">
              ${tp.name}
            </div>
            <div class="typography-preset-meta">${tp.fontFamily}</div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('[data-text-type]').forEach(btn => {
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('ri-drop-type', 'text');
        e.dataTransfer.setData('ri-drop-id', btn.dataset.textType);
      });
    });
    container.querySelector('#btn-add-heading')?.addEventListener('click', () => {
      this.studio.addText('heading');
      this.toast('Added Heading', 'info');
    });
    container.querySelector('#btn-add-subheading')?.addEventListener('click', () => {
      this.studio.addText('subheading');
      this.toast('Added Subheading', 'info');
    });
    container.querySelector('#btn-add-body')?.addEventListener('click', () => {
      this.studio.addText('body');
      this.toast('Added Body Text', 'info');
    });

    container.querySelectorAll('.typography-preset-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.presetIndex, 10);
        const preset = window.RI_DATA.TYPOGRAPHY_PRESETS[idx];
        if (preset) {
          this.studio.applyTypographyPreset(preset);
          this.toast(`Applied Preset: ${preset.name}`, 'info');
        }
      });
    });
  }

  /**
   * 4. SHAPES DRAWER (30+ Geometric Shapes)
   */
  renderShapesDrawer(container) {
    container.innerHTML = `
      <div style="font-size:12px; color:var(--text-muted);">Click any shape to place it in the center of the canvas:</div>
      <div class="elements-grid">
        ${window.RI_DATA.SHAPE_DEFINITIONS.map(shape => `
          <div class="element-item" data-shape-id="${shape.id}" draggable="true">
            <div style="width:36px; height:36px; background:${shape.fill}; border-radius:${shape.rx ? '8px' : shape.type === 'circle' ? '50%' : '2px'};"></div>
            <div class="element-label">${shape.name}</div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.element-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('ri-drop-type', 'shape');
        e.dataTransfer.setData('ri-drop-id', item.dataset.shapeId);
      });
      item.addEventListener('click', () => {
        const shapeId = item.dataset.shapeId;
        const def = window.RI_DATA.SHAPE_DEFINITIONS.find(s => s.id === shapeId);
        if (def) {
          this.studio.addShape(def);
          this.toast(`Added ${def.name}`, 'info');
        }
      });
    });
  }

  /**
   * 5. IMAGES & MEDIA DRAWER
   */
  renderImagesDrawer(container) {
    container.innerHTML = `
      <input type="file" id="single-image-upload-input" accept="image/*" style="display:none;">
      <button class="btn-primary" id="btn-trigger-single-upload" style="width:100%; height:40px; display:flex; align-items:center; justify-content:center; gap:8px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Upload New Image
      </button>

      <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-top:8px;">
        CURATED STOCK PHOTO ASSETS
      </div>

      <div class="elements-grid" style="grid-template-columns: repeat(2, 1fr);">
        ${window.RI_DATA.SAMPLE_BULK_IMAGES.slice(0, 16).map(img => `
          <div class="template-card stock-img-item" data-img-url="${img.url}" draggable="true">
            <div class="template-thumb-box">
              <img src="${img.url}" alt="${img.name}" loading="lazy">
            </div>
            <div class="template-card-info" style="padding:6px 8px;">
              <div class="template-card-title" style="font-size:11px;">${img.name}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    const fileInput = container.querySelector('#single-image-upload-input');
    container.querySelector('#btn-trigger-single-upload')?.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        await this.studio.addImage(reader.result, { name: file.name.replace(/\.[^/.]+$/, '') });
        this.toast(`Uploaded: ${file.name}`, 'success');
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    container.querySelectorAll('.stock-img-item').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('ri-drop-type', 'image');
        e.dataTransfer.setData('ri-drop-id', card.dataset.imgUrl);
      });
      card.addEventListener('click', async () => {
        const url = card.dataset.imgUrl;
        const active = this.studio.canvas.getActiveObject();
        if (active && (active.type === 'image' || active.isPhotoSlot)) {
          await this.studio.replaceTargetImage(active, url, 'Cover');
          this.toast('Replaced selected image with stock asset!', 'success');
        } else {
          await this.studio.addImage(url, { name: 'Stock Image' });
          this.toast('Added stock photo to canvas!', 'info');
        }
      });
    });
  }

  /**
   * 6. BACKGROUND & GRADIENTS DRAWER (20+ Mixed Gradients)
   */
  renderBackgroundDrawer(container) {
    container.innerHTML = `
      <div class="inspector-label">SOLID CANVAS COLOR</div>
      <div class="color-picker-wrap">
        <input type="color" id="bg-color-picker" class="color-input-bubble" value="#ffffff">
        <button class="btn-secondary" id="btn-set-transparent-bg" style="flex:1;">Set Transparent</button>
      </div>

      <div class="inspector-label" style="margin-top:12px;">20+ MIXED GRADIENT PRESETS</div>
      <div class="gradients-grid">
        ${window.RI_DATA.GRADIENT_PRESETS.map((g, idx) => {
          const stopsStr = g.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ');
          const cssGrad = g.type === 'radial' ? `radial-gradient(circle, ${stopsStr})` : `linear-gradient(${g.angle || 135}deg, ${stopsStr})`;
          return `
            <div class="gradient-swatch" data-gradient-index="${idx}" style="background: ${cssGrad};">
              <span class="gradient-name">${g.name}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelector('#bg-color-picker')?.addEventListener('input', (e) => {
      this.studio.setBackground({ type: 'solid', color: e.target.value });
    });

    container.querySelector('#btn-set-transparent-bg')?.addEventListener('click', () => {
      this.studio.setBackground({ type: 'transparent' });
      this.toast('Set background to transparent', 'info');
    });

    container.querySelectorAll('.gradient-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const idx = parseInt(swatch.dataset.gradientIndex, 10);
        const preset = window.RI_DATA.GRADIENT_PRESETS[idx];
        if (preset) {
          this.studio.setBackground({ type: 'gradient', gradient: preset });
          this.toast(`Applied Gradient: ${preset.name}`, 'info');
        }
      });
    });
  }

  /**
   * 7. LAYERS DRAWER
   */
  renderLayersDrawer(container) {
    const layers = this.studio.getLayersList();
    if (layers.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:30px 10px; color:var(--text-muted);">No objects on canvas yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div style="font-size:12px; color:var(--text-muted);">Drag or use controls to manage layers:</div>
      <div class="layers-list" id="layers-stack-list">
        ${layers.map(layer => `
          <div class="layer-item-row ${this.studio.canvas.getActiveObject() === layer.ref ? 'active' : ''}" data-layer-id="${layer.id}">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:10px; color:var(--text-dim);">${layer.type.toUpperCase()}</span>
              <span>${layer.name}</span>
            </div>
            <div class="layer-actions">
              <button class="layer-btn btn-layer-up" title="Bring Forward">▲</button>
              <button class="layer-btn btn-layer-down" title="Send Backward">▼</button>
              <button class="layer-btn btn-layer-lock" title="${layer.locked ? 'Unlock' : 'Lock'}">${layer.locked ? '🔒' : '🔓'}</button>
              <button class="layer-btn btn-layer-vis" title="${layer.visible ? 'Hide' : 'Show'}">${layer.visible ? '👁' : '🚫'}</button>
              <button class="layer-btn btn-layer-del" title="Delete">🗑</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.layer-item-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.layer-btn')) return;
        const lId = row.dataset.layerId;
        const found = this.studio.canvas.getObjects().find(o => o.id === lId);
        if (found) {
          this.studio.canvas.setActiveObject(found);
          this.studio.canvas.renderAll();
        }
      });

      row.querySelector('.btn-layer-up')?.addEventListener('click', () => {
        const lId = row.dataset.layerId;
        const found = this.studio.canvas.getObjects().find(o => o.id === lId);
        if (found) this.studio.bringForward(found);
      });

      row.querySelector('.btn-layer-down')?.addEventListener('click', () => {
        const lId = row.dataset.layerId;
        const found = this.studio.canvas.getObjects().find(o => o.id === lId);
        if (found) this.studio.sendBackward(found);
      });

      row.querySelector('.btn-layer-lock')?.addEventListener('click', () => {
        const lId = row.dataset.layerId;
        const found = this.studio.canvas.getObjects().find(o => o.id === lId);
        if (found) {
          this.studio.toggleLock(found);
          this.renderLayersDrawer(container);
        }
      });

      row.querySelector('.btn-layer-vis')?.addEventListener('click', () => {
        const lId = row.dataset.layerId;
        const found = this.studio.canvas.getObjects().find(o => o.id === lId);
        if (found) {
          this.studio.toggleVisibility(found);
          this.renderLayersDrawer(container);
        }
      });

      row.querySelector('.btn-layer-del')?.addEventListener('click', () => {
        const lId = row.dataset.layerId;
        const found = this.studio.canvas.getObjects().find(o => o.id === lId);
        if (found) {
          this.studio.canvas.remove(found);
          this.studio.canvas.renderAll();
          this.renderLayersDrawer(container);
        }
      });
    });
  }

  updateLayersList() {
    if (this.currentTab === 'layers') {
      const container = document.getElementById('drawer-body-content');
      if (container) this.renderLayersDrawer(container);
    }
  }

  /**
   * 8. MY DESIGNS DRAWER (IndexedDB Persistence)
   */
  async renderMyDesignsDrawer(container) {
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading designs from database...</div>`;
    const designs = await window.RI_STORAGE.getAllDesigns();

    if (designs.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:var(--text-muted);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.5;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg>
          <div style="font-size:13px; font-weight:700;">No saved designs yet</div>
          <div style="font-size:11px; margin-top:4px;">Click "Save" in the top header or generate a batch in Bulk Mode!</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="font-size:12px; color:var(--text-muted);">${designs.length} designs saved in local database:</div>
      <div class="templates-grid">
        ${designs.map(d => `
          <div class="template-card my-design-card" data-design-id="${d.id}">
            <div class="template-thumb-box">
              <img src="${d.thumbnail || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300'}" alt="${d.title}">
            </div>
            <div class="template-card-info">
              <div class="template-card-title">${d.title}</div>
              <div class="template-card-cat">${d.isBulkBatch ? 'Bulk Batch' : 'Single Design'} • ${d.width}×${d.height}</div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:6px; padding:4px 8px 8px;">
              <button class="btn-card-action btn-del-my-design" data-del-id="${d.id}" title="Delete">🗑</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.my-design-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.btn-del-my-design')) return;
        const dId = card.dataset.designId;
        const design = await window.RI_STORAGE.getDesign(dId);
        if (design && design.canvasJSON) {
          this.studio.setDimensions(design.width, design.height, design.ppi);
          this.studio.canvas.loadFromJSON(design.canvasJSON, () => {
            this.studio.canvas.renderAll();
            this.studio.activeDesignId = design.id;
            this.studio.activeDesignTitle = design.title;
            document.getElementById('header-design-title').value = design.title;
            this.toast(`Opened Design: ${design.title}`, 'success');
          });
        }
      });
    });

    container.querySelectorAll('.btn-del-my-design').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const dId = btn.dataset.delId;
        await window.RI_STORAGE.deleteDesign(dId);
        this.toast('Deleted design', 'info');
        this.renderMyDesignsDrawer(container);
      });
    });
  }

  /**
   * Save Current Design to IndexedDB
   */
  async saveCurrentDesign() {
    const thumbnail = this.studio.generateThumbnail(240);
    const canvasJSON = JSON.stringify(this.studio.canvas.toJSON([
      'id', 'name', 'isPhotoSlot', 'locked', 'customFilters', 'rx', 'ry', 'shadow', 'stroke', 'strokeWidth'
    ]));

    const record = {
      id: this.studio.activeDesignId || `design_${Date.now()}`,
      title: this.studio.activeDesignTitle || 'Untitled Design',
      thumbnail: thumbnail,
      canvasJSON: canvasJSON,
      width: this.studio.width,
      height: this.studio.height,
      ppi: this.studio.currentPPI,
      isBulkBatch: false
    };

    const saved = await window.RI_STORAGE.saveDesign(record);
    this.studio.activeDesignId = saved.id;
    this.toast(`Design saved: "${saved.title}"`, 'success');
  }

  async saveAsNewDesign() {
    this.studio.activeDesignId = null;
    this.studio.activeDesignTitle = `${this.studio.activeDesignTitle} (Copy)`;
    document.getElementById('header-design-title').value = this.studio.activeDesignTitle;
    await this.saveCurrentDesign();
  }

  /**
   * DYNAMIC PROPERTIES INSPECTOR PANEL
   * Synchronizes with canvas selection in real-time!
   */
  syncPropertiesPanel(activeObj) {
    const container = document.getElementById('inspector-dynamic-content');
    if (!container) return;

    if (!activeObj) {
      // Show Canvas / Background settings
      container.innerHTML = `
        <div class="inspector-section">
          <div class="inspector-label">CANVAS PROPERTIES</div>
          <div class="prop-row">
            <div class="prop-col">
              <span class="prop-input-label">Width (px)</span>
              <input type="number" id="prop-canvas-w" class="input-control" value="${this.studio.width}">
            </div>
            <div class="prop-col">
              <span class="prop-input-label">Height (px)</span>
              <input type="number" id="prop-canvas-h" class="input-control" value="${this.studio.height}">
            </div>
          </div>
          <div class="prop-row">
            <div class="prop-col">
              <span class="prop-input-label">Resolution (PPI/DPI)</span>
              <select id="prop-canvas-ppi" class="input-control">
                <option value="72" ${this.studio.currentPPI === 72 ? 'selected' : ''}>72 PPI (Standard Web)</option>
                <option value="96" ${this.studio.currentPPI === 96 ? 'selected' : ''}>96 PPI (Full HD Screen)</option>
                <option value="150" ${this.studio.currentPPI === 150 ? 'selected' : ''}>150 PPI (Medium Print)</option>
                <option value="300" ${this.studio.currentPPI === 300 ? 'selected' : ''}>300 PPI (High-Res Press / 4K)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-label">BACKGROUND COLOR</div>
          <div class="color-picker-wrap">
            <input type="color" id="prop-bg-color" class="color-input-bubble" value="#ffffff">
            <button class="btn-secondary" id="prop-bg-transparent-btn" style="flex:1;">Transparent</button>
          </div>
        </div>
      `;

      container.querySelector('#prop-canvas-w')?.addEventListener('change', (e) => {
        this.studio.setDimensions(e.target.value, this.studio.height, this.studio.currentPPI);
        this.updateStatusbar();
      });
      container.querySelector('#prop-canvas-h')?.addEventListener('change', (e) => {
        this.studio.setDimensions(this.studio.width, e.target.value, this.studio.currentPPI);
        this.updateStatusbar();
      });
      container.querySelector('#prop-canvas-ppi')?.addEventListener('change', (e) => {
        this.studio.currentPPI = parseInt(e.target.value, 10);
        this.updateStatusbar();
        this.toast(`Export resolution set to ${this.studio.currentPPI} PPI`, 'info');
      });
      container.querySelector('#prop-bg-color')?.addEventListener('input', (e) => {
        this.studio.setBackground({ type: 'solid', color: e.target.value });
      });
      container.querySelector('#prop-bg-transparent-btn')?.addEventListener('click', () => {
        this.studio.setBackground({ type: 'transparent' });
      });
      return;
    }

    // Common Transform Section (Position X, Y, W, H, Rotation, Opacity)
    const posX = Math.round(activeObj.left || 0);
    const posY = Math.round(activeObj.top || 0);
    const width = Math.round(activeObj.getScaledWidth());
    const height = Math.round(activeObj.getScaledHeight());
    const angle = Math.round(activeObj.angle || 0);
    const opacity = Math.round((activeObj.opacity !== undefined ? activeObj.opacity : 1) * 100);

    let specificControls = '';

    // TEXT SPECIFIC CONTROLS
    if (activeObj.type === 'text' || activeObj.type === 'i-text') {
      const currentFont = activeObj.fontFamily || 'Inter';
      const fontSize = Math.round(activeObj.fontSize || 32);
      const isBold = activeObj.fontWeight === 'bold' || activeObj.fontWeight === '700' || activeObj.fontWeight === '800';
      const isItalic = activeObj.fontStyle === 'italic';
      const isUnderline = !!activeObj.underline;
      const fillHex = typeof activeObj.fill === 'string' ? activeObj.fill : '#0f172a';
      const strokeHex = activeObj.stroke || '#000000';
      const strokeWidth = activeObj.strokeWidth || 0;
      const shadow = activeObj.shadow || {};

      specificControls = `
        <div class="inspector-section">
          <div class="inspector-label">TYPOGRAPHY</div>
          <div class="prop-row">
            <div class="prop-col">
              <span class="prop-input-label">Font Family</span>
              <select id="prop-text-font" class="input-control">
                ${window.RI_DATA.AVAILABLE_FONTS.map(f => `<option value="${f}" ${f === currentFont ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
            <div class="prop-col" style="max-width:80px;">
              <span class="prop-input-label">Size</span>
              <input type="number" id="prop-text-size" class="input-control" value="${fontSize}">
            </div>
          </div>

          <div class="prop-row" style="margin-top:6px;">
            <div class="btn-group-toggle" style="flex:1;">
              <button class="btn-group-item ${isBold ? 'active' : ''}" id="btn-text-bold"><b>B</b></button>
              <button class="btn-group-item ${isItalic ? 'active' : ''}" id="btn-text-italic"><i>I</i></button>
              <button class="btn-group-item ${isUnderline ? 'active' : ''}" id="btn-text-underline"><u>U</u></button>
            </div>
            <div class="btn-group-toggle" style="flex:1;">
              <button class="btn-group-item ${activeObj.textAlign === 'left' ? 'active' : ''}" id="btn-align-left">⇤</button>
              <button class="btn-group-item ${activeObj.textAlign === 'center' ? 'active' : ''}" id="btn-align-center">≡</button>
              <button class="btn-group-item ${activeObj.textAlign === 'right' ? 'active' : ''}" id="btn-align-right">⇥</button>
            </div>
          </div>

          <div class="prop-row" style="margin-top:6px;">
            <div class="btn-group-toggle" style="flex:1;">
              <button class="btn-group-item" id="btn-case-upper" title="UPPERCASE">TT</button>
              <button class="btn-group-item" id="btn-case-lower" title="lowercase">tt</button>
              <button class="btn-group-item" id="btn-case-title" title="Capitalize">Tt</button>
            </div>
          </div>

          <div class="prop-row" style="margin-top:6px;">
            <div class="prop-col">
              <span class="prop-input-label">Letter Spacing</span>
              <input type="number" id="prop-text-spacing" class="input-control" value="${Math.round((activeObj.charSpacing || 0) / 10)}" min="-10" max="50">
            </div>
            <div class="prop-col">
              <span class="prop-input-label">Line Height</span>
              <input type="number" id="prop-text-lineheight" class="input-control" value="${activeObj.lineHeight || 1.2}" step="0.1" min="0.5" max="3">
            </div>
          </div>

          <div class="prop-row" style="margin-top:8px;">
            <div class="prop-col">
              <span class="prop-input-label">Text Color</span>
              <div class="color-picker-wrap">
                <input type="color" id="prop-text-color" class="color-input-bubble" value="${fillHex}">
                <input type="text" class="input-control" value="${fillHex}" readonly>
              </div>
            </div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-label" style="display:flex; justify-content:space-between; align-items:center;">
            <span>TEXT STROKE</span>
            <label style="font-size:11px; cursor:pointer;"><input type="checkbox" id="chk-stroke-enable" ${strokeWidth > 0 ? 'checked' : ''}> Enable</label>
          </div>
          <div class="prop-row">
            <div class="prop-col">
              <span class="prop-input-label">Stroke Color</span>
              <input type="color" id="prop-stroke-color" class="color-input-bubble" value="${strokeHex}">
            </div>
            <div class="prop-col">
              <span class="prop-input-label">Width (px)</span>
              <input type="number" id="prop-stroke-width" class="input-control" value="${strokeWidth}" min="0" max="40">
            </div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-label" style="display:flex; justify-content:space-between; align-items:center;">
            <span>TEXT SHADOW</span>
            <label style="font-size:11px; cursor:pointer;"><input type="checkbox" id="chk-shadow-enable" ${shadow.color ? 'checked' : ''}> Enable</label>
          </div>
          <div class="prop-row">
            <div class="prop-col">
              <span class="prop-input-label">Shadow Color</span>
              <input type="color" id="prop-shadow-color" class="color-input-bubble" value="${shadow.color || '#000000'}">
            </div>
            <div class="prop-col">
              <span class="prop-input-label">Blur</span>
              <input type="number" id="prop-shadow-blur" class="input-control" value="${shadow.blur || 0}" min="0" max="50">
            </div>
          </div>
          <div class="prop-row" style="margin-top:6px;">
            <div class="prop-col">
              <span class="prop-input-label">Offset X</span>
              <input type="number" id="prop-shadow-x" class="input-control" value="${shadow.offsetX || 0}">
            </div>
            <div class="prop-col">
              <span class="prop-input-label">Offset Y</span>
              <input type="number" id="prop-shadow-y" class="input-control" value="${shadow.offsetY || 0}">
            </div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-label">QUICK TEXT EFFECTS</div>
          <div class="prop-row" style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button class="btn-secondary" id="btn-fx-neon" style="font-size:11px;">✨ Neon Glow</button>
            <button class="btn-secondary" id="btn-fx-3d" style="font-size:11px;">🧊 3D Pop</button>
            <button class="btn-secondary" id="btn-fx-outline" style="font-size:11px;">⭕ Outline</button>
            <button class="btn-secondary" id="btn-fx-glitch" style="font-size:11px;">⚡ Retro Glitch</button>
          </div>
        </div>
      `;
    }
    // IMAGE SPECIFIC CONTROLS & FILTERS
    else if (activeObj.type === 'image') {
      const filters = activeObj.customFilters || {};
      specificControls = `
        <div class="inspector-section">
          <div class="inspector-label">IMAGE PHOTO ACTIONS</div>
          <div class="prop-row">
            <button class="btn-secondary" id="btn-img-flip-h" style="flex:1;">Flip H</button>
            <button class="btn-secondary" id="btn-img-flip-v" style="flex:1;">Flip V</button>
          </div>
          <div class="prop-row" style="margin-top:6px;">
            <button class="btn-secondary" id="btn-trigger-crop-tool" style="flex:1;">✂️ Crop Image</button>
            <button class="btn-secondary" id="btn-replace-active-img" style="flex:1;">Replace</button>
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-label">PHOTO FRAME MASKS</div>
          <div class="prop-row" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;">
            <button class="btn-secondary" id="btn-mask-circle">Circle</button>
            <button class="btn-secondary" id="btn-mask-rounded">Rounded</button>
            <button class="btn-secondary" id="btn-mask-heart">Heart</button>
            <button class="btn-secondary" id="btn-mask-star">Star</button>
            <button class="btn-secondary" id="btn-mask-hex">Hexagon</button>
            <button class="btn-secondary" id="btn-mask-remove">Reset</button>
          </div>
        </div>

        <div class="inspector-section">
          <div class="inspector-label">IMAGE FILTERS</div>
          <div class="prop-col">
            <span class="prop-input-label">Brightness</span>
            <div class="slider-row">
              <input type="range" class="slider-input" id="filter-brightness" min="-100" max="100" value="${filters.brightness || 0}">
              <span class="slider-val" id="val-brightness">${filters.brightness || 0}</span>
            </div>
          </div>
          <div class="prop-col" style="margin-top:8px;">
            <span class="prop-input-label">Contrast</span>
            <div class="slider-row">
              <input type="range" class="slider-input" id="filter-contrast" min="-100" max="100" value="${filters.contrast || 0}">
              <span class="slider-val" id="val-contrast">${filters.contrast || 0}</span>
            </div>
          </div>
          <div class="prop-col" style="margin-top:8px;">
            <span class="prop-input-label">Saturation</span>
            <div class="slider-row">
              <input type="range" class="slider-input" id="filter-saturation" min="-100" max="100" value="${filters.saturation || 0}">
              <span class="slider-val" id="val-saturation">${filters.saturation || 0}</span>
            </div>
          </div>
          <div class="prop-col" style="margin-top:8px;">
            <span class="prop-input-label">Blur</span>
            <div class="slider-row">
              <input type="range" class="slider-input" id="filter-blur" min="0" max="100" value="${filters.blur || 0}">
              <span class="slider-val" id="val-blur">${filters.blur || 0}</span>
            </div>
          </div>
          <div class="prop-row" style="margin-top:10px;">
            <button class="btn-secondary ${filters.grayscale ? 'active' : ''}" id="filter-grayscale-toggle" style="flex:1;">Grayscale</button>
            <button class="btn-secondary ${filters.sepia ? 'active' : ''}" id="filter-sepia-toggle" style="flex:1;">Sepia</button>
          </div>
        </div>
      `;
    }
    // SHAPE SPECIFIC CONTROLS
    else {
      const fillHex = typeof activeObj.fill === 'string' ? activeObj.fill : '#4f46e5';
      const strokeHex = activeObj.stroke || '#000000';
      const strokeWidth = activeObj.strokeWidth || 0;
      specificControls = `
        <div class="inspector-section">
          <div class="inspector-label">SHAPE STYLING</div>
          <div class="prop-row">
            <div class="prop-col">
              <span class="prop-input-label">Solid Fill Color</span>
              <div class="color-picker-wrap">
                <input type="color" id="prop-shape-fill" class="color-input-bubble" value="${fillHex}">
                <input type="text" class="input-control" value="${fillHex}" readonly>
              </div>
            </div>
          </div>

          <div class="prop-row" style="margin-top:8px;">
            <div class="prop-col">
              <span class="prop-input-label">Stroke Color</span>
              <input type="color" id="prop-shape-stroke" class="color-input-bubble" value="${strokeHex}">
            </div>
            <div class="prop-col">
              <span class="prop-input-label">Stroke Width</span>
              <input type="number" id="prop-shape-stroke-w" class="input-control" value="${strokeWidth}" min="0" max="40">
            </div>
          </div>
          ${activeObj.type === 'rect' ? `
            <div class="prop-row" style="margin-top:8px;">
              <div class="prop-col">
                <span class="prop-input-label">Corner Radius</span>
                <input type="number" id="prop-rect-rx" class="input-control" value="${activeObj.rx || 0}" min="0" max="100">
              </div>
            </div>
          ` : ''}
        </div>

        <div class="inspector-section">
          <div class="inspector-label">SHAPE GRADIENT FILL</div>
          <div class="gradients-grid" style="grid-template-columns: repeat(4, 1fr); gap:6px;">
            ${window.RI_DATA.GRADIENT_PRESETS.slice(0, 8).map((g, i) => `
              <div class="gradient-swatch shape-grad-swatch" data-sgrad-idx="${i}" style="height:32px; background:linear-gradient(${g.angle || 135}deg, ${g.stops.map(s => s.color).join(', ')});" title="${g.name}"></div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="inspector-section">
        <div class="inspector-label">ALIGNMENT</div>
        <div class="alignment-grid">
          <button class="btn-align" id="btn-align-left-obj" title="Align Left">⇤</button>
          <button class="btn-align" id="btn-align-center-h-obj" title="Center Horizontally">⇥⇤</button>
          <button class="btn-align" id="btn-align-right-obj" title="Align Right">⇥</button>
          <button class="btn-align" id="btn-align-top-obj" title="Align Top">⤒</button>
          <button class="btn-align" id="btn-align-center-v-obj" title="Center Vertically">↕</button>
          <button class="btn-align" id="btn-align-bottom-obj" title="Align Bottom">⤓</button>
        </div>
      </div>

      <div class="inspector-section">
        <div class="inspector-label">POSITION & TRANSFORM</div>
        <div class="prop-row">
          <div class="prop-col">
            <span class="prop-input-label">X</span>
            <input type="number" id="prop-pos-x" class="input-control" value="${posX}">
          </div>
          <div class="prop-col">
            <span class="prop-input-label">Y</span>
            <input type="number" id="prop-pos-y" class="input-control" value="${posY}">
          </div>
        </div>
        <div class="prop-row" style="margin-top:6px;">
          <div class="prop-col">
            <span class="prop-input-label">Width</span>
            <input type="number" id="prop-dim-w" class="input-control" value="${width}">
          </div>
          <div class="prop-col">
            <span class="prop-input-label">Height</span>
            <input type="number" id="prop-dim-h" class="input-control" value="${height}">
          </div>
        </div>
        <div class="prop-row" style="margin-top:6px;">
          <div class="prop-col">
            <span class="prop-input-label">Rotation (°)</span>
            <input type="number" id="prop-angle" class="input-control" value="${angle}">
          </div>
          <div class="prop-col">
            <span class="prop-input-label">Opacity (%)</span>
            <input type="number" id="prop-opacity" class="input-control" value="${opacity}" min="0" max="100">
          </div>
        </div>
      </div>

      ${specificControls}

      <div class="inspector-section">
        <div class="inspector-label">LAYER ACTIONS</div>
        <div class="prop-row">
          <button class="btn-secondary" id="btn-prop-duplicate" style="flex:1;">Duplicate</button>
          <button class="btn-secondary" id="btn-prop-delete" style="flex:1; color:var(--accent-red);">Delete</button>
        </div>
      </div>
    `;

    // Alignment Listeners
    container.querySelector('#btn-align-left-obj')?.addEventListener('click', () => this.studio.alignObject('left'));
    container.querySelector('#btn-align-center-h-obj')?.addEventListener('click', () => this.studio.alignObject('center-h'));
    container.querySelector('#btn-align-right-obj')?.addEventListener('click', () => this.studio.alignObject('right'));
    container.querySelector('#btn-align-top-obj')?.addEventListener('click', () => this.studio.alignObject('top'));
    container.querySelector('#btn-align-center-v-obj')?.addEventListener('click', () => this.studio.alignObject('center-v'));
    container.querySelector('#btn-align-bottom-obj')?.addEventListener('click', () => this.studio.alignObject('bottom'));

    // Bind common listeners
    container.querySelector('#prop-pos-x')?.addEventListener('change', (e) => {
      activeObj.set('left', parseInt(e.target.value, 10));
      this.studio.canvas.renderAll();
    });
    container.querySelector('#prop-pos-y')?.addEventListener('change', (e) => {
      activeObj.set('top', parseInt(e.target.value, 10));
      this.studio.canvas.renderAll();
    });
    container.querySelector('#prop-angle')?.addEventListener('change', (e) => {
      activeObj.set('angle', parseInt(e.target.value, 10));
      this.studio.canvas.renderAll();
    });
    container.querySelector('#prop-opacity')?.addEventListener('input', (e) => {
      activeObj.set('opacity', parseInt(e.target.value, 10) / 100);
      this.studio.canvas.renderAll();
    });
    container.querySelector('#btn-prop-duplicate')?.addEventListener('click', () => this.studio.duplicateSelected());
    container.querySelector('#btn-prop-delete')?.addEventListener('click', () => this.studio.deleteSelected());

    // Bind Text listeners
    if (activeObj.type === 'text' || activeObj.type === 'i-text') {
      container.querySelector('#prop-text-font')?.addEventListener('change', (e) => {
        activeObj.set('fontFamily', e.target.value);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-text-size')?.addEventListener('change', (e) => {
        activeObj.set('fontSize', parseInt(e.target.value, 10));
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-text-color')?.addEventListener('input', (e) => {
        activeObj.set('fill', e.target.value);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-text-spacing')?.addEventListener('input', (e) => {
        activeObj.set('charSpacing', parseInt(e.target.value, 10) * 10);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-text-lineheight')?.addEventListener('input', (e) => {
        activeObj.set('lineHeight', parseFloat(e.target.value));
        this.studio.canvas.renderAll();
      });
      // Case buttons
      container.querySelector('#btn-case-upper')?.addEventListener('click', () => {
        activeObj.set('text', activeObj.text.toUpperCase());
        this.studio.canvas.renderAll();
      });
      container.querySelector('#btn-case-lower')?.addEventListener('click', () => {
        activeObj.set('text', activeObj.text.toLowerCase());
        this.studio.canvas.renderAll();
      });
      container.querySelector('#btn-case-title')?.addEventListener('click', () => {
        activeObj.set('text', activeObj.text.replace(/\b\w/g, l => l.toUpperCase()));
        this.studio.canvas.renderAll();
      });

      container.querySelector('#btn-text-bold')?.addEventListener('click', () => {
        const isBold = activeObj.fontWeight === 'bold' || activeObj.fontWeight === '700';
        activeObj.set('fontWeight', isBold ? 'normal' : 'bold');
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-text-italic')?.addEventListener('click', () => {
        activeObj.set('fontStyle', activeObj.fontStyle === 'italic' ? 'normal' : 'italic');
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-text-underline')?.addEventListener('click', () => {
        activeObj.set('underline', !activeObj.underline);
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-align-left')?.addEventListener('click', () => {
        activeObj.set('textAlign', 'left');
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-align-center')?.addEventListener('click', () => {
        activeObj.set('textAlign', 'center');
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-align-right')?.addEventListener('click', () => {
        activeObj.set('textAlign', 'right');
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      // Stroke
      container.querySelector('#chk-stroke-enable')?.addEventListener('change', (e) => {
        activeObj.set('strokeWidth', e.target.checked ? 2 : 0);
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#prop-stroke-color')?.addEventListener('input', (e) => {
        activeObj.set('stroke', e.target.value);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-stroke-width')?.addEventListener('input', (e) => {
        activeObj.set('strokeWidth', parseInt(e.target.value, 10) || 0);
        this.studio.canvas.renderAll();
      });
      // Shadow
      container.querySelector('#chk-shadow-enable')?.addEventListener('change', (e) => {
        if (e.target.checked) {
          activeObj.set('shadow', new fabric.Shadow({ color: '#000000', blur: 10, offsetX: 3, offsetY: 3 }));
        } else {
          activeObj.set('shadow', null);
        }
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      const updateShadow = () => {
        const col = container.querySelector('#prop-shadow-color').value;
        const blur = parseInt(container.querySelector('#prop-shadow-blur').value, 10) || 0;
        const ox = parseInt(container.querySelector('#prop-shadow-x').value, 10) || 0;
        const oy = parseInt(container.querySelector('#prop-shadow-y').value, 10) || 0;
        activeObj.set('shadow', new fabric.Shadow({ color: col, blur: blur, offsetX: ox, offsetY: oy }));
        this.studio.canvas.renderAll();
      };
      container.querySelector('#prop-shadow-color')?.addEventListener('input', updateShadow);
      container.querySelector('#prop-shadow-blur')?.addEventListener('input', updateShadow);
      container.querySelector('#prop-shadow-x')?.addEventListener('input', updateShadow);
      container.querySelector('#prop-shadow-y')?.addEventListener('input', updateShadow);

      // Text Effects
      container.querySelector('#btn-fx-neon')?.addEventListener('click', () => {
        activeObj.set({
          fill: '#ffffff',
          stroke: '#ec4899',
          strokeWidth: 2,
          shadow: new fabric.Shadow({ color: '#ec4899', blur: 25, offsetX: 0, offsetY: 0 })
        });
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-fx-3d')?.addEventListener('click', () => {
        activeObj.set({
          shadow: new fabric.Shadow({ color: '#1e1b4b', blur: 0, offsetX: 6, offsetY: 6 })
        });
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-fx-outline')?.addEventListener('click', () => {
        activeObj.set({
          fill: 'transparent',
          stroke: '#0f172a',
          strokeWidth: 3
        });
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#btn-fx-glitch')?.addEventListener('click', () => {
        activeObj.set({
          fill: '#06b6d4',
          shadow: new fabric.Shadow({ color: '#ec4899', blur: 4, offsetX: -4, offsetY: 2 })
        });
        this.studio.canvas.renderAll();
        this.syncPropertiesPanel(activeObj);
      });
    }
    // Bind Image listeners
    else if (activeObj.type === 'image') {
      container.querySelector('#btn-img-flip-h')?.addEventListener('click', () => {
        activeObj.set('flipX', !activeObj.flipX);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#btn-img-flip-v')?.addEventListener('click', () => {
        activeObj.set('flipY', !activeObj.flipY);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#btn-replace-active-img')?.addEventListener('click', () => {
        this.switchTab('images');
      });
      container.querySelector('#btn-trigger-crop-tool')?.addEventListener('click', () => {
        this.openCropModal(activeObj);
      });
      // Frame masks
      container.querySelector('#btn-mask-circle')?.addEventListener('click', () => this.studio.applyFrameMask(activeObj, { type: 'circle', name: 'Circle Mask' }));
      container.querySelector('#btn-mask-rounded')?.addEventListener('click', () => this.studio.applyFrameMask(activeObj, { type: 'rounded', rx: 40, name: 'Rounded Mask' }));
      container.querySelector('#btn-mask-heart')?.addEventListener('click', () => this.studio.applyFrameMask(activeObj, { type: 'heart', path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z', name: 'Heart Mask' }));
      container.querySelector('#btn-mask-star')?.addEventListener('click', () => this.studio.applyFrameMask(activeObj, { type: 'star', name: 'Star Mask' }));
      container.querySelector('#btn-mask-hex')?.addEventListener('click', () => this.studio.applyFrameMask(activeObj, { type: 'hexagon', name: 'Hexagon Mask' }));
      container.querySelector('#btn-mask-remove')?.addEventListener('click', () => {
        activeObj.set('clipPath', null);
        this.studio.canvas.renderAll();
        this.toast('Removed photo frame mask', 'info');
      });

      // Sliders
      ['brightness', 'contrast', 'saturation', 'blur'].forEach(f => {
        const input = container.querySelector(`#filter-${f}`);
        const valSpan = container.querySelector(`#val-${f}`);
        if (input) {
          input.addEventListener('input', (e) => {
            valSpan.textContent = e.target.value;
            this.studio.applyFilter(f, parseInt(e.target.value, 10));
          });
        }
      });
      container.querySelector('#filter-grayscale-toggle')?.addEventListener('click', () => {
        const cur = activeObj.customFilters && activeObj.customFilters.grayscale;
        this.studio.applyFilter('grayscale', !cur);
        this.syncPropertiesPanel(activeObj);
      });
      container.querySelector('#filter-sepia-toggle')?.addEventListener('click', () => {
        const cur = activeObj.customFilters && activeObj.customFilters.sepia;
        this.studio.applyFilter('sepia', !cur);
        this.syncPropertiesPanel(activeObj);
      });
    }
    // Bind Shape listeners
    else {
      container.querySelector('#prop-shape-fill')?.addEventListener('input', (e) => {
        activeObj.set('fill', e.target.value);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-shape-stroke')?.addEventListener('input', (e) => {
        activeObj.set('stroke', e.target.value);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-shape-stroke-w')?.addEventListener('input', (e) => {
        activeObj.set('strokeWidth', parseInt(e.target.value, 10) || 0);
        this.studio.canvas.renderAll();
      });
      container.querySelector('#prop-rect-rx')?.addEventListener('input', (e) => {
        const r = parseInt(e.target.value, 10) || 0;
        activeObj.set({ rx: r, ry: r });
        this.studio.canvas.renderAll();
      });
      container.querySelectorAll('.shape-grad-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          const idx = parseInt(sw.dataset.sgradIdx, 10);
          const grad = window.RI_DATA.GRADIENT_PRESETS[idx];
          if (grad) {
            this.studio.applyShapeGradient(activeObj, grad);
            this.toast(`Applied ${grad.name} to shape`, 'info');
          }
        });
      });
    }
  }

  setupPropertiesListeners() {
    // Initial sync
    this.syncPropertiesPanel(null);
  }

  /**
   * BULK DESIGN STUDIO UI (THE CORE USP)
   */
  openBulkModal() {
    const modal = document.getElementById('bulk-studio-modal');
    if (modal) modal.classList.add('active');
  }

  closeBulkModal() {
    const modal = document.getElementById('bulk-studio-modal');
    if (modal) modal.classList.remove('active');
  }

  renderBulkThumbnailsGrid(imagesList) {
    const countBadge = document.getElementById('bulk-count-badge');
    const container = document.getElementById('bulk-thumbnails-grid');
    const applyBtn = document.getElementById('btn-apply-design-all');

    if (countBadge) countBadge.textContent = `${imagesList.length} / 50 Images Selected`;
    if (applyBtn) applyBtn.disabled = imagesList.length === 0;
    if (!container) return;

    if (imagesList.length === 0) {
      container.innerHTML = `
        <div style="grid-column: span 4; text-align:center; padding:24px 10px; color:var(--text-muted); font-size:12px;">
          No images uploaded yet.<br>Click dropzone above or click sample buttons!
        </div>
      `;
      return;
    }

    container.innerHTML = imagesList.map((item, idx) => `
      <div class="bulk-thumb-item ${item.selected ? 'selected' : ''}" data-bulk-idx="${idx}" title="${item.name}">
        <img src="${item.dataUrl}" alt="${item.name}">
        <div class="bulk-thumb-controls">
          <button class="bulk-thumb-btn bulk-thumb-up" data-up-idx="${idx}" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="bulk-thumb-btn bulk-thumb-down" data-dn-idx="${idx}" title="Move Down" ${idx === imagesList.length-1 ? 'disabled' : ''}>▼</button>
          <button class="bulk-thumb-btn bulk-thumb-view" data-view-idx="${idx}" title="Preview">👁</button>
          <button class="bulk-thumb-remove" data-remove-idx="${idx}" title="Remove">✕</button>
        </div>
        <div class="bulk-thumb-name">${item.name.substring(0,12)}</div>
      </div>
    `).join('');

    // Remove
    container.querySelectorAll('.bulk-thumb-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.bulkEngine.removeImage(parseInt(btn.dataset.removeIdx, 10));
      });
    });
    // Move Up
    container.querySelectorAll('.bulk-thumb-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.upIdx, 10);
        if (idx > 0) this.bulkEngine.moveImageUp(idx);
      });
    });
    // Move Down
    container.querySelectorAll('.bulk-thumb-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.dnIdx, 10);
        if (idx < imagesList.length - 1) this.bulkEngine.moveImageDown(idx);
      });
    });
    // Preview lightbox
    container.querySelectorAll('.bulk-thumb-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.viewIdx, 10);
        const item = imagesList[idx];
        if (item) this.openLightboxModal(item.dataUrl, item.name);
      });
    });
    // Select toggle
    container.querySelectorAll('.bulk-thumb-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.bulk-thumb-controls') || e.target.closest('.bulk-thumb-remove')) return;
        this.bulkEngine.toggleSelection(parseInt(item.dataset.bulkIdx, 10));
      });
    });
  }

  updateBulkProgressUI(prog) {
    const progressBox = document.getElementById('bulk-progress-box');
    const fill = document.getElementById('bulk-progress-fill');
    const text = document.getElementById('bulk-progress-text');
    const status = document.getElementById('bulk-progress-status');

    if (progressBox) progressBox.style.display = 'flex';
    if (fill) fill.style.width = `${prog.percentage}%`;
    if (text) text.textContent = `${prog.current} / ${prog.total} (${prog.percentage}%)`;
    if (status) status.textContent = prog.statusText;
  }

  renderBulkGallery(summary) {
    const galleryContainer = document.getElementById('bulk-gallery-container');
    const exportToolbar = document.getElementById('bulk-export-toolbar');
    const retryBtn = document.getElementById('btn-retry-failed');

    if (exportToolbar) exportToolbar.style.display = 'flex';
    if (retryBtn) retryBtn.style.display = summary.failed > 0 ? 'inline-flex' : 'none';

    if (!galleryContainer) return;

    if (summary.designs.length === 0) {
      galleryContainer.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">No designs generated.</div>`;
      return;
    }

    galleryContainer.innerHTML = `
      <div style="grid-column:1/-1; display:flex; align-items:center; justify-content:space-between; padding-bottom:10px; border-bottom:1px solid var(--border-light); margin-bottom:8px;">
        <span style="font-size:12px; color:var(--text-muted); font-weight:700;">${summary.designs.length} designs generated • ${summary.failed} failed</span>
        <button class="btn-secondary" id="btn-bulk-start-new" style="font-size:11px; padding:4px 10px;">+ Start New Batch</button>
      </div>
      ${summary.designs.map((d, idx) => `
        <div class="bulk-generated-card" data-bulk-design-id="${d.id}" data-bulk-card-idx="${idx}">
          <div class="bulk-card-thumb">
            <img src="${d.thumbnail}" alt="${d.title}" loading="lazy">
            <div class="bulk-card-overlay">
              <button class="bulk-overlay-btn btn-edit-bulk-card" data-edit-id="${d.id}" title="Edit in Workspace">✏️ Edit</button>
              <button class="bulk-overlay-btn btn-view-bulk-card" data-view-idx="${idx}" title="Preview">👁 View</button>
            </div>
          </div>
          <div class="bulk-card-footer">
            <div class="bulk-card-title" title="${d.title}">${d.title}</div>
            <div class="bulk-card-actions">
              <button class="btn-card-action btn-rename-bulk-card" data-rename-idx="${idx}" title="Rename">✏</button>
              <button class="btn-card-action btn-dup-bulk-card" data-dup-idx="${idx}" title="Duplicate">⧉</button>
              <button class="btn-card-action btn-dl-bulk-card" data-dl-idx="${idx}" title="Download">↓</button>
              <button class="btn-card-action btn-del-bulk-card" data-del-idx="${idx}" title="Delete" style="color:var(--accent-red);">🗑</button>
            </div>
          </div>
        </div>
      `).join('')}
    `;

    // Start New Batch
    galleryContainer.querySelector('#btn-bulk-start-new')?.addEventListener('click', () => {
      this.bulkEngine.clearAllImages();
      document.getElementById('bulk-gallery-container').innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">Upload images and apply design to generate a new batch.</div>`;
      if (exportToolbar) exportToolbar.style.display = 'none';
      this.toast('Cleared batch — ready for new uploads!', 'info');
    });

    // Edit in workspace
    galleryContainer.querySelectorAll('.btn-edit-bulk-card').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const dId = el.dataset.editId;
        const design = summary.designs.find(d => d.id === dId);
        if (design && design.canvasJSON) {
          this.closeBulkModal();
          this.studio.setDimensions(design.width, design.height, design.ppi);
          this.studio.canvas.loadFromJSON(design.canvasJSON, () => {
            this.studio.canvas.renderAll();
            this.studio.activeDesignId = design.id;
            this.studio.activeDesignTitle = design.title;
            document.getElementById('header-design-title').value = design.title;
            this.toast(`Editing "${design.title}" in Workspace`, 'success');
          });
        }
      });
    });

    // View/lightbox
    galleryContainer.querySelectorAll('.btn-view-bulk-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.viewIdx, 10);
        const d = summary.designs[idx];
        if (d) this.openLightboxModal(d.thumbnail, d.title);
      });
    });

    // Rename
    galleryContainer.querySelectorAll('.btn-rename-bulk-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.renameIdx, 10);
        const d = summary.designs[idx];
        this.openRenameModal(d.title, (newTitle) => {
          d.title = newTitle;
          const titleEl = btn.closest('.bulk-generated-card').querySelector('.bulk-card-title');
          if (titleEl) titleEl.textContent = newTitle;
          this.toast(`Renamed to "${newTitle}"`, 'success');
        });
      });
    });

    // Duplicate
    galleryContainer.querySelectorAll('.btn-dup-bulk-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.dupIdx, 10);
        const d = summary.designs[idx];
        const copy = { ...d, id: `${d.id}_copy_${Date.now()}`, title: `${d.title} (Copy)` };
        summary.designs.push(copy);
        this.renderBulkGallery(summary);
        this.toast(`Duplicated "${d.title}"`, 'success');
      });
    });

    // Delete
    galleryContainer.querySelectorAll('.btn-del-bulk-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.delIdx, 10);
        summary.designs.splice(idx, 1);
        this.renderBulkGallery(summary);
        this.toast('Design removed from batch', 'info');
      });
    });

    // Single export
    galleryContainer.querySelectorAll('.btn-dl-bulk-card').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.dlIdx, 10);
        const design = summary.designs[idx];
        const dataUrl = await this.bulkEngine._renderDesignToDataURL(design, 'png', 1);
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${design.title.replace(/[^a-z0-9_-]/gi, '_')}.png`;
        a.click();
        this.toast(`Downloaded "${design.title}"`, 'success');
      });
    });
  }

  /**
   * Statusbar UI Updates
   */
  updateStatusbar() {
    const dimEl = document.getElementById('status-canvas-dim');
    const ppiEl = document.getElementById('status-canvas-ppi');
    if (dimEl) dimEl.textContent = `${this.studio.width} × ${this.studio.height} px`;
    if (ppiEl) ppiEl.textContent = `${this.studio.currentPPI} DPI`;
  }

  updateZoomUI(zoom) {
    const zoomValEl = document.getElementById('status-zoom-val');
    if (zoomValEl) zoomValEl.textContent = `${Math.round(zoom * 100)}%`;
  }

  /**
   * Modals (New Design, Preview, Export, Shortcuts)
   */
  openNewDesignModal() {
    const modal = document.getElementById('modal-new-design');
    if (modal) modal.classList.add('active');

    const grid = document.getElementById('new-design-presets-grid');
    if (grid) {
      grid.innerHTML = window.RI_DATA.CANVAS_PRESETS.map(p => `
        <div class="preset-size-card" data-w="${p.width}" data-h="${p.height}" data-ppi="${p.ppi || 72}" data-title="${p.name}">
          <div class="preset-size-name">${p.name}</div>
          <div class="preset-size-dim">${p.width} × ${p.height} px • ${p.category}</div>
        </div>
      `).join('');

      grid.querySelectorAll('.preset-size-card').forEach(card => {
        card.addEventListener('click', () => {
          grid.querySelectorAll('.preset-size-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          document.getElementById('custom-canvas-w').value = card.dataset.w;
          document.getElementById('custom-canvas-h').value = card.dataset.h;
          document.getElementById('custom-canvas-ppi').value = card.dataset.ppi;
          this._syncUnitFields();
        });
      });
    }

    // Unit converter logic
    this._syncUnitFields = () => {
      const ppi = parseInt(document.getElementById('custom-canvas-ppi')?.value || 72, 10);
      const wPx = parseFloat(document.getElementById('custom-canvas-w')?.value || 1080);
      const hPx = parseFloat(document.getElementById('custom-canvas-h')?.value || 1080);
      const unit = document.getElementById('canvas-unit-select')?.value || 'px';
      const factor = { px: 1, in: ppi, mm: ppi / 25.4, cm: ppi / 2.54 }[unit];
      const wEl = document.getElementById('canvas-unit-w');
      const hEl = document.getElementById('canvas-unit-h');
      if (wEl) wEl.value = (wPx / factor).toFixed(2);
      if (hEl) hEl.value = (hPx / factor).toFixed(2);
    };
    document.getElementById('canvas-unit-select')?.addEventListener('change', () => this._syncUnitFields());
    document.getElementById('custom-canvas-ppi')?.addEventListener('change', () => this._syncUnitFields());
    document.getElementById('canvas-unit-w')?.addEventListener('change', (e) => {
      const ppi = parseInt(document.getElementById('custom-canvas-ppi')?.value || 72, 10);
      const unit = document.getElementById('canvas-unit-select')?.value || 'px';
      const factor = { px: 1, in: ppi, mm: ppi / 25.4, cm: ppi / 2.54 }[unit];
      const px = Math.round(parseFloat(e.target.value) * factor);
      document.getElementById('custom-canvas-w').value = px;
    });
    document.getElementById('canvas-unit-h')?.addEventListener('change', (e) => {
      const ppi = parseInt(document.getElementById('custom-canvas-ppi')?.value || 72, 10);
      const unit = document.getElementById('canvas-unit-select')?.value || 'px';
      const factor = { px: 1, in: ppi, mm: ppi / 25.4, cm: ppi / 2.54 }[unit];
      const px = Math.round(parseFloat(e.target.value) * factor);
      document.getElementById('custom-canvas-h').value = px;
    });
    this._syncUnitFields();

    document.getElementById('btn-close-new-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btn-create-canvas-submit')?.addEventListener('click', () => {
      const w = parseInt(document.getElementById('custom-canvas-w').value, 10) || 1080;
      const h = parseInt(document.getElementById('custom-canvas-h').value, 10) || 1080;
      const ppi = parseInt(document.getElementById('custom-canvas-ppi').value, 10) || 72;
      this.studio.setDimensions(w, h, ppi);
      this.studio.canvas.clear();
      this.studio.setBackground({ type: 'solid', color: '#ffffff' });
      this.updateStatusbar();
      modal.classList.remove('active');
      this.toast(`Created new design (${w}×${h} px @ ${ppi} PPI)`, 'success');
    });
  }

  openPreviewModal() {
    const modal = document.getElementById('modal-fullscreen-preview');
    const img = document.getElementById('preview-modal-img');
    if (!modal || !img) return;

    const data = this.studio.exportImage({ format: 'png', quality: 1, multiplier: 1 });
    img.src = data.dataURL;
    modal.classList.add('active');

    document.getElementById('btn-close-preview-modal')?.addEventListener('click', () => modal.classList.remove('active'));
  }

  openExportModal() {
    const modal = document.getElementById('modal-export');
    if (!modal) return;
    modal.classList.add('active');

    document.getElementById('btn-close-export-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btn-confirm-export')?.addEventListener('click', async () => {
      const format = document.getElementById('export-format-select').value;
      const ppi = parseInt(document.getElementById('export-ppi-select').value, 10);
      const filename = (this.studio.activeDesignTitle || 'RI-Creative-Design').replace(/[^a-z0-9_-]/gi, '_');

      if (format === 'pdf') {
        this.toast('Generating High-Resolution PDF...', 'info');
        const pdf = await this.studio.exportPDF({ ppi: ppi });
        pdf.save(`${filename}.pdf`);
        this.toast('PDF Exported Successfully!', 'success');
      } else {
        this.toast(`Rendering ${ppi} PPI ${format.toUpperCase()} export...`, 'info');
        const result = this.studio.exportImage({ format: format, ppi: ppi, quality: 0.98 });
        const a = document.createElement('a');
        a.href = result.dataURL;
        a.download = `${filename}_${result.width}x${result.height}.${format}`;
        a.click();
        this.toast(`Exported ${format.toUpperCase()} (${result.width}×${result.height}px)`, 'success');
      }

      modal.classList.remove('active');
    });
  }

  openShortcutsModal() {
    const modal = document.getElementById('modal-shortcuts');
    if (modal) {
      modal.classList.add('active');
      document.getElementById('btn-close-shortcuts-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    }
  }

  /**
   * Profile & Workspace Settings Modal
   */
  openProfileModal() {
    const modal = document.getElementById('modal-profile');
    if (!modal) return;
    modal.classList.add('active');

    // Theme Buttons
    const lightBtn = document.getElementById('btn-theme-light');
    const darkBtn  = document.getElementById('btn-theme-dark');
    const isDark = document.body.classList.contains('dark-mode');
    lightBtn?.classList.toggle('active', !isDark);
    darkBtn?.classList.toggle('active', isDark);

    lightBtn?.addEventListener('click', () => {
      document.body.classList.remove('dark-mode');
      lightBtn.classList.add('active');
      darkBtn?.classList.remove('active');
      try { window.RI_STORAGE.saveSetting('theme', 'light'); } catch(e) {}
      this.toast('Switched to Light Professional mode', 'info');
    });
    darkBtn?.addEventListener('click', () => {
      document.body.classList.add('dark-mode');
      darkBtn.classList.add('active');
      lightBtn?.classList.remove('active');
      try { window.RI_STORAGE.saveSetting('theme', 'dark'); } catch(e) {}
      this.toast('Switched to Midnight Dark mode', 'info');
    });

    document.getElementById('btn-close-profile-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btn-save-profile-prefs')?.addEventListener('click', () => {
      const fmt = document.getElementById('pref-export-format')?.value;
      const ppi = document.getElementById('pref-default-ppi')?.value;
      if (fmt) try { window.RI_STORAGE.saveSetting('defaultFormat', fmt); } catch(e) {}
      if (ppi) { this.studio.currentPPI = parseInt(ppi, 10); this.updateStatusbar(); }
      modal.classList.remove('active');
      this.toast('Preferences saved!', 'success');
    });
  }

  /**
   * Crop Image Modal
   */
  openCropModal(imgObj) {
    const modal = document.getElementById('modal-crop');
    const cropImg = document.getElementById('crop-target-img');
    if (!modal || !cropImg || !imgObj) return;

    this._cropObj = imgObj;
    this._cropArea = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }; // default center 80%

    // Set the source image for preview
    try {
      const src = imgObj.getSrc ? imgObj.getSrc() : (imgObj._element && imgObj._element.src);
      if (src) cropImg.src = src;
    } catch(e) {
      cropImg.src = '';
    }

    modal.classList.add('active');

    document.getElementById('btn-close-crop-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btn-crop-square')?.addEventListener('click', () => {
      this._cropArea = { x: 0.1, y: 0.1, w: 0.8, h: 0.8, aspectRatio: 1 };
      this.toast('Aspect ratio: 1:1', 'info');
    });
    document.getElementById('btn-crop-16-9')?.addEventListener('click', () => {
      this._cropArea = { x: 0, y: 0.17, w: 1, h: 0.66, aspectRatio: 16/9 };
      this.toast('Aspect ratio: 16:9', 'info');
    });
    document.getElementById('btn-crop-4-5')?.addEventListener('click', () => {
      this._cropArea = { x: 0.1, y: 0, w: 0.8, h: 1, aspectRatio: 4/5 };
      this.toast('Aspect ratio: 4:5', 'info');
    });
    document.getElementById('btn-crop-free')?.addEventListener('click', () => {
      this._cropArea = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      this.toast('Center 80% crop area', 'info');
    });
    document.getElementById('btn-apply-crop-confirm')?.addEventListener('click', () => {
      if (this._cropObj && this.studio) {
        try {
          this.studio.cropImage(this._cropObj, this._cropArea);
          this.toast('Crop applied!', 'success');
        } catch(err) {
          this.toast('Crop could not be applied: ' + err.message, 'error');
        }
      }
      modal.classList.remove('active');
    });
  }

  /**
   * Image Lightbox Modal
   */
  openLightboxModal(src, title) {
    const modal = document.getElementById('modal-image-lightbox');
    const img   = document.getElementById('lightbox-preview-img');
    const titleEl = document.getElementById('lightbox-title');
    if (!modal) return;
    if (img) img.src = src || '';
    if (titleEl) titleEl.textContent = title || 'Image Preview';
    modal.classList.add('active');
    document.getElementById('btn-close-lightbox-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    // Click backdrop to close
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); }, { once: true });
  }

  /**
   * Rename Modal
   */
  openRenameModal(currentTitle, onConfirm) {
    const modal = document.getElementById('modal-rename');
    const input = document.getElementById('rename-input-title');
    if (!modal || !input) return;
    input.value = currentTitle || '';
    this._renameCallback = onConfirm;
    modal.classList.add('active');
    setTimeout(() => input.focus(), 100);

    document.getElementById('btn-close-rename-modal')?.addEventListener('click', () => modal.classList.remove('active'));
    const confirmBtn = document.getElementById('btn-confirm-rename-submit');
    const handler = () => {
      const newTitle = input.value.trim();
      if (newTitle && this._renameCallback) this._renameCallback(newTitle);
      modal.classList.remove('active');
      confirmBtn?.removeEventListener('click', handler);
    };
    confirmBtn?.addEventListener('click', handler);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); }, { once: true });
  }

  /**
   * Keyboard Shortcuts
   */
  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Avoid shortcuts if typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.studio.redo();
        else this.studio.undo();
      } else if (isCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.studio.redo();
      } else if (isCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveCurrentDesign();
      } else if (isCtrl && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.studio.copy();
        this.toast('Copied object', 'info');
      } else if (isCtrl && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.studio.paste();
      } else if (isCtrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.studio.duplicateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // If not editing text in Fabric
        const active = this.studio.canvas.getActiveObject();
        if (active && !active.isEditing) {
          e.preventDefault();
          this.studio.deleteSelected();
        }
      } else if (isCtrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.studio.canvas.discardActiveObject();
        const sel = new fabric.ActiveSelection(this.studio.canvas.getObjects(), { canvas: this.studio.canvas });
        this.studio.canvas.setActiveObject(sel);
        this.studio.canvas.renderAll();
      } else if (e.key === 'Escape') {
        this.studio.canvas.discardActiveObject();
        this.studio.canvas.renderAll();
        document.querySelectorAll('.modal-backdrop, .bulk-studio-overlay').forEach(m => m.classList.remove('active'));
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const active = this.studio.canvas.getActiveObject();
        if (active && !active.isEditing) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowUp') active.top -= step;
          if (e.key === 'ArrowDown') active.top += step;
          if (e.key === 'ArrowLeft') active.left -= step;
          if (e.key === 'ArrowRight') active.left += step;
          active.setCoords();
          this.studio.canvas.renderAll();
        }
      }
    });
  }

  /**
   * Non-intrusive Toast Notifications
   */
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type}`;
    toastEl.innerHTML = `<span>${message}</span>`;
    container.appendChild(toastEl);

    setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(10px)';
      setTimeout(() => toastEl.remove(), 250);
    }, 3200);
  }
}

// Instantiate and launch on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.RI_APP = new RICreativeApp();
  window.RI_APP.init();
});
