(() => {
  'use strict';

  const VERSION = '0.14.5';
  const BOARD_W = 5000;
  const BOARD_H = 3200;
  const PAGE_ORIGIN = { x: 140, y: 170 };
  const PAGE_PRESETS = {
    free: null,
    'a4-portrait': { label: 'A4 Portrait', shortLabel: 'A4 · Portrait', w: 1240, h: 1754 },
    'a4-landscape': { label: 'A4 Landscape', shortLabel: 'A4 · Landscape', w: 1754, h: 1240 },
    '16x9': { label: '16:9', shortLabel: '16:9', w: 1920, h: 1080 },
  };
  const MAX_HISTORY = 80;
  const UI_FONT = 'Futura, "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const MAX_OBJECTS = 2000;
  const MAX_TEXT_LENGTH = 12000;
  const FILE_APP_ID = 'silt';
  const FILE_FORMAT_VERSION = 1;
  const AUTOSAVE_DELAY_MS = 5000;
  const AUTOSAVE_BUSY_RETRY_MS = 2500;
  const MAX_EMBEDDED_IMAGE_EDGE = 2200;
  const MAX_EMBEDDED_IMAGE_PIXELS = 3600000;
  const MAX_UNOPTIMIZED_IMAGE_BYTES = 4 * 1024 * 1024;
  const LARGE_BOARD_WARNING_BYTES = 24 * 1024 * 1024;
  const AUTOSAVE_DB_NAME = 'SiltLocalRecovery';
  const AUTOSAVE_DB_VERSION = 1;
  const AUTOSAVE_STORE = 'autosaves';
  const AUTOSAVE_KEY = 'latest';
  const AUTOSAVE_DISMISS_PREFIX = 'silt.autosave.dismissed.';

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const workspace = document.getElementById('workspace');
  const zoomLabel = document.getElementById('zoomLabel');
  const statusText = document.getElementById('statusText');
  const toast = document.getElementById('toast');
  const imageInput = document.getElementById('imageInput');
  const projectInput = document.getElementById('projectInput');
  const textEditor = document.getElementById('textEditor');
  const backgroundSelect = document.getElementById('backgroundSelect');
  const pagePresetSelect = document.getElementById('pagePresetSelect');
  const strokeColorInput = document.getElementById('strokeColor');
  const strokeWidthInput = document.getElementById('strokeWidth');
  const strokeWidthLabel = document.getElementById('strokeWidthLabel');
  const strokeStyleSelect = document.getElementById('strokeStyle');
  const fillColorInput = document.getElementById('fillColor');
  const fillNoneInput = document.getElementById('fillNone');
  const fontSizeInput = document.getElementById('fontSize');
  const fontSizeLabel = document.getElementById('fontSizeLabel');
  const objectOpacityInput = document.getElementById('objectOpacity');
  const objectOpacityLabel = document.getElementById('objectOpacityLabel');
  const styleTitle = document.getElementById('styleTitle');
  const styleHint = document.getElementById('styleHint');
  const strokeLabel = document.getElementById('strokeLabel');
  const stylePopover = document.getElementById('stylePopover');
  const styleToggleBtn = document.getElementById('styleToggleBtn');
  const dirtyDot = document.getElementById('dirtyDot');
  const autosaveStatus = document.getElementById('autosaveStatus');
  const snapToggle = document.getElementById('snapToggle');
  const projectTitleInput = document.getElementById('projectTitleInput');
  const exportSelect = document.getElementById('exportSelect');
  const pwaHelpBtn = document.getElementById('pwaHelpBtn');
  const pwaPanel = document.getElementById('pwaPanel');
  const pwaUpdateBtn = document.getElementById('pwaUpdateBtn');
  const closePwaPanelBtn = document.getElementById('closePwaPanelBtn');
  const topbar = document.querySelector('.topbar');
  const arrangeBtn = document.getElementById('arrangeBtn');
  const arrangeMenu = document.getElementById('arrangeMenu');

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

  function isStandalonePWA() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
  }

  const state = {
    tool: 'select',
    objects: [],
    selectedId: null,
    selectedIds: [],
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isSpaceDown: false,
    drag: null,
    temp: null,
    lasso: null,
    guides: [],
    exportArea: null,
    exportAreaLast: null,
    imageCache: new Map(),
    dirty: false,
    history: [],
    future: [],
    editing: null,
    metadata: { boardId: uid(), title: 'Untitled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), authors: [] },
    appearance: { background: 'dots', pagePreset: 'free', snapEnabled: true },
    style: { strokeColor: '#2f3437', strokeWidth: 5, strokeStyle: 'solid', fillColor: '#fff1a8', fillEnabled: true, frameFill: 'rgba(255,241,168,0.16)', fontSize: 26, opacity: 1 },
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const safeString = (value, max = MAX_TEXT_LENGTH) => String(value ?? '').slice(0, max);
  const deepClone = value => JSON.parse(JSON.stringify(value));

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
    positionActiveEditor();
  }

  function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - state.offsetX) / state.scale,
      y: (sy - rect.top - state.offsetY) / state.scale,
    };
  }

  function worldToScreen(x, y) {
    return { x: x * state.scale + state.offsetX, y: y * state.scale + state.offsetY };
  }

  function safeSetPointerCapture(e) {
    try {
      if (e && Number.isFinite(Number(e.pointerId)) && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    } catch (_) {
      // Safari/WKWebView can reject pointer capture in some states. Selection must still work without it.
    }
  }

  function safeReleasePointerCapture(e) {
    try {
      if (e && Number.isFinite(Number(e.pointerId)) && canvas.releasePointerCapture) canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  function setTool(tool) {
    finishTextEditing(true);
    state.tool = tool;
    state.temp = null;
    state.guides = [];
    state.lasso = null;
    state.drag = null;
    document.querySelectorAll('.tool').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    canvas.style.cursor = tool === 'select' ? 'default' : (tool === 'pan' ? 'grab' : 'crosshair');
    setStatus(`Tool: ${tool}`);
    updateStylePanel();
    draw();
  }

  function objectById(id, objects = state.objects) {
    if (!id) return null;
    for (const obj of objects || []) {
      if (obj.id === id) return obj;
      if (obj.type === 'group' && Array.isArray(obj.children)) {
        const child = objectById(id, obj.children);
        if (child) return child;
      }
    }
    return null;
  }

  function selectedIds() {
    const valid = (state.selectedIds || []).filter(id => objectById(id));
    if (state.selectedId && objectById(state.selectedId) && !valid.includes(state.selectedId)) valid.push(state.selectedId);
    state.selectedIds = [...new Set(valid)];
    state.selectedId = state.selectedIds[0] || null;
    return state.selectedIds;
  }

  function selectedObjects() {
    return selectedIds().map(id => objectById(id)).filter(Boolean);
  }

  function selectedObject() {
    const ids = selectedIds();
    return ids.length === 1 ? objectById(ids[0]) : null;
  }

  function setSelection(ids) {
    state.selectedIds = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(id => objectById(id)))];
    state.selectedId = state.selectedIds[0] || null;
    updateUI();
  }

  function clearSelection() {
    state.selectedIds = [];
    state.selectedId = null;
  }

  function toggleSelection(id) {
    if (!id || !objectById(id)) return;
    const ids = selectedIds();
    if (ids.includes(id)) setSelection(ids.filter(existing => existing !== id));
    else setSelection([...ids, id]);
  }

  function hasMultiSelection() { return selectedIds().length > 1; }

  function isLocked(obj) { return Boolean(obj?.locked); }

  function isNativeWrapper() {
    return Boolean(window.webkit?.messageHandlers?.siltAction);
  }

  function requestNativeAction(action) {
    try {
      window.webkit.messageHandlers.siltAction.postMessage(action);
      return true;
    } catch (_) {
      return false;
    }
  }

  function notifyDirty() {
    try {
      window.webkit?.messageHandlers?.siltDirty?.postMessage(Boolean(state.dirty));
    } catch (_) { /* browser fallback */ }
  }

  function markDirty() {
    state.dirty = true;
    document.body.classList.add('dirty');
    notifyDirty();
    scheduleAutosave();
    updateUI();
  }

  function setClean() {
    state.dirty = false;
    document.body.classList.remove('dirty');
    notifyDirty();
    updateUI();
  }

  function updateAutosaveStatus(message, cls = 'ready') {
    if (!autosaveStatus) return;
    autosaveStatus.textContent = message;
    autosaveStatus.classList.remove('ready', 'warn', 'error');
    if (cls) autosaveStatus.classList.add(cls);
  }

  let autosaveTimer = null;
  let autosaveInFlight = false;
  let autosavePending = false;
  let autosaveLastSavedAt = '';

  function openAutosaveDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = indexedDB.open(AUTOSAVE_DB_NAME, AUTOSAVE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) db.createObjectStore(AUTOSAVE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open autosave database'));
    });
  }

  async function autosavePut(record) {
    const db = await openAutosaveDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
      tx.objectStore(AUTOSAVE_STORE).put(record, AUTOSAVE_KEY);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Autosave write failed')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Autosave write aborted')); };
    });
  }

  async function autosaveGet() {
    const db = await openAutosaveDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readonly');
      const req = tx.objectStore(AUTOSAVE_STORE).get(AUTOSAVE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Autosave read failed'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Autosave transaction failed')); };
    });
  }

  async function autosaveDelete() {
    const db = await openAutosaveDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
      tx.objectStore(AUTOSAVE_STORE).delete(AUTOSAVE_KEY);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Autosave delete failed')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Autosave delete aborted')); };
    });
  }

  function scheduleAutosave(delay = AUTOSAVE_DELAY_MS) {
    if (!state.dirty) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => writeAutosaveNow('auto'), delay);
  }

  async function writeAutosaveNow(reason = 'auto') {
    if (!state.dirty && reason === 'auto') return;
    if (state.drag || state.editing || state.exportArea?.active) {
      scheduleAutosave(AUTOSAVE_BUSY_RETRY_MS);
      return;
    }
    if (autosaveInFlight) {
      autosavePending = true;
      return;
    }
    autosaveInFlight = true;
    try {
      const payload = serializeProject();
      const savedAt = new Date().toISOString();
      await autosavePut({
        app: FILE_APP_ID,
        kind: 'local-recovery-autosave',
        savedAt,
        reason,
        title: normalizeProjectTitle(payload.metadata?.title || 'Untitled'),
        objectCount: Array.isArray(payload.objects) ? payload.objects.length : 0,
        payload,
      });
      autosaveLastSavedAt = savedAt;
      const t = new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      updateAutosaveStatus(`Autosaved ${t}`, 'ready');
    } catch (err) {
      updateAutosaveStatus('Autosave failed', 'error');
    } finally {
      autosaveInFlight = false;
      if (autosavePending) {
        autosavePending = false;
        scheduleAutosave(AUTOSAVE_BUSY_RETRY_MS);
      }
    }
  }

  function dismissKeyForAutosave(record) {
    return `${AUTOSAVE_DISMISS_PREFIX}${record?.savedAt || ''}`;
  }

  async function maybeRestoreAutosaveAfterLaunch() {
    try {
      const record = await autosaveGet();
      if (!record?.payload || !record.savedAt) {
        updateAutosaveStatus('Autosave ready', 'ready');
        return;
      }
      if (localStorage.getItem(dismissKeyForAutosave(record)) === '1') {
        updateAutosaveStatus('Autosave ready', 'ready');
        return;
      }
      const title = record.title || 'Untitled';
      const when = new Date(record.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      const count = Number.isFinite(Number(record.objectCount)) ? ` · ${record.objectCount} item${Number(record.objectCount) === 1 ? '' : 's'}` : '';
      const restore = confirm(`Restore local autosave?\n\n${title}\n${when}${count}\n\nCancel keeps the current board and will not ask again for this autosave.`);
      if (restore) {
        loadProjectPayload(record.payload, {
          markClean: false,
          toastMessage: 'Restored local autosave',
          onLoaded: () => updateAutosaveStatus('Autosave restored', 'ready'),
        });
      } else {
        localStorage.setItem(dismissKeyForAutosave(record), '1');
        updateAutosaveStatus('Autosave ready', 'ready');
      }
    } catch (_) {
      updateAutosaveStatus('Autosave unavailable', 'warn');
    }
  }


  function setStatus(message) {
    const ids = selectedIds();
    const selected = selectedObject();
    const selection = ids.length > 1 ? ` · ${ids.length} selected` : (selected ? ` · selected ${selected.type}${isLocked(selected) ? ' locked' : ''}` : '');
    statusText.textContent = `${message}${selection} · ${activeCanvasLabel()} · ${state.objects.length} item${state.objects.length === 1 ? '' : 's'}`;
  }

  function updateStandaloneClass() {
    document.body.classList.toggle('is-standalone', Boolean(isStandalonePWA()));
  }

  function togglePWAPanel(force) {
    if (!pwaPanel) return;
    const open = typeof force === 'boolean' ? force : pwaPanel.style.display === 'none';
    pwaPanel.style.display = open ? 'block' : 'none';
  }

  function syncTopbarHeight() {
    if (!topbar) return;
    const h = Math.max(48, Math.ceil(topbar.getBoundingClientRect().height || topbar.offsetHeight || 48));
    document.documentElement.style.setProperty('--silt-measured-topbar-h', `${h}px`);
  }

  function enforceTopbarVisibility() {
    const ids = ['mainMenuBtn', 'newBtn', 'openBtn', 'addImagesLabel', 'saveBtn', 'fitBtn', 'printBtn', 'pwaHelpBtn', 'pwaUpdateBtn', 'arrangeBtn'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      if (['newBtn', 'openBtn', 'addImagesLabel', 'saveBtn', 'fitBtn', 'printBtn', 'pwaHelpBtn', 'pwaUpdateBtn', 'arrangeBtn'].includes(id) && !el.hidden) {
        el.style.display = 'inline-flex';
      }
    }
    syncTopbarHeight();
    positionArrangeMenu();
  }

  function positionArrangeMenu() {
    if (!arrangeBtn || !arrangeMenu || arrangeMenu.hidden) return;
    const r = arrangeBtn.getBoundingClientRect();
    const margin = 8;
    const menuW = Math.min(320, window.innerWidth - margin * 2);
    arrangeMenu.style.minWidth = `${Math.min(210, menuW)}px`;
    const left = Math.min(Math.max(margin, r.left), window.innerWidth - menuW - margin);
    const top = Math.min(window.innerHeight - 120, r.bottom + 6);
    arrangeMenu.style.left = `${left}px`;
    arrangeMenu.style.top = `${top}px`;
  }

  function toggleArrangeMenu(force) {
    if (!arrangeMenu || !arrangeBtn) return;
    const open = typeof force === 'boolean' ? force : arrangeMenu.hidden;
    arrangeMenu.hidden = !open;
    arrangeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      positionArrangeMenu();
      showToast(selectedIds().length ? 'Arrange' : 'Select item(s) first');
    }
  }

  let toastTimer = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1550);
  }

  function makeSnapshot() {
    return {
      objects: deepClone(state.objects),
      selectedId: state.selectedId,
      selectedIds: deepClone(selectedIds()),
      view: { scale: state.scale, offsetX: state.offsetX, offsetY: state.offsetY },
      appearance: deepClone(state.appearance),
      metadata: deepClone(state.metadata),
    };
  }

  function restoreSnapshot(snapshot, dirty = true) {
    if (!snapshot) return;
    state.objects = sanitizeObjects(snapshot.objects || []);
    state.selectedIds = Array.isArray(snapshot.selectedIds) ? snapshot.selectedIds.filter(id => state.objects.some(o => o.id === id)) : (snapshot.selectedId ? [snapshot.selectedId] : []);
    state.selectedId = state.selectedIds[0] || null;
    if (snapshot.view) {
      state.scale = clamp(finite(snapshot.view.scale, state.scale), 0.08, 4);
      state.offsetX = finite(snapshot.view.offsetX, state.offsetX);
      state.offsetY = finite(snapshot.view.offsetY, state.offsetY);
    }
    if (snapshot.metadata) {
      state.metadata = sanitizeMetadata(snapshot.metadata);
      updateProjectTitleInput();
    }
    if (snapshot.appearance) {
      state.appearance = sanitizeAppearance(snapshot.appearance);
      syncControlsFromState();
    }
    state.temp = null;
    state.lasso = null;
    state.drag = null;
    finishTextEditing(false);
    state.imageCache.clear();
    ensureImageCache(() => {
      state.dirty = dirty;
      document.body.classList.toggle('dirty', Boolean(state.dirty));
      notifyDirty();
      updateUI();
      draw();
    });
  }

  function pushHistory(snapshot) {
    if (!snapshot) return;
    state.history.push(snapshot);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
    updateUI();
  }

  function undo() {
    finishTextEditing(true);
    const previous = state.history.pop();
    if (!previous) return;
    state.future.push(makeSnapshot());
    restoreSnapshot(previous, true);
    showToast('Undo');
  }

  function redo() {
    finishTextEditing(true);
    const next = state.future.pop();
    if (!next) return;
    state.history.push(makeSnapshot());
    restoreSnapshot(next, true);
    showToast('Redo');
  }

  function updateUI() {
    document.body.classList.toggle('dirty', Boolean(state.dirty));
    document.getElementById('undoBtn').disabled = state.history.length === 0;
    document.getElementById('redoBtn').disabled = state.future.length === 0;
    const count = selectedIds().length;
    const hasSelection = count > 0;
    for (const id of ['duplicateBtn', 'bringFrontBtn', 'sendBackBtn', 'deleteBtn']) {
      document.getElementById(id).disabled = !hasSelection;
    }
    for (const id of ['rotateLeftBtn', 'rotateRightBtn']) {
      document.getElementById(id).disabled = count !== 1 || !['image', 'text'].includes(selectedObject()?.type) || isLocked(selectedObject());
    }
    if (arrangeBtn) arrangeBtn.title = hasSelection ? 'Arrange selected item(s)' : 'Arrange actions · select item(s) first';
    zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
    updateStylePanel();
    setStatus(state.dirty ? 'Unsaved changes' : 'Saved');
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawBackground(ctx, rect.width, rect.height);

    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);
    drawBoardSurface(ctx, { x: 0, y: 0, w: BOARD_W, h: BOARD_H });

    // Draw connectors first so linked items remain visually dominant.
    for (const obj of state.objects.filter(o => o.type === 'connector')) drawObject(ctx, obj);
    if (state.temp?.type === 'connector') drawObject(ctx, state.temp, true);
    for (const obj of state.objects.filter(o => o.type !== 'connector')) drawObject(ctx, obj);
    if (state.temp && state.temp.type !== 'connector') drawObject(ctx, state.temp, true);

    drawLockedObjectBadges(ctx);
    drawGuides(ctx);
    drawSelectionState(ctx);
    drawLasso(ctx);
    drawExportArea(ctx);

    ctx.restore();
    zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  }

  function drawBackground(c, w, h) {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    if (state.appearance.background === 'dots') drawScreenDots(c, w, h);
    else if (state.appearance.background === 'grid') drawScreenGrid(c, w, h);
  }

  function drawScreenDots(c, w, h) {
    c.save();
    const step = 22;
    const scaled = Math.max(8, step * state.scale);
    const radius = state.scale < 0.32 ? 0.8 : 1.05;
    const startX = ((state.offsetX % scaled) + scaled) % scaled;
    const startY = ((state.offsetY % scaled) + scaled) % scaled;
    c.fillStyle = '#dfe1e7';
    for (let x = startX; x <= w; x += scaled) {
      for (let y = startY; y <= h; y += scaled) {
        c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }

  function drawScreenGrid(c, w, h) {
    c.save();
    const step = 48;
    const scaled = Math.max(10, step * state.scale);
    const startX = ((state.offsetX % scaled) + scaled) % scaled;
    const startY = ((state.offsetY % scaled) + scaled) % scaled;
    c.strokeStyle = '#eef0f4';
    c.lineWidth = 1;
    for (let x = startX; x <= w; x += scaled) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = startY; y <= h; y += scaled) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.restore();
  }

  function activePageRect() {
    const preset = PAGE_PRESETS[state.appearance.pagePreset || 'free'];
    if (!preset) return null;
    return { x: PAGE_ORIGIN.x, y: PAGE_ORIGIN.y, w: preset.w, h: preset.h, label: preset.shortLabel || preset.label };
  }

  function isRestrictedCanvas() { return Boolean(activePageRect()); }

  function clampPointToActivePage(point) {
    const page = activePageRect();
    if (!page) return point;
    return { x: clamp(point.x, page.x, page.x + page.w), y: clamp(point.y, page.y, page.y + page.h) };
  }

  function clampObjectToActivePage(obj) {
    const page = activePageRect();
    if (!page || !obj) return obj;
    if (obj.type === 'image' || obj.type === 'text' || obj.type === 'frame' || obj.type === 'group') {
      const before = boundsOf(obj) || { x: finite(obj.x, page.x), y: finite(obj.y, page.y), w: finite(obj.w, 40), h: finite(obj.h, 40) };
      obj.w = Math.min(Math.max(40, finite(obj.w, 40)), page.w);
      obj.h = Math.min(Math.max(40, finite(obj.h, 40)), page.h);
      const newX = clamp(finite(obj.x, page.x), page.x, page.x + page.w - obj.w);
      const newY = clamp(finite(obj.y, page.y), page.y, page.y + page.h - obj.h);
      const dx = newX - before.x, dy = newY - before.y;
      obj.x = newX; obj.y = newY;
      if (obj.type === 'group' && (dx || dy) && Array.isArray(obj.children)) {
        for (const child of obj.children) moveObject(child, dx, dy);
      }
    } else if (obj.type === 'arrow') {
      const p1 = clampPointToActivePage({ x: obj.x1, y: obj.y1 });
      const p2 = clampPointToActivePage({ x: obj.x2, y: obj.y2 });
      obj.x1 = p1.x; obj.y1 = p1.y; obj.x2 = p2.x; obj.y2 = p2.y;
    } else if (obj.type === 'connector') {
      // Connectors are constrained indirectly by the items they attach to.
    } else if (obj.type === 'pen' && Array.isArray(obj.points)) {
      obj.points = obj.points.map(clampPointToActivePage);
    }
    return obj;
  }

  function clampObjectsToActivePage() {
    if (!isRestrictedCanvas()) return;
    for (const obj of state.objects) clampObjectToActivePage(obj);
  }

  function activeCanvasLabel() {
    const page = activePageRect();
    return page ? page.label : 'Free';
  }

  function drawBoardSurface(c, rect) {
    const page = activePageRect();
    if (!page) return;

    c.save();
    c.shadowColor = 'rgba(20,24,31,0.12)';
    c.shadowBlur = 26;
    c.shadowOffsetY = 12;
    c.fillStyle = '#ffffff';
    roundedPath(c, page.x, page.y, page.w, page.h, 12);
    c.fill();
    c.restore();

    c.save();
    roundedPath(c, page.x, page.y, page.w, page.h, 12);
    c.clip();
    if (state.appearance.background === 'dots') drawDotsOn(c, page.x, page.y, page.w, page.h);
    else if (state.appearance.background === 'grid') drawGridOn(c, page.x, page.y, page.w, page.h);
    c.restore();

    c.save();
    c.strokeStyle = '#cfd4dc';
    c.lineWidth = Math.max(1 / state.scale, 0.75);
    roundedPath(c, page.x, page.y, page.w, page.h, 12);
    c.stroke();

    c.fillStyle = '#7a7f89';
    c.font = `${Math.max(13 / state.scale, 10)}px ${UI_FONT}`;
    c.textBaseline = 'bottom';
    c.fillText(page.label, page.x + 12 / state.scale, page.y - 10 / state.scale);
    c.restore();
  }

  function drawDotsOn(c, x0, y0, w, h) {
    c.save();
    const step = 28;
    const radius = Math.max(1.1 / state.scale, 0.8);
    c.fillStyle = '#d8dce2';
    for (let x = x0; x <= x0 + w; x += step) {
      for (let y = y0; y <= y0 + h; y += step) {
        c.beginPath();
        c.arc(x, y, radius, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  function drawGridOn(c, x0, y0, w, h) {
    c.save();
    const minor = 50;
    c.strokeStyle = '#edf0f3';
    c.lineWidth = Math.max(0.5, 1 / state.scale);
    for (let x = x0; x <= x0 + w; x += minor) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + h); c.stroke(); }
    for (let y = y0; y <= y0 + h; y += minor) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke(); }
    c.strokeStyle = '#e1e5ea';
    for (let x = x0; x <= x0 + w; x += minor * 4) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + h); c.stroke(); }
    for (let y = y0; y <= y0 + h; y += minor * 4) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke(); }
    c.restore();
  }

  function drawObject(c, obj, isTemp = false) {
    c.save();
    c.globalAlpha = (isTemp ? 0.65 : 1) * clamp(finite(obj.opacity, 1), 0.1, 1);
    if (obj.type === 'image') drawImageObject(c, obj);
    else if (obj.type === 'text') drawTextObject(c, obj);
    else if (obj.type === 'arrow') drawArrowObject(c, obj);
    else if (obj.type === 'connector') drawConnectorObject(c, obj);
    else if (obj.type === 'pen') drawPenObject(c, obj);
    else if (obj.type === 'frame') drawFrameObject(c, obj);
    else if (obj.type === 'group') drawGroupObject(c, obj);
    c.restore();
  }

  function withRotatedRect(c, obj, fn) {
    const cx = obj.x + obj.w / 2;
    const cy = obj.y + obj.h / 2;
    c.translate(cx, cy);
    c.rotate((obj.rotation || 0) * Math.PI / 180);
    c.translate(-obj.w / 2, -obj.h / 2);
    fn();
  }

  function drawImageObject(c, obj) {
    const img = state.imageCache.get(obj.id);
    withRotatedRect(c, obj, () => {
      c.fillStyle = '#f0f1f3';
      c.fillRect(0, 0, obj.w, obj.h);
      if (img && img.complete && img.naturalWidth !== 0) c.drawImage(img, 0, 0, obj.w, obj.h);
      else {
        c.strokeStyle = '#cfd4dc';
        c.strokeRect(0, 0, obj.w, obj.h);
        c.fillStyle = '#6f747c';
        c.font = `22px ${UI_FONT}`;
        c.fillText('Image missing or still loading', 20, 28);
      }
    });
  }

  function drawTextObject(c, obj) {
    withRotatedRect(c, obj, () => {
      c.fillStyle = obj.fill || 'rgba(255,255,255,0.92)';
      roundedPath(c, 0, 0, obj.w, obj.h, 12);
      c.fill();
      c.strokeStyle = obj.kind === 'sticker' ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.11)';
      c.lineWidth = 1.1;
      c.stroke();
      c.fillStyle = obj.color || '#111111';
      c.font = `${obj.fontSize || 26}px ${UI_FONT}`;
      c.textBaseline = 'top';
      wrapTextOn(c, obj.text || '', 14, 12, Math.max(20, obj.w - 28), (obj.fontSize || 26) * 1.25);
    });
  }

  function applyStrokeStyle(c, obj) {
    const style = obj.style || 'solid';
    c.globalAlpha = style === 'marker' ? 0.42 : c.globalAlpha;
    if (style === 'dashed') c.setLineDash([18, 12]);
    else c.setLineDash([]);
  }

  function drawArrowObject(c, obj) {
    c.save();
    const color = obj.color || '#2f3437';
    const width = obj.width || 5;
    const dx = obj.x2 - obj.x1;
    const dy = obj.y2 - obj.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) { c.restore(); return; }
    const angle = Math.atan2(dy, dx);
    const head = Math.max(22, width * 4.8);
    const lineEndX = obj.x2 - Math.min(head * 0.42, len * 0.35) * Math.cos(angle);
    const lineEndY = obj.y2 - Math.min(head * 0.42, len * 0.35) * Math.sin(angle);

    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    applyStrokeStyle(c, obj);
    c.beginPath();
    c.moveTo(obj.x1, obj.y1);
    c.lineTo(lineEndX, lineEndY);
    c.stroke();

    c.setLineDash([]);
    c.globalAlpha = Math.min(1, c.globalAlpha * ((obj.style || 'solid') === 'marker' ? 1.35 : 1));
    c.beginPath();
    c.moveTo(obj.x2, obj.y2);
    c.lineTo(obj.x2 - head * Math.cos(angle - Math.PI / 7), obj.y2 - head * Math.sin(angle - Math.PI / 7));
    c.lineTo(obj.x2 - head * 0.62 * Math.cos(angle), obj.y2 - head * 0.62 * Math.sin(angle));
    c.lineTo(obj.x2 - head * Math.cos(angle + Math.PI / 7), obj.y2 - head * Math.sin(angle + Math.PI / 7));
    c.closePath();
    c.fill();
    c.restore();
  }

  function drawConnectorObject(c, obj) {
    const end = connectorEndpoints(obj);
    if (!end) return;
    c.save();
    c.strokeStyle = obj.color || '#8b5cf6';
    c.fillStyle = obj.color || '#8b5cf6';
    c.lineWidth = obj.width || 4;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    applyStrokeStyle(c, obj);
    c.beginPath();
    c.moveTo(end.x1, end.y1);
    c.lineTo(end.x2, end.y2);
    c.stroke();
    c.setLineDash([]);
    const r = Math.max(4.5, (obj.width || 4) * 1.05);
    c.beginPath(); c.arc(end.x1, end.y1, r, 0, Math.PI * 2); c.fill();
    if (obj.toId) { c.beginPath(); c.arc(end.x2, end.y2, r, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  function connectorEndpoints(obj) {
    if (!obj || !obj.fromId) return null;
    const from = objectById(obj.fromId);
    const fromBounds = boundsOf(from);
    if (!fromBounds) return null;
    const fromCenter = rectCenter(fromBounds);
    let targetCenter = null;
    let toBounds = null;
    if (obj.toId) {
      const to = objectById(obj.toId);
      toBounds = boundsOf(to);
      if (!toBounds) return null;
      targetCenter = rectCenter(toBounds);
    } else if (Number.isFinite(Number(obj.x2)) && Number.isFinite(Number(obj.y2))) {
      targetCenter = { x: Number(obj.x2), y: Number(obj.y2) };
    }
    if (!targetCenter) return null;
    const start = edgePointOnRect(fromBounds, targetCenter);
    const end = toBounds ? edgePointOnRect(toBounds, fromCenter) : targetCenter;
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  function edgePointOnRect(rect, target) {
    const c = rectCenter(rect);
    const dx = target.x - c.x;
    const dy = target.y - c.y;
    if (!dx && !dy) return c;
    const halfW = Math.max(rect.w / 2, 1);
    const halfH = Math.max(rect.h / 2, 1);
    const tx = dx ? halfW / Math.abs(dx) : Infinity;
    const ty = dy ? halfH / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty, 1);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  function drawPenObject(c, obj) {
    if (!obj.points || obj.points.length < 2) return;
    c.save();
    c.strokeStyle = obj.color || '#2f3437';
    c.lineWidth = obj.width || 4;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    applyStrokeStyle(c, obj);
    c.beginPath();
    c.moveTo(obj.points[0].x, obj.points[0].y);
    for (const p of obj.points.slice(1)) c.lineTo(p.x, p.y);
    c.stroke();
    c.restore();
  }

  function drawFrameObject(c, obj) {
    c.save();
    const rect = normalizedRect(obj.x, obj.y, obj.w, obj.h);
    if (obj.fill && obj.fill !== 'transparent') {
      c.fillStyle = obj.fill;
      roundedPath(c, rect.x, rect.y, rect.w, rect.h, 16);
      c.fill();
    }
    c.strokeStyle = obj.color || '#2f3437';
    c.lineWidth = obj.width || 3;
    if ((obj.style || 'dashed') === 'dashed') c.setLineDash([14, 10]);
    else if (obj.style === 'marker') { c.globalAlpha *= 0.55; c.setLineDash([]); }
    else c.setLineDash([]);
    roundedPath(c, rect.x, rect.y, rect.w, rect.h, 16);
    c.stroke();
    c.setLineDash([]);
    c.font = `24px ${UI_FONT}`;
    c.fillStyle = obj.color || '#2f3437';
    if (obj.label) c.fillText(obj.label, rect.x + 10, rect.y - 12);
    c.restore();
  }

  function drawGroupObject(c, obj) {
    if (!Array.isArray(obj.children)) return;
    c.save();
    for (const child of obj.children) drawObject(c, child);
    c.restore();
  }

  function roundedPath(c, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function wrapTextOn(c, text, x, y, maxWidth, lineHeight) {
    const lines = String(text).split('\n');
    for (const line of lines) {
      const words = line.length ? line.split(/\s+/) : [''];
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (c.measureText(test).width > maxWidth && current) {
          c.fillText(current, x, y);
          current = word;
          y += lineHeight;
        } else current = test;
      }
      c.fillText(current, x, y);
      y += lineHeight;
    }
  }

  function drawGuides(c) {
    if (!state.guides || !state.guides.length) return;
    c.save();
    c.strokeStyle = 'rgba(139,92,246,0.9)';
    c.fillStyle = 'rgba(139,92,246,0.9)';
    c.lineWidth = Math.max(1.2 / state.scale, 0.8);
    c.setLineDash([7 / state.scale, 5 / state.scale]);
    for (const g of state.guides) {
      c.beginPath();
      if (g.axis === 'x') { c.moveTo(g.x, g.y1); c.lineTo(g.x, g.y2); }
      else if (g.axis === 'y') { c.moveTo(g.x1, g.y); c.lineTo(g.x2, g.y); }
      else if (g.axis === 'spacingX') { c.moveTo(g.x1, g.y); c.lineTo(g.x2, g.y); }
      else if (g.axis === 'spacingY') { c.moveTo(g.x, g.y1); c.lineTo(g.x, g.y2); }
      c.stroke();
      if (g.axis === 'spacingX') drawGuideTicks(c, g.x1, g.y, g.x2, g.y);
      if (g.axis === 'spacingY') drawGuideTicks(c, g.x, g.y1, g.x, g.y2);
    }
    c.setLineDash([]);
    c.restore();
  }

  function drawGuideTicks(c, x1, y1, x2, y2) {
    const t = 7 / state.scale;
    if (Math.abs(y2 - y1) < Math.abs(x2 - x1)) {
      for (const x of [x1, x2]) { c.beginPath(); c.moveTo(x, y1 - t); c.lineTo(x, y1 + t); c.stroke(); }
    } else {
      for (const y of [y1, y2]) { c.beginPath(); c.moveTo(x1 - t, y); c.lineTo(x1 + t, y); c.stroke(); }
    }
  }

  function drawLockedObjectBadges(c) {
    const lockedObjects = state.objects.filter(o => isLocked(o));
    if (!lockedObjects.length) return;
    c.save();
    for (const obj of lockedObjects) {
      const b = boundsOf(obj);
      if (!b) continue;
      const size = Math.max(20 / state.scale, 13);
      const pad = Math.max(6 / state.scale, 4);
      const x = b.x + b.w - size - pad;
      const y = b.y + pad;
      drawFlatLockIcon(c, x, y, size);
    }
    c.restore();
  }

  function drawFlatLockIcon(c, x, y, size) {
    const stroke = Math.max(1.45 / state.scale, 1);
    const r = Math.max(size * 0.22, 3 / state.scale);
    c.save();
    c.globalAlpha *= 0.86;
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.strokeStyle = 'rgba(31,35,44,0.18)';
    c.lineWidth = Math.max(1 / state.scale, 0.75);
    roundedPath(c, x, y, size, size, r);
    c.fill();
    c.stroke();

    const cx = x + size / 2;
    const bodyW = size * 0.42;
    const bodyH = size * 0.34;
    const bodyX = cx - bodyW / 2;
    const bodyY = y + size * 0.48;
    c.fillStyle = 'rgba(80,86,99,0.72)';
    roundedPath(c, bodyX, bodyY, bodyW, bodyH, Math.max(2 / state.scale, size * 0.09));
    c.fill();

    c.strokeStyle = 'rgba(80,86,99,0.72)';
    c.lineWidth = stroke;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - bodyW * 0.32, bodyY);
    c.lineTo(cx - bodyW * 0.32, bodyY - size * 0.12);
    c.quadraticCurveTo(cx - bodyW * 0.32, bodyY - size * 0.30, cx, bodyY - size * 0.30);
    c.quadraticCurveTo(cx + bodyW * 0.32, bodyY - size * 0.30, cx + bodyW * 0.32, bodyY - size * 0.12);
    c.lineTo(cx + bodyW * 0.32, bodyY);
    c.stroke();
    c.restore();
  }

  function drawSelectionState(c) {
    const ids = selectedIds();
    if (!ids.length) return;
    const objs = selectedObjects();
    if (objs.length === 1) { drawSelection(objs[0]); return; }

    c.save();
    c.strokeStyle = '#8b5cf6';
    c.lineWidth = Math.max(1.2 / state.scale, 0.8);
    c.setLineDash([6 / state.scale, 5 / state.scale]);
    for (const obj of objs) {
      const b = boundsOf(obj);
      if (!b) continue;
      c.strokeRect(b.x, b.y, b.w, b.h);
    }
    c.setLineDash([]);
    const ub = boundsOfSelection(ids);
    if (ub) {
      c.lineWidth = Math.max(2 / state.scale, 1);
      c.strokeStyle = '#8b5cf6';
      c.strokeRect(ub.x, ub.y, ub.w, ub.h);
      c.fillStyle = 'rgba(139,92,246,0.08)';
      c.fillRect(ub.x, ub.y, ub.w, ub.h);
    }
    c.restore();
  }

  function drawLasso(c) {
    if (!state.lasso) return;
    const r = normalizedRect(state.lasso.start.x, state.lasso.start.y, state.lasso.current.x - state.lasso.start.x, state.lasso.current.y - state.lasso.start.y);
    c.save();
    c.fillStyle = 'rgba(139,92,246,0.08)';
    c.strokeStyle = 'rgba(139,92,246,0.92)';
    c.lineWidth = Math.max(1.4 / state.scale, 0.8);
    c.setLineDash([7 / state.scale, 5 / state.scale]);
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeRect(r.x, r.y, r.w, r.h);
    c.restore();
  }


  function drawExportArea(c) {
    if (!state.exportArea?.start || !state.exportArea.current) return;
    const r = normalizedRect(state.exportArea.start.x, state.exportArea.start.y, state.exportArea.current.x - state.exportArea.start.x, state.exportArea.current.y - state.exportArea.start.y);
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.055)';
    c.strokeStyle = 'rgba(139,92,246,0.98)';
    c.lineWidth = Math.max(1.8 / state.scale, 1);
    c.setLineDash([10 / state.scale, 7 / state.scale]);
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeRect(r.x, r.y, r.w, r.h);
    c.setLineDash([]);
    c.fillStyle = 'rgba(139,92,246,0.98)';
    c.font = `${Math.max(13 / state.scale, 9)}px ${UI_FONT}`;
    const label = `${Math.round(r.w)} × ${Math.round(r.h)} px`;
    c.fillText(label, r.x + 10 / state.scale, r.y - 10 / state.scale);
    c.restore();
  }

  function drawSelection(obj) {
    const b = boundsOf(obj);
    if (!b) return;
    ctx.save();
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = Math.max(1.6 / state.scale, 0.9);
    ctx.setLineDash([]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);

    const handles = isLocked(obj) ? [] : selectionHandles(obj);
    for (const h of handles) {
      const size = h.size;
      if (h.type === 'rotate') {
        ctx.beginPath();
        ctx.moveTo(b.x + b.w / 2, b.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, size * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#8b5cf6';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#8b5cf6';
        roundedPath(ctx, h.x - size / 2, h.y - size / 2, size, size, Math.max(2 / state.scale, 1.5));
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function selectionHandles(obj) {
    if (!obj || !['image', 'text', 'frame'].includes(obj.type)) return [];
    const b = boundsOf(obj);
    if (!b) return [];
    const size = Math.max(12 / state.scale, 8);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const handles = [
      ['nw', b.x, b.y], ['n', cx, b.y], ['ne', b.x + b.w, b.y],
      ['e', b.x + b.w, cy], ['se', b.x + b.w, b.y + b.h], ['s', cx, b.y + b.h],
      ['sw', b.x, b.y + b.h], ['w', b.x, cy],
    ].map(([handle, x, y]) => ({ type: 'resize', handle, x, y, size }));
    if (obj.type === 'image' || obj.type === 'text') handles.push({ type: 'rotate', handle: 'rotate', x: cx, y: b.y - 34 / state.scale, size: Math.max(14 / state.scale, 10) });
    return handles;
  }

  function boundsOf(obj) {
    if (!obj) return null;
    if (obj.type === 'image') return rotatedBoundsForObjectRect(obj, obj.w, obj.h);
    if (obj.type === 'text') return rotatedBoundsForObjectRect(obj, obj.w, Math.max(obj.h, estimatedTextObjectHeight(obj)));
    if (obj.type === 'frame') return normalizedRect(obj.x, obj.y, obj.w, obj.h);
    if (obj.type === 'group') {
      const childBounds = Array.isArray(obj.children) ? unionBounds(obj.children.map(boundsOf)) : null;
      return childBounds || normalizedRect(obj.x, obj.y, obj.w, obj.h);
    }
    if (obj.type === 'arrow') return rectFromPoints(obj.x1, obj.y1, obj.x2, obj.y2, Math.max(24, finite(obj.width, 5) * 5));
    if (obj.type === 'connector') {
      const end = connectorEndpoints(obj);
      if (!end) return null;
      return rectFromPoints(end.x1, end.y1, end.x2, end.y2, Math.max(22, finite(obj.width, 4) * 4));
    }
    if (obj.type === 'pen') {
      if (!obj.points || !obj.points.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of obj.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const pad = Math.max(18, finite(obj.width, 4) * 4);
      return { x: minX - pad, y: minY - pad, w: Math.max(1, maxX - minX + pad * 2), h: Math.max(1, maxY - minY + pad * 2) };
    }
    return null;
  }

  function rotatedBoundsForObjectRect(obj, localW, localH) {
    const x = finite(obj.x);
    const y = finite(obj.y);
    const w = Math.max(1, Math.abs(finite(localW, obj.w || 1)));
    const h = Math.max(1, Math.abs(finite(localH, obj.h || 1)));
    const angle = finite(obj.rotation, 0) * Math.PI / 180;
    if (!angle) return normalizedRect(x, y, w, h);
    const cx = x + finite(obj.w, w) / 2;
    const cy = y + finite(obj.h, h) / 2;
    const corners = [
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h },
    ].map(pt => rotatePointAround(pt.x, pt.y, cx, cy, angle));
    return unionBounds(corners.map(pt => ({ x: pt.x, y: pt.y, w: 0, h: 0 })));
  }

  function rotatePointAround(x, y, cx, cy, angle) {
    const dx = x - cx;
    const dy = y - cy;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  function estimatedTextObjectHeight(obj) {
    const fontSize = clamp(finite(obj.fontSize, 26), 10, 96);
    const lineHeight = fontSize * 1.25;
    const maxWidth = Math.max(20, finite(obj.w, 360) - 28);
    const text = String(obj.text || '');
    if (!text.length) return finite(obj.h, 160);
    const mctx = ctx || document.createElement('canvas').getContext('2d');
    mctx.font = `${fontSize}px ${UI_FONT}`;
    let lineCount = 0;
    for (const rawLine of text.split('\n')) {
      const words = rawLine.length ? rawLine.split(/\s+/) : [''];
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (mctx.measureText(test).width > maxWidth && current) {
          lineCount += 1;
          current = word;
        } else current = test;
      }
      lineCount += 1;
    }
    return Math.max(finite(obj.h, 160), 12 + lineCount * lineHeight + 16);
  }

  function normalizedRect(x, y, w, h) {
    return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
  }

  function rectsIntersect(a, b) {
    return a && b && a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
  }

  function unionBounds(boxes) {
    const valid = boxes.filter(Boolean);
    if (!valid.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of valid) {
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function boundsOfSelection(ids = selectedIds()) {
    return unionBounds(ids.map(id => objectById(id)).filter(Boolean).map(boundsOf));
  }

  function rectFromPoints(x1, y1, x2, y2, pad = 0) {
    const x = Math.min(x1, x2) - pad;
    const y = Math.min(y1, y2) - pad;
    return { x, y, w: Math.abs(x2 - x1) + pad * 2, h: Math.abs(y2 - y1) + pad * 2 };
  }

  function contentBounds(padding = 100) {
    const page = activePageRect();
    if (page) return { x: page.x, y: page.y, w: page.w, h: page.h };

    const boxes = state.objects.map(boundsOf).filter(Boolean);
    if (!boxes.length) return { x: 0, y: 0, w: BOARD_W, h: BOARD_H };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
    minX = clamp(minX - padding, 0, BOARD_W);
    minY = clamp(minY - padding, 0, BOARD_H);
    maxX = clamp(maxX + padding, 0, BOARD_W);
    maxY = clamp(maxY + padding, 0, BOARD_H);
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function hitTest(x, y) {
    for (let i = state.objects.length - 1; i >= 0; i--) {
      const obj = state.objects[i];
      if (obj.type === 'connector') {
        const end = connectorEndpoints(obj);
        if (end && distanceToSegment(x, y, end.x1, end.y1, end.x2, end.y2) <= Math.max(10 / state.scale, 7)) return obj;
        continue;
      }
      const b = boundsOf(obj);
      if (!b) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return obj;
    }
    return null;
  }

  function hitTestConnectable(x, y, excludeId = null) {
    for (let i = state.objects.length - 1; i >= 0; i--) {
      const obj = state.objects[i];
      if (!isConnectableObject(obj) || obj.id === excludeId) continue;
      const b = boundsOf(obj);
      if (!b) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return obj;
    }
    return null;
  }

  function isConnectableObject(obj) {
    return Boolean(obj && ['image', 'text', 'frame', 'group'].includes(obj.type));
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(px - x1, py - y1);
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
    const x = x1 + t * dx, y = y1 + t * dy;
    return Math.hypot(px - x, py - y);
  }

  function hitSelectionHandle(obj, x, y) {
    const handles = selectionHandles(obj);
    for (let i = handles.length - 1; i >= 0; i--) {
      const h = handles[i];
      const hit = Math.max(18 / state.scale, h.size * 0.75);
      if (Math.abs(x - h.x) <= hit && Math.abs(y - h.y) <= hit) return h;
    }
    return null;
  }

  function resizeRectObjectFromHandle(obj, orig, handle, p, start) {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    const minW = 40;
    const minH = 40;
    let x = orig.x, y = orig.y, w = orig.w, h = orig.h;

    if (handle.includes('e')) w = Math.max(minW, orig.w + dx);
    if (handle.includes('s')) h = Math.max(minH, orig.h + dy);
    if (handle.includes('w')) {
      w = orig.w - dx;
      x = orig.x + dx;
      if (w < minW) { x = orig.x + orig.w - minW; w = minW; }
    }
    if (handle.includes('n')) {
      h = orig.h - dy;
      y = orig.y + dy;
      if (h < minH) { y = orig.y + orig.h - minH; h = minH; }
    }
    obj.x = x; obj.y = y; obj.w = w; obj.h = h;
  }

  function moveObject(obj, dx, dy) {
    if (obj.type === 'image' || obj.type === 'text' || obj.type === 'frame') { obj.x += dx; obj.y += dy; }
    else if (obj.type === 'group') {
      obj.x += dx; obj.y += dy;
      for (const child of (obj.children || [])) moveObject(child, dx, dy);
    }
    else if (obj.type === 'arrow') { obj.x1 += dx; obj.y1 += dy; obj.x2 += dx; obj.y2 += dy; }
    else if (obj.type === 'connector') { /* connectors follow their endpoint objects */ }
    else if (obj.type === 'pen') { for (const p of obj.points) { p.x += dx; p.y += dy; } }
  }
  function snapEnabled() {
    return state.appearance.snapEnabled !== false;
  }

  function snapThreshold() {
    return clamp(9 / state.scale, 4, 16);
  }

  function rectCenter(b) {
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  function snapTargets(excludeId) {
    const exclude = new Set(Array.isArray(excludeId) ? excludeId : (excludeId ? [excludeId] : []));
    const targets = [];
    const page = activePageRect();
    if (page) targets.push({ id: 'page', kind: 'page', b: page });
    for (const obj of state.objects) {
      if (exclude.has(obj.id)) continue;
      const b = boundsOf(obj);
      if (b) targets.push({ id: obj.id, kind: obj.type, b });
    }
    return targets;
  }

  function closestSnapForBounds(b, excludeId, limitedAxes = null) {
    if (!snapEnabled()) return { dx: 0, dy: 0, guides: [] };
    const threshold = snapThreshold();
    const targets = snapTargets(excludeId);
    const ownX = [
      { role: 'left', value: b.x },
      { role: 'center', value: b.x + b.w / 2 },
      { role: 'right', value: b.x + b.w },
    ];
    const ownY = [
      { role: 'top', value: b.y },
      { role: 'middle', value: b.y + b.h / 2 },
      { role: 'bottom', value: b.y + b.h },
    ];
    const useX = !limitedAxes || limitedAxes.x;
    const useY = !limitedAxes || limitedAxes.y;
    let bestX = null;
    let bestY = null;

    for (const t of targets) {
      const tb = t.b;
      const targetX = [
        { role: 'left', value: tb.x },
        { role: 'center', value: tb.x + tb.w / 2 },
        { role: 'right', value: tb.x + tb.w },
      ];
      const targetY = [
        { role: 'top', value: tb.y },
        { role: 'middle', value: tb.y + tb.h / 2 },
        { role: 'bottom', value: tb.y + tb.h },
      ];
      if (useX) {
        for (const own of ownX) for (const target of targetX) {
          const diff = target.value - own.value;
          const abs = Math.abs(diff);
          if (abs <= threshold && (!bestX || abs < bestX.abs)) {
            bestX = { diff, abs, guide: { axis: 'x', x: target.value, y1: Math.min(b.y, tb.y) - 60 / state.scale, y2: Math.max(b.y + b.h, tb.y + tb.h) + 60 / state.scale } };
          }
        }
      }
      if (useY) {
        for (const own of ownY) for (const target of targetY) {
          const diff = target.value - own.value;
          const abs = Math.abs(diff);
          if (abs <= threshold && (!bestY || abs < bestY.abs)) {
            bestY = { diff, abs, guide: { axis: 'y', y: target.value, x1: Math.min(b.x, tb.x) - 60 / state.scale, x2: Math.max(b.x + b.w, tb.x + tb.w) + 60 / state.scale } };
          }
        }
      }
    }

    const guides = [];
    let dx = bestX ? bestX.diff : 0;
    let dy = bestY ? bestY.diff : 0;
    if (bestX) guides.push(bestX.guide);
    if (bestY) guides.push(bestY.guide);

    if (useX && !bestX) {
      const spacing = equalSpacingSnapX(b, targets, threshold);
      if (spacing) { dx = spacing.dx; guides.push(spacing.guide); }
    }
    if (useY && !bestY) {
      const spacing = equalSpacingSnapY(b, targets, threshold);
      if (spacing) { dy = spacing.dy; guides.push(spacing.guide); }
    }

    return { dx, dy, guides };
  }

  function equalSpacingSnapX(b, targets, threshold) {
    const lefts = targets.map(t => t.b).filter(tb => tb.x + tb.w <= b.x).sort((a, b2) => (b2.x + b2.w) - (a.x + a.w));
    const rights = targets.map(t => t.b).filter(tb => tb.x >= b.x + b.w).sort((a, b2) => a.x - b2.x);
    if (!lefts.length || !rights.length) return null;
    const left = lefts[0], right = rights[0];
    const space = right.x - (left.x + left.w);
    if (space <= b.w) return null;
    const targetX = left.x + left.w + (space - b.w) / 2;
    const dx = targetX - b.x;
    if (Math.abs(dx) > threshold) return null;
    const y = Math.max(b.y + b.h, left.y + left.h, right.y + right.h) + 28 / state.scale;
    return { dx, guide: { axis: 'spacingX', x1: left.x + left.w, x2: right.x, y } };
  }

  function equalSpacingSnapY(b, targets, threshold) {
    const above = targets.map(t => t.b).filter(tb => tb.y + tb.h <= b.y).sort((a, b2) => (b2.y + b2.h) - (a.y + a.h));
    const below = targets.map(t => t.b).filter(tb => tb.y >= b.y + b.h).sort((a, b2) => a.y - b2.y);
    if (!above.length || !below.length) return null;
    const top = above[0], bottom = below[0];
    const space = bottom.y - (top.y + top.h);
    if (space <= b.h) return null;
    const targetY = top.y + top.h + (space - b.h) / 2;
    const dy = targetY - b.y;
    if (Math.abs(dy) > threshold) return null;
    const x = Math.max(b.x + b.w, top.x + top.w, bottom.x + bottom.w) + 28 / state.scale;
    return { dy, guide: { axis: 'spacingY', y1: top.y + top.h, y2: bottom.y, x } };
  }

  function applySnapToMovedObject(obj, excludeId) {
    state.guides = [];
    const b = boundsOf(obj);
    if (!b || !snapEnabled()) return;
    const snap = closestSnapForBounds(b, excludeId);
    if (snap.dx || snap.dy) {
      moveObject(obj, snap.dx, snap.dy);
      clampObjectToActivePage(obj);
    }
    state.guides = snap.guides || [];
  }

  function applySnapToResizedObject(obj, excludeId, handle) {
    state.guides = [];
    const b = boundsOf(obj);
    if (!b || !snapEnabled()) return;
    const axes = { x: /[ew]/.test(handle), y: /[ns]/.test(handle) };
    const snap = closestSnapForBounds(b, excludeId, axes);
    if (snap.dx && /e/.test(handle)) obj.w += snap.dx;
    else if (snap.dx && /w/.test(handle)) { obj.x += snap.dx; obj.w -= snap.dx; }
    if (snap.dy && /s/.test(handle)) obj.h += snap.dy;
    else if (snap.dy && /n/.test(handle)) { obj.y += snap.dy; obj.h -= snap.dy; }
    obj.w = Math.max(40, obj.w);
    obj.h = Math.max(40, obj.h);
    clampObjectToActivePage(obj);
    state.guides = snap.guides || [];
  }


  function imageNeedsOptimization(file, img) {
    const pixels = Math.max(1, finite(img.width, 1) * finite(img.height, 1));
    return file.size > MAX_UNOPTIMIZED_IMAGE_BYTES || img.width > MAX_EMBEDDED_IMAGE_EDGE || img.height > MAX_EMBEDDED_IMAGE_EDGE || pixels > MAX_EMBEDDED_IMAGE_PIXELS;
  }

  function optimizedImageDataURL(file, img, originalSrc) {
    if (!imageNeedsOptimization(file, img)) return { src: originalSrc, optimized: false, width: img.width, height: img.height };

    const scale = Math.min(
      1,
      MAX_EMBEDDED_IMAGE_EDGE / Math.max(1, img.width),
      MAX_EMBEDDED_IMAGE_EDGE / Math.max(1, img.height),
      Math.sqrt(MAX_EMBEDDED_IMAGE_PIXELS / Math.max(1, img.width * img.height))
    );

    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));
    const scratch = document.createElement('canvas');
    scratch.width = targetW;
    scratch.height = targetH;
    const sctx = scratch.getContext('2d', { alpha: false });
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, targetW, targetH);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, targetW, targetH);

    try {
      return { src: scratch.toDataURL('image/jpeg', 0.86), optimized: true, width: targetW, height: targetH };
    } catch (_) {
      return { src: originalSrc, optimized: false, width: img.width, height: img.height };
    }
  }

  function estimatedSerializedBytes(payload) {
    try { return new Blob([JSON.stringify(payload)]).size; }
    catch (_) { return 0; }
  }

  function addImageFromFile(file, index = 0) {
    if (!file || !file.type.startsWith('image/')) return;
    const before = index === 0 ? makeSnapshot() : null;
    const reader = new FileReader();
    reader.onerror = () => showToast(`Could not read ${file.name}`);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const optimized = optimizedImageDataURL(file, img, reader.result);
        const displayImg = new Image();
        displayImg.onload = () => {
          if (before) pushHistory(before);
          const page = activePageRect();
          const maxW = page ? Math.min(620, page.w * 0.82) : 620;
          const ratio = displayImg.width ? displayImg.height / displayImg.width : 0.75;
          const w = Math.min(maxW, displayImg.width || maxW);
          const h = Math.min(w * ratio, page ? page.h * 0.82 : w * ratio);
          const center = page
            ? { x: page.x + page.w / 2, y: page.y + page.h / 2 }
            : screenToWorld(canvas.getBoundingClientRect().left + canvas.clientWidth / 2, canvas.getBoundingClientRect().top + canvas.clientHeight / 2);
          const obj = clampObjectToActivePage({
            id: uid(), type: 'image', name: safeString(file.name, 512), src: optimized.src,
            x: center.x - w / 2 + index * 40, y: center.y - h / 2 + index * 40,
            w, h, rotation: 0,
            optimized: Boolean(optimized.optimized),
            originalPixelSize: { w: img.width || 0, h: img.height || 0 },
          });
          state.objects.push(obj);
          state.imageCache.set(obj.id, displayImg);
          setSelection([obj.id]);
          markDirty(); draw();
          showToast(optimized.optimized ? 'Image optimized and added' : 'Image added');
        };
        displayImg.onerror = () => showToast(`Image format not displayable here: ${file.name}`);
        displayImg.src = optimized.src;
      };
      img.onerror = () => showToast(`Image format not displayable here: ${file.name}`);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function allObjectsDeep(objects = state.objects) {
    const out = [];
    for (const obj of objects || []) {
      out.push(obj);
      if (obj.type === 'group' && Array.isArray(obj.children)) out.push(...allObjectsDeep(obj.children));
    }
    return out;
  }

  function ensureImageCache(callback) {
    const imageObjects = allObjectsDeep().filter(o => o.type === 'image' && o.src && !state.imageCache.has(o.id));
    if (!imageObjects.length) { callback(); return; }
    let remaining = imageObjects.length;
    for (const obj of imageObjects) {
      const img = new Image();
      img.onload = img.onerror = () => { state.imageCache.set(obj.id, img); if (--remaining === 0) callback(); };
      img.src = obj.src;
    }
  }

  function normalizeProjectTitle(value) {
    const title = safeString(value, 120).replace(/[\r\n\t]+/g, ' ').replace(/\x00/g, '').trim();
    return title || 'Untitled';
  }

  function filenameSafeProjectTitle() {
    const title = normalizeProjectTitle(state.metadata?.title || 'Untitled');
    const cleaned = title.replace(/[\\/:*?"<>|#%{}$!'@+`=&]/g, ' ').replace(/\s+/g, ' ').trim();
    return (cleaned || 'Untitled').slice(0, 80);
  }

  function suggestedBoardFilename() {
    return `${filenameSafeProjectTitle()}.siltboard`;
  }

  function updateProjectTitleInput() {
    if (projectTitleInput) projectTitleInput.value = normalizeProjectTitle(state.metadata?.title || 'Untitled');
  }

  function setProjectTitle(value, dirty = true) {
    const next = normalizeProjectTitle(value);
    if (state.metadata.title === next) { updateProjectTitleInput(); return; }
    const before = makeSnapshot();
    state.metadata.title = next;
    if (dirty) { pushHistory(before); markDirty(); }
    updateProjectTitleInput();
    updateUI();
  }

  function serializeProject() {
    if (projectTitleInput) state.metadata.title = normalizeProjectTitle(projectTitleInput.value);
    const now = new Date().toISOString();
    state.metadata.updatedAt = now;
    return {
      app: FILE_APP_ID,
      formatVersion: FILE_FORMAT_VERSION,
      version: VERSION,
      metadata: deepClone(state.metadata),
      appearance: deepClone(state.appearance),
      board: { width: BOARD_W, height: BOARD_H, pagePreset: state.appearance.pagePreset || 'free', activePage: activePageRect() },
      view: { scale: state.scale, offsetX: state.offsetX, offsetY: state.offsetY },
      objects: deepClone(state.objects),
      savedAt: now,
    };
  }

  function defaultMetadata() {
    const now = new Date().toISOString();
    return { boardId: uid(), title: 'Untitled', createdAt: now, updatedAt: now, authors: [] };
  }

  function sanitizeMetadata(metadata) {
    const base = defaultMetadata();
    if (!metadata || typeof metadata !== 'object') return base;
    return {
      boardId: safeString(metadata.boardId || base.boardId, 160),
      title: safeString(metadata.title || base.title, 240),
      createdAt: safeString(metadata.createdAt || base.createdAt, 80),
      updatedAt: safeString(metadata.updatedAt || base.updatedAt, 80),
      authors: Array.isArray(metadata.authors) ? metadata.authors.slice(0, 20).map(a => safeString(a, 160)) : [],
    };
  }

  function sanitizeAppearance(appearance) {
    const background = safeString(appearance?.background || 'dots', 20);
    const rawPage = safeString(appearance?.pagePreset || appearance?.canvasPreset || appearance?.format || 'free', 32);
    const pagePreset = Object.prototype.hasOwnProperty.call(PAGE_PRESETS, rawPage) ? rawPage : 'free';
    return {
      background: ['dots', 'clear', 'grid'].includes(background) ? background : 'dots',
      pagePreset,
      snapEnabled: appearance?.snapEnabled !== false,
    };
  }

  function sanitizeObjects(objects) {
    if (!Array.isArray(objects)) throw new Error('Missing objects array.');
    return objects.slice(0, MAX_OBJECTS).map(obj => {
      const type = safeString(obj.type, 20);
      const id = safeString(obj.id || uid(), 128);
      if (type === 'image') return {
        id, type: 'image', name: safeString(obj.name, 512), src: safeString(obj.src, 40_000_000),
        x: finite(obj.x), y: finite(obj.y), w: clamp(finite(obj.w, 300), 20, 5000), h: clamp(finite(obj.h, 200), 20, 5000),
        rotation: finite(obj.rotation, 0), opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
      };
      if (type === 'text') return {
        id, type: 'text', text: safeString(obj.text),
        x: finite(obj.x), y: finite(obj.y), w: clamp(finite(obj.w, 360), 60, 3000), h: clamp(finite(obj.h, 160), 40, 3000),
        rotation: finite(obj.rotation, 0), fontSize: clamp(finite(obj.fontSize, 26), 10, 96),
        fill: safeString(obj.fill || 'rgba(255,255,255,0.92)', 96), color: safeString(obj.color || '#111111', 64), kind: safeString(obj.kind || 'note', 40), opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
      };
      if (type === 'arrow') return {
        id, type: 'arrow', x1: finite(obj.x1), y1: finite(obj.y1), x2: finite(obj.x2), y2: finite(obj.y2),
        color: safeString(obj.color || '#2f3437', 64), width: clamp(finite(obj.width, 5), 1, 40), style: safeString(obj.style || 'solid', 20), opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
      };
      if (type === 'connector') return {
        id, type: 'connector', fromId: safeString(obj.fromId, 128), toId: safeString(obj.toId, 128),
        color: safeString(obj.color || '#8b5cf6', 64), width: clamp(finite(obj.width, 4), 1, 40), style: safeString(obj.style || 'solid', 20), opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
      };
      if (type === 'pen') return {
        id, type: 'pen', color: safeString(obj.color || '#2f3437', 64), width: clamp(finite(obj.width, 4), 1, 40), style: safeString(obj.style || 'solid', 20),
        points: Array.isArray(obj.points) ? obj.points.slice(0, 12000).map(p => ({ x: finite(p.x), y: finite(p.y) })) : [], opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
      };
      if (type === 'frame') return {
        id, type: 'frame', label: safeString(obj.label, 512),
        x: finite(obj.x), y: finite(obj.y), w: clamp(finite(obj.w, 500), 40, 5000), h: clamp(finite(obj.h, 300), 40, 5000),
        color: safeString(obj.color || '#2f3437', 64), width: clamp(finite(obj.width, 3), 1, 40), style: safeString(obj.style || 'dashed', 20), fill: safeString(obj.fill || 'transparent', 96), opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
      };
      if (type === 'group') {
        const children = sanitizeObjects(Array.isArray(obj.children) ? obj.children : []);
        const fallback = unionBounds(children.map(boundsOf)) || { x: finite(obj.x), y: finite(obj.y), w: clamp(finite(obj.w, 400), 40, 5000), h: clamp(finite(obj.h, 260), 40, 5000) };
        return {
          id, type: 'group', label: safeString(obj.label || 'Group', 240),
          x: finite(obj.x, fallback.x), y: finite(obj.y, fallback.y), w: clamp(finite(obj.w, fallback.w), 40, 5000), h: clamp(finite(obj.h, fallback.h), 40, 5000),
          children, opacity: clamp(finite(obj.opacity, 1), 0.1, 1), locked: Boolean(obj.locked),
        };
      }
      return null;
    }).filter(Boolean);
  }

  function loadProjectPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid board file.');
    const markClean = options.markClean !== false;
    const toastMessage = options.toastMessage === undefined ? 'Silt board opened' : options.toastMessage;
    state.metadata = sanitizeMetadata(payload.metadata);
    state.appearance = sanitizeAppearance({ ...(payload.appearance || {}), pagePreset: payload.appearance?.pagePreset || payload.board?.pagePreset });
    syncControlsFromState();
    state.objects = sanitizeObjects(payload.objects);
    pruneInvalidConnectors(false);
    updateProjectTitleInput();
    clampObjectsToActivePage();
    state.selectedId = null;
    state.selectedIds = [];
    state.history = [];
    state.future = [];
    state.temp = null;
    state.lasso = null;
    state.drag = null;
    state.guides = [];
    state.exportArea = null;
    state.exportAreaLast = null;
    state.imageCache.clear();
    if (payload.view && Number.isFinite(Number(payload.view.scale))) {
      state.scale = clamp(finite(payload.view.scale, 0.72), 0.08, 4);
      state.offsetX = finite(payload.view.offsetX, state.offsetX);
      state.offsetY = finite(payload.view.offsetY, state.offsetY);
    }
    ensureImageCache(() => {
      if (markClean) setClean();
      else {
        state.dirty = true;
        document.body.classList.add('dirty');
        notifyDirty();
        updateUI();
      }
      draw();
      if (toastMessage) showToast(toastMessage);
      if (typeof options.onLoaded === 'function') options.onLoaded();
    });
  }

  function saveProject() {
    finishTextEditing(true);
    const payload = serializeProject();
    const json = JSON.stringify(payload, null, 2);
    const bytes = new Blob([json]).size;
    downloadBlob(json, suggestedBoardFilename(), 'application/json');
    autosavePut({
      app: FILE_APP_ID,
      kind: 'local-recovery-autosave',
      savedAt: new Date().toISOString(),
      reason: 'manual-save',
      title: normalizeProjectTitle(payload.metadata?.title || 'Untitled'),
      objectCount: Array.isArray(payload.objects) ? payload.objects.length : 0,
      payload,
    }).then(() => {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      updateAutosaveStatus(`Autosaved ${t}`, 'ready');
    }).catch(() => updateAutosaveStatus('Autosave failed', 'error'));
    setClean();
    showToast(bytes > LARGE_BOARD_WARNING_BYTES ? 'Board saved · large file' : 'Board saved');
  }

  function openProject(file) {
    if (!file) return;
    const fileName = safeString(file.name || '', 512).toLowerCase();
    const likelyBoard = fileName.endsWith('.siltboard') || fileName.endsWith('.json') || fileName.endsWith('.mboard') || file.type.includes('json') || file.type === '' || file.type === 'text/plain';
    if (!likelyBoard && !confirm('This does not look like a Silt board file. Try opening it anyway?')) return;
    if (state.dirty && !confirm('Open another board and discard unsaved changes?')) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadProjectPayload(JSON.parse(reader.result), {
          markClean: true,
          toastMessage: 'Silt board opened',
          onLoaded: () => writeAutosaveNow('opened'),
        });
      }
      catch (err) { alert(`Could not open board: ${err.message}\n\nOn iPad, use the Open button inside Silt and choose a .siltboard file saved from Silt.`); }
    };
    reader.onerror = () => alert('Could not read this file.');
    reader.readAsText(file);
  }

  function exportObjectsForScope(_scope) {
    return state.objects;
  }

  function boundsForExport(obj) {
    const b = boundsOf(obj);
    if (!b) return null;
    let pad = 12;
    if (obj.type === 'arrow' || obj.type === 'connector' || obj.type === 'pen') pad = Math.max(18, finite(obj.width, 4) * 2.5);
    if (obj.type === 'frame') {
      pad = Math.max(18, finite(obj.width, 3) * 2.5);
      // Frame labels are drawn above the frame and can extend wider than the frame.
      if (obj.label) {
        const mctx = ctx || document.createElement('canvas').getContext('2d');
        mctx.font = `24px ${UI_FONT}`;
        const labelW = Math.ceil(mctx.measureText(String(obj.label)).width) + 24;
        return { x: b.x - pad, y: b.y - 42, w: Math.max(b.w + pad * 2, labelW + pad * 2), h: b.h + 42 + pad };
      }
    }
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }

  function clampedExportRect(r) {
    if (!r) return null;
    const x = clamp(Math.floor(r.x), 0, BOARD_W);
    const y = clamp(Math.floor(r.y), 0, BOARD_H);
    const maxX = clamp(Math.ceil(r.x + r.w), 0, BOARD_W);
    const maxY = clamp(Math.ceil(r.y + r.h), 0, BOARD_H);
    return { x, y, w: Math.max(1, maxX - x), h: Math.max(1, maxY - y) };
  }

  function exportRect(r) {
    if (!r) return null;
    const x = Math.floor(finite(r.x));
    const y = Math.floor(finite(r.y));
    const maxX = Math.ceil(finite(r.x + r.w, x + 1));
    const maxY = Math.ceil(finite(r.y + r.h, y + 1));
    return { x, y, w: Math.max(1, maxX - x), h: Math.max(1, maxY - y) };
  }

  function addExportSafetyMargin(r) {
    if (!r) return null;
    // Board PNG gets a real safety margin because canvas text antialiasing,
    // thick strokes, arrowheads, frame labels, rotation, and edge-adjacent
    // objects can otherwise appear visually cropped. The requested margin is
    // 10% of the detected export bounds on each axis, with a small minimum so
    // tiny boards also get breathing room.
    const padX = Math.max(80, r.w * 0.10);
    const padY = Math.max(80, r.h * 0.10);
    return exportRect({ x: r.x - padX, y: r.y - padY, w: r.w + padX * 2, h: r.h + padY * 2 });
  }

  function freeBoardUsedBounds() {
    const boxes = state.objects.map(boundsForExport).filter(Boolean);
    if (!boxes.length) return null;
    const used = unionBounds(boxes);
    return addExportSafetyMargin(used);
  }

  function boardExportBounds() {
    const boxes = state.objects.map(boundsForExport).filter(Boolean);
    if (!boxes.length) return null;
    const used = unionBounds(boxes);
    const page = activePageRect();
    // In A4 / 16:9 modes, Board PNG is page-aware but still protected: it
    // includes the intended page boundary plus any object ink/strokes that
    // visually extend past it, then adds the requested 10% safety margin.
    if (page) return addExportSafetyMargin(unionBounds([page, used]));
    // In Free mode, Board PNG means the whole used board, adjusted to the
    // outermost visible item bounds, plus the requested 10% safety margin.
    return freeBoardUsedBounds();
  }

  function exportBoxForScope(scope) {
    if (scope === 'area') {
      if (!state.exportAreaLast) return null;
      const r = normalizedRect(state.exportAreaLast.x, state.exportAreaLast.y, state.exportAreaLast.w, state.exportAreaLast.h);
      return clampedExportRect(r);
    }
    return boardExportBounds();
  }

  function exportFilenameForScope(scope) {
    const base = filenameSafeProjectTitle();
    if (scope === 'area') return `${base} area.png`;
    return `${base}.png`;
  }

  function renderExportCanvas(scope = 'board') {
    finishTextEditing(true);
    ensureImageCache(() => {});
    const exportBox = exportBoxForScope(scope);
    if (!exportBox) return null;
    const out = document.createElement('canvas');
    out.width = Math.ceil(exportBox.w);
    out.height = Math.ceil(exportBox.h);
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.save();
    octx.translate(-exportBox.x, -exportBox.y);
    if (state.appearance.background === 'dots') drawDotsExport(octx, exportBox);
    else if (state.appearance.background === 'grid') drawGridExport(octx, exportBox);
    const objects = exportObjectsForScope(scope);
    for (const obj of objects.filter(o => o.type === 'connector')) drawObject(octx, obj);
    for (const obj of objects.filter(o => o.type !== 'connector')) drawObject(octx, obj);
    octx.restore();
    return out;
  }

  function beginExportAreaSelection() {
    finishTextEditing(true);
    state.exportArea = { active: true, start: null, current: null };
    clearSelection();
    setStatus('Export Area: drag a rectangle, like a screenshot. Press Esc to cancel.');
    canvas.style.cursor = 'crosshair';
    draw();
    showToast('Drag an export area');
  }

  function cancelExportAreaSelection() {
    state.exportArea = null;
    resetCursor();
    setStatus(state.dirty ? 'Unsaved changes' : 'Saved');
    draw();
  }

  function drawDotsExport(c, exportBox) {
    c.save();
    c.fillStyle = '#d8dce2';
    const step = 28;
    const radius = 1.1;
    const startX = Math.floor(exportBox.x / step) * step;
    const startY = Math.floor(exportBox.y / step) * step;
    for (let x = startX; x <= exportBox.x + exportBox.w; x += step) {
      for (let y = startY; y <= exportBox.y + exportBox.h; y += step) {
        c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }

  function drawGridExport(c, exportBox) {
    c.save();
    c.strokeStyle = '#e7ebf0';
    c.lineWidth = 1;
    const minor = 50;
    const startX = Math.floor(exportBox.x / minor) * minor;
    const startY = Math.floor(exportBox.y / minor) * minor;
    for (let x = startX; x <= exportBox.x + exportBox.w; x += minor) { c.beginPath(); c.moveTo(x, exportBox.y); c.lineTo(x, exportBox.y + exportBox.h); c.stroke(); }
    for (let y = startY; y <= exportBox.y + exportBox.h; y += minor) { c.beginPath(); c.moveTo(exportBox.x, y); c.lineTo(exportBox.x + exportBox.w, y); c.stroke(); }
    c.restore();
  }

  function exportPngDataURL(scope = 'board') {
    const canvas = renderExportCanvas(scope);
    return canvas ? canvas.toDataURL('image/png') : '';
  }

  function exportPng(scope = 'board') {
    const canvas = renderExportCanvas(scope);
    if (!canvas) { showToast(scope === 'area' ? 'No export area selected' : 'Nothing on the board to export'); return false; }
    canvas.toBlob(blob => downloadBlob(blob, exportFilenameForScope(scope), 'image/png'));
    showToast(scope === 'area' ? 'Area PNG exported' : 'Board PNG exported');
    return true;
  }

  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function onPointerDown(e) {
    finishTextEditing(true);
    e.preventDefault();
    safeSetPointerCapture(e);
    let p = screenToWorld(e.clientX, e.clientY);

    if (state.exportArea?.active) {
      state.exportArea.start = { x: clamp(p.x, 0, BOARD_W), y: clamp(p.y, 0, BOARD_H) };
      state.exportArea.current = { ...state.exportArea.start };
      state.drag = { mode: 'exportArea' };
      draw();
      return;
    }

    if (state.isSpaceDown || e.button === 1 || state.tool === 'pan') {
      state.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: state.offsetX, oy: state.offsetY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (state.tool === 'select') {
      const sel = selectedObject();
      const handle = sel && !isLocked(sel) ? hitSelectionHandle(sel, p.x, p.y) : null;
      if (sel && handle?.type === 'resize') {
        state.drag = { mode: 'resize', id: sel.id, handle: handle.handle, start: p, orig: deepClone(sel), before: makeSnapshot(), changed: false };
        return;
      }
      if (sel && handle?.type === 'rotate') {
        const b = boundsOf(sel);
        const center = rectCenter(b);
        state.drag = { mode: 'rotate', id: sel.id, center, startAngle: Math.atan2(p.y - center.y, p.x - center.x), origRotation: finite(sel.rotation, 0), before: makeSnapshot(), changed: false };
        return;
      }
      const hit = hitTest(p.x, p.y);
      state.guides = [];
      if (hit) {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (additive) toggleSelection(hit.id);
        else if (!selectedIds().includes(hit.id)) setSelection([hit.id]);
        const movable = selectedObjects().some(o => !isLocked(o));
        if (movable) state.drag = { mode: 'moveSelection', ids: selectedIds(), last: p, before: makeSnapshot(), changed: false };
        updateUI(); draw();
      } else {
        clearSelection();
        state.lasso = { start: p, current: p };
        state.drag = { mode: 'lasso', start: p };
        updateUI(); draw();
      }
      return;
    }

    p = clampPointToActivePage(p);

    if (state.tool === 'text') {
      const before = makeSnapshot();
      const obj = clampObjectToActivePage({ id: uid(), type: 'text', kind: 'note', x: p.x, y: p.y, w: 420, h: 190, rotation: 0, text: '', fontSize: state.style.fontSize || 26, fill: toolFill('rgba(255,255,255,0.96)'), color: state.style.strokeColor || '#111111', opacity: state.style.opacity || 1 });
      const beforeDirty = state.dirty;
      state.objects.push(obj);
      setSelection([obj.id]);
      draw();
      resetCursor();
      beginTextEditing(obj, true, before, true, beforeDirty);
      return;
    }

    if (state.tool === 'sticker') {
      const before = makeSnapshot();
      const obj = clampObjectToActivePage({ id: uid(), type: 'text', kind: 'sticker', x: p.x, y: p.y, w: 250, h: 160, rotation: 0, text: '', fontSize: state.style.fontSize || 24, fill: toolFill(state.style.fillColor), color: state.style.strokeColor || '#111111', opacity: state.style.opacity || 1 });
      const beforeDirty = state.dirty;
      state.objects.push(obj);
      setSelection([obj.id]);
      draw();
      resetCursor();
      beginTextEditing(obj, true, before, true, beforeDirty);
      return;
    }

    if (state.tool === 'connector') {
      const from = hitTestConnectable(p.x, p.y);
      if (!from || isLocked(from)) { showToast('Click an unlocked item to start a connector'); return; }
      state.temp = { id: 'temp', type: 'connector', fromId: from.id, toId: null, x2: p.x, y2: p.y, color: state.style.strokeColor || '#8b5cf6', width: Math.max(2, state.style.strokeWidth || 4), style: state.style.strokeStyle || 'solid', opacity: state.style.opacity || 1 };
      state.drag = { mode: 'connector', fromId: from.id, before: makeSnapshot() };
      setSelection([from.id]);
      draw();
      return;
    }

    if (state.tool === 'arrow') {
      state.temp = { id: 'temp', type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: state.style.strokeColor, width: state.style.strokeWidth, style: state.style.strokeStyle, opacity: state.style.opacity || 1 };
      state.drag = { mode: 'arrow', before: makeSnapshot() };
      return;
    }

    if (state.tool === 'frame') {
      state.temp = { id: 'temp', type: 'frame', x: p.x, y: p.y, w: 1, h: 1, color: state.style.strokeColor, width: Math.max(2, state.style.strokeWidth), style: state.style.strokeStyle === 'solid' ? 'solid' : 'dashed', fill: toolFrameFill(), label: '', opacity: state.style.opacity || 1 };
      state.drag = { mode: 'frame', start: p, before: makeSnapshot() };
      return;
    }

    if (state.tool === 'pen') {
      state.temp = { id: 'temp', type: 'pen', points: [p], color: state.style.strokeColor, width: state.style.strokeWidth, style: state.style.strokeStyle, opacity: state.style.opacity || 1 };
      state.drag = { mode: 'pen', before: makeSnapshot() };
      return;
    }
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!state.drag) return;
    let p = screenToWorld(e.clientX, e.clientY);

    if (state.drag.mode === 'exportArea' && state.exportArea?.active) {
      state.exportArea.current = { x: clamp(p.x, 0, BOARD_W), y: clamp(p.y, 0, BOARD_H) };
      draw();
      return;
    }

    if (state.drag.mode === 'pan') {
      state.offsetX = state.drag.ox + (e.clientX - state.drag.sx);
      state.offsetY = state.drag.oy + (e.clientY - state.drag.sy);
      draw(); positionActiveEditor(); return;
    }

    if (state.drag.mode === 'moveSelection') {
      const ids = state.drag.ids || selectedIds();
      const objs = ids.map(id => objectById(id)).filter(o => o && !isLocked(o));
      if (objs.length) {
        let dx = p.x - state.drag.last.x;
        let dy = p.y - state.drag.last.y;
        for (const obj of objs) moveObject(obj, dx, dy);
        const groupBounds = boundsOfSelection(ids.filter(id => !isLocked(objectById(id))));
        state.guides = [];
        if (groupBounds && snapEnabled()) {
          const snap = closestSnapForBounds(groupBounds, ids);
          if (snap.dx || snap.dy) {
            for (const obj of objs) moveObject(obj, snap.dx, snap.dy);
          }
          state.guides = snap.guides || [];
        }
        for (const obj of objs) clampObjectToActivePage(obj);
        state.drag.last = p;
        state.drag.changed = true;
        draw(); positionActiveEditor();
      }
      return;
    }

    if (state.drag.mode === 'resize') {
      const obj = state.objects.find(o => o.id === state.drag.id);
      if (obj) {
        resizeRectObjectFromHandle(obj, state.drag.orig, state.drag.handle || 'se', p, state.drag.start);
        clampObjectToActivePage(obj);
        applySnapToResizedObject(obj, state.drag.id, state.drag.handle || 'se');
        state.drag.changed = true;
        draw(); positionActiveEditor();
      }
      return;
    }

    if (state.drag.mode === 'rotate') {
      const obj = state.objects.find(o => o.id === state.drag.id);
      if (obj) {
        const angle = Math.atan2(p.y - state.drag.center.y, p.x - state.drag.center.x);
        obj.rotation = state.drag.origRotation + (angle - state.drag.startAngle) * 180 / Math.PI;
        state.drag.changed = true;
        state.guides = [];
        draw(); positionActiveEditor();
      }
      return;
    }

    if (state.drag.mode === 'lasso' && state.lasso) {
      state.lasso.current = p;
      const r = normalizedRect(state.lasso.start.x, state.lasso.start.y, p.x - state.lasso.start.x, p.y - state.lasso.start.y);
      const ids = state.objects.filter(o => rectsIntersect(boundsOf(o), r)).map(o => o.id);
      state.selectedIds = ids;
      state.selectedId = ids[0] || null;
      draw(); updateUI();
      return;
    }

    p = clampPointToActivePage(p);

    if (state.drag.mode === 'connector' && state.temp) {
      state.temp.x2 = p.x; state.temp.y2 = p.y; draw(); return;
    }

    if (state.drag.mode === 'arrow' && state.temp) {
      state.temp.x2 = p.x; state.temp.y2 = p.y; draw(); return;
    }

    if (state.drag.mode === 'frame' && state.temp) {
      Object.assign(state.temp, rectFromPoints(state.drag.start.x, state.drag.start.y, p.x, p.y)); draw(); return;
    }

    if (state.drag.mode === 'pen' && state.temp) {
      const last = state.temp.points[state.temp.points.length - 1];
      const dx = p.x - last.x, dy = p.y - last.y;
      if (Math.hypot(dx, dy) > 1.5) state.temp.points.push(p);
      draw();
    }
  }

  function onPointerUp(e) {
    if (e) {
      e.preventDefault();
      safeReleasePointerCapture(e);
    }
    const drag = state.drag;
    if (!drag) { resetCursor(); return; }

    if (drag.mode === 'exportArea' && state.exportArea?.start && state.exportArea.current) {
      const r = normalizedRect(state.exportArea.start.x, state.exportArea.start.y, state.exportArea.current.x - state.exportArea.start.x, state.exportArea.current.y - state.exportArea.start.y);
      state.exportArea = null;
      state.drag = null;
      if (r.w < 8 || r.h < 8) {
        showToast('Export area cancelled');
        resetCursor();
        draw();
        return;
      }
      state.exportAreaLast = r;
      resetCursor();
      draw();
      if (isNativeWrapper()) requestNativeAction('exportAreaPNG');
      else exportPng('area');
      return;
    }

    if ((drag.mode === 'moveSelection' || drag.mode === 'resize' || drag.mode === 'rotate') && drag.changed) {
      pushHistory(drag.before);
      markDirty();
    }

    if (drag.mode === 'lasso') {
      state.lasso = null;
      updateUI();
    }

    if (drag.mode === 'connector' && state.temp) {
      const p = e ? screenToWorld(e.clientX, e.clientY) : { x: state.temp.x2, y: state.temp.y2 };
      const to = hitTestConnectable(p.x, p.y, drag.fromId);
      if (to && !isLocked(to)) {
        const obj = { ...state.temp, id: uid(), toId: to.id };
        delete obj.x2; delete obj.y2;
        pushHistory(drag.before);
        state.objects.push(obj);
        setSelection([obj.id]);
        markDirty();
        showToast('Connector added');
      } else {
        showToast('Connector cancelled');
      }
      state.temp = null;
      updateStylePanel();
    }

    if (['arrow', 'frame', 'pen'].includes(drag.mode) && state.temp) {
      const obj = clampObjectToActivePage({ ...state.temp, id: uid() });
      if (obj.type === 'frame') {
        obj.w = Math.max(40, obj.w);
        obj.h = Math.max(40, obj.h);
      }
      if ((obj.type !== 'pen' || obj.points.length > 1) && (obj.type !== 'arrow' || Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1) > 8)) {
        pushHistory(drag.before);
        state.objects.push(obj);
        setSelection([obj.id]);
        markDirty();
        if (obj.type === 'frame') beginFrameLabelEditing(obj);
      }
      state.temp = null;
      updateStylePanel();
    }

    state.drag = null;
    state.lasso = null;
    state.guides = [];
    resetCursor();
    draw();
  }

  function resetCursor() {
    canvas.style.cursor = state.tool === 'pan' ? 'grab' : (state.tool === 'select' ? 'default' : 'crosshair');
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const before = screenToWorld(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.09 : 0.91;
    state.scale = clamp(state.scale * factor, 0.08, 4);
    state.offsetX = mouseX - before.x * state.scale;
    state.offsetY = mouseY - before.y * state.scale;
    draw(); positionActiveEditor(); updateUI();
  }

  function zoomBy(factor) {
    finishTextEditing(true);
    const rect = canvas.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    state.scale = clamp(state.scale * factor, 0.08, 4);
    state.offsetX = rect.width / 2 - center.x * state.scale;
    state.offsetY = rect.height / 2 - center.y * state.scale;
    draw(); updateUI();
  }

  function fitContent() {
    finishTextEditing(true);
    const rect = canvas.getBoundingClientRect();
    const b = contentBounds(160);
    const scale = clamp(Math.min(rect.width / b.w, rect.height / b.h), 0.08, 2.2);
    state.scale = scale;
    state.offsetX = rect.width / 2 - (b.x + b.w / 2) * scale;
    state.offsetY = rect.height / 2 - (b.y + b.h / 2) * scale;
    draw(); updateUI();
  }

  function beginTextEditing(obj, selectAll = false, beforeSnapshot = null, isNew = false, beforeDirty = state.dirty) {
    if (!obj || obj.type !== 'text') return;
    state.editing = { id: obj.id, type: 'text', before: beforeSnapshot || makeSnapshot(), isNew, beforeDirty };
    textEditor.value = obj.text || '';
    textEditor.style.fontSize = `${Math.max(14, (obj.fontSize || 26) * state.scale)}px`;
    syncEditorStyle(obj);
    textEditor.style.display = 'block';
    positionActiveEditor();
    textEditor.focus({ preventScroll: true });
    if (selectAll) textEditor.select();
  }

  function beginFrameLabelEditing(obj) {
    if (!obj || obj.type !== 'frame') return;
    state.editing = { id: obj.id, type: 'frame', before: makeSnapshot(), isNew: false, beforeDirty: state.dirty };
    textEditor.value = obj.label || '';
    textEditor.style.fontSize = `${Math.max(14, 24 * state.scale)}px`;
    syncEditorStyle(obj);
    textEditor.style.display = 'block';
    positionActiveEditor();
    textEditor.focus({ preventScroll: true });
    textEditor.select();
  }

  function syncEditorStyle(obj) {
    const fill = obj.fill && obj.fill !== 'transparent' ? obj.fill : 'rgba(255,255,255,0.92)';
    textEditor.style.background = fill;
    textEditor.style.color = obj.color || '#111111';
    textEditor.style.fontFamily = UI_FONT;
    textEditor.style.opacity = String(clamp(finite(obj.opacity, 1), 0.1, 1));
  }

  function positionActiveEditor() {
    if (!state.editing) return;
    const obj = state.objects.find(o => o.id === state.editing.id);
    if (!obj) { finishTextEditing(false); return; }
    const canvasRect = canvas.getBoundingClientRect();
    const screen = worldToScreen(obj.x, state.editing.type === 'frame' ? obj.y - 40 : obj.y);
    const left = canvasRect.left + screen.x;
    const top = canvasRect.top + screen.y;
    const w = Math.max(160, (state.editing.type === 'frame' ? Math.min(obj.w, 420) : obj.w) * state.scale);
    const h = Math.max(44, (state.editing.type === 'frame' ? 46 : obj.h) * state.scale);
    textEditor.style.left = `${clamp(left, 8, window.innerWidth - 80)}px`;
    textEditor.style.top = `${clamp(top, 8, window.innerHeight - 60)}px`;
    textEditor.style.width = `${Math.max(120, Math.min(w, window.innerWidth - left - 20))}px`;
    textEditor.style.height = `${Math.max(44, Math.min(h, window.innerHeight - top - 20))}px`;
  }

  function finishTextEditing(commit) {
    if (!state.editing) return;
    const editing = state.editing;
    state.editing = null;
    textEditor.style.display = 'none';
    const obj = state.objects.find(o => o.id === editing.id);
    if (!obj || !commit) {
      if (editing.isNew && editing.before) restoreSnapshot(editing.before, editing.beforeDirty);
      else draw();
      return;
    }
    const value = safeString(textEditor.value.trim());
    let changed = false;
    if (editing.type === 'text') {
      const isSticker = obj.kind === 'sticker';
      if (obj.text !== value) { obj.text = value; changed = true; }
      if (!obj.text && !isSticker) {
        state.objects = state.objects.filter(o => o.id !== obj.id);
        clearSelection();
        changed = editing.isNew ? false : true;
      } else if (editing.isNew && isSticker) {
        // Blank stickers are valid objects: they are useful as color blocks or placeholders.
        changed = true;
      }
    } else if (editing.type === 'frame') {
      if ((obj.label || '') !== value) { obj.label = value; changed = true; }
    }
    if (changed) {
      pushHistory(editing.before);
      markDirty();
      showToast('Text updated');
    } else if (editing.isNew && !value && editing.before && obj.kind !== 'sticker') {
      restoreSnapshot(editing.before, editing.beforeDirty);
      return;
    }
    draw();
  }

  function editSelectedTextLikeObject() {
    const obj = selectedObject();
    if (!obj) return;
    if (obj.type === 'text') beginTextEditing(obj, false);
    else if (obj.type === 'frame') beginFrameLabelEditing(obj);
  }

  function pruneInvalidConnectors(mark = true) {
    const validIds = new Set(state.objects.filter(isConnectableObject).map(o => o.id));
    const beforeCount = state.objects.length;
    state.objects = state.objects.filter(o => o.type !== 'connector' || (validIds.has(o.fromId) && validIds.has(o.toId)));
    if (state.objects.length !== beforeCount && mark) markDirty();
  }

  function deleteSelected() {
    finishTextEditing(false);
    const ids = selectedIds();
    if (!ids.length) return;
    const before = makeSnapshot();
    const remove = new Set(ids.filter(id => !isLocked(objectById(id))));
    if (!remove.size) { showToast('Unlock before deleting'); return; }
    state.objects = state.objects.filter(o => !remove.has(o.id) && !(o.type === 'connector' && (remove.has(o.fromId) || remove.has(o.toId))));
    for (const id of remove) state.imageCache.delete(id);
    clearSelection();
    pushHistory(before);
    markDirty(); draw(); showToast(ids.length === 1 ? 'Deleted' : 'Deleted selection');
  }

  function rotateSelected(delta) {
    finishTextEditing(true);
    const obj = selectedObject();
    if (!obj || !['image', 'text'].includes(obj.type) || isLocked(obj)) return;
    const before = makeSnapshot();
    obj.rotation = ((obj.rotation || 0) + delta) % 360;
    pushHistory(before);
    markDirty(); draw();
  }

  function cloneWithFreshIds(obj, map = new Map()) {
    const copy = deepClone(obj);
    const oldId = copy.id;
    copy.id = uid();
    map.set(oldId, copy.id);
    if (copy.type === 'group' && Array.isArray(copy.children)) {
      copy.children = copy.children.map(child => cloneWithFreshIds(child, map));
    }
    return copy;
  }

  function copyImageCacheForClone(original, clone) {
    if (!original || !clone) return;
    if (original.type === 'image' && clone.type === 'image') {
      const img = state.imageCache.get(original.id);
      if (img) state.imageCache.set(clone.id, img);
    }
    if (original.type === 'group' && clone.type === 'group') {
      const originalChildren = original.children || [];
      const cloneChildren = clone.children || [];
      for (let i = 0; i < originalChildren.length; i++) copyImageCacheForClone(originalChildren[i], cloneChildren[i]);
    }
  }

  function duplicateSelected() {
    finishTextEditing(true);
    const objs = selectedObjects().filter(o => !isLocked(o));
    if (!objs.length) { showToast('Unlock before duplicating'); return; }
    const before = makeSnapshot();
    const copies = [];
    for (const obj of objs) {
      const copy = cloneWithFreshIds(obj);
      if (copy.type === 'image') copy.name = `${copy.name || 'Image'} copy`;
      if (copy.type === 'group') copy.label = `${copy.label || 'Group'} copy`;
      moveObject(copy, 48, 48);
      clampObjectToActivePage(copy);
      state.objects.push(copy);
      copyImageCacheForClone(obj, copy);
      copies.push(copy);
    }
    setSelection(copies.map(o => o.id));
    pushHistory(before);
    markDirty(); draw(); showToast(objs.length === 1 ? 'Duplicated' : 'Duplicated selection');
  }

  function bringSelectedToFront() {
    reorderSelected(true);
  }

  function sendSelectedToBack() {
    reorderSelected(false);
  }

  function reorderSelected(front) {
    finishTextEditing(true);
    const ids = selectedIds();
    if (!ids.length) return;
    const before = makeSnapshot();
    const moveIds = ids.filter(id => !isLocked(objectById(id)));
    if (!moveIds.length) { showToast('Unlock before reordering'); return; }
    const selected = state.objects.filter(o => moveIds.includes(o.id));
    const rest = state.objects.filter(o => !moveIds.includes(o.id));
    state.objects = front ? [...rest, ...selected] : [...selected, ...rest];
    pushHistory(before);
    markDirty(); draw();
  }

  function groupSelected() {
    finishTextEditing(true);
    const ids = selectedIds();
    const objs = state.objects.filter(o => ids.includes(o.id));
    if (objs.some(isLocked)) { showToast('Unlock items before grouping'); return; }
    if (objs.length < 2) { showToast('Select at least two items to group'); return; }
    const before = makeSnapshot();
    const b = unionBounds(objs.map(boundsOf));
    const group = { id: uid(), type: 'group', label: 'Group', x: b.x, y: b.y, w: b.w, h: b.h, children: deepClone(objs), opacity: 1, locked: false };
    state.objects = state.objects.filter(o => !ids.includes(o.id));
    state.objects.push(group);
    pruneInvalidConnectors(false);
    setSelection([group.id]);
    pushHistory(before);
    markDirty(); draw(); showToast('Grouped');
  }

  function ungroupSelected() {
    finishTextEditing(true);
    const objs = selectedObjects().filter(o => o.type === 'group' && !isLocked(o));
    if (!objs.length) { showToast('Select an unlocked group to ungroup'); return; }
    const before = makeSnapshot();
    const ids = new Set(objs.map(o => o.id));
    const newSelection = [];
    const next = [];
    for (const obj of state.objects) {
      if (ids.has(obj.id)) {
        for (const child of (obj.children || [])) { next.push(child); newSelection.push(child.id); }
      } else next.push(obj);
    }
    state.objects = next;
    pruneInvalidConnectors(false);
    setSelection(newSelection);
    pushHistory(before);
    markDirty(); draw(); showToast('Ungrouped');
  }

  function setLockedForSelection(locked) {
    finishTextEditing(true);
    const objs = selectedObjects();
    if (!objs.length) return;
    const before = makeSnapshot();
    for (const obj of objs) obj.locked = Boolean(locked);
    pushHistory(before);
    markDirty(); draw(); showToast(locked ? 'Locked' : 'Unlocked');
  }

  function alignSelection(mode) {
    finishTextEditing(true);
    const objs = selectedObjects().filter(o => !isLocked(o));
    if (objs.length < 2) { showToast('Select at least two movable items'); return; }
    const before = makeSnapshot();
    const box = unionBounds(objs.map(boundsOf));
    for (const obj of objs) {
      const b = boundsOf(obj);
      let dx = 0, dy = 0;
      if (mode === 'left') dx = box.x - b.x;
      if (mode === 'center') dx = (box.x + box.w / 2) - (b.x + b.w / 2);
      if (mode === 'right') dx = (box.x + box.w) - (b.x + b.w);
      if (mode === 'top') dy = box.y - b.y;
      if (mode === 'middle') dy = (box.y + box.h / 2) - (b.y + b.h / 2);
      if (mode === 'bottom') dy = (box.y + box.h) - (b.y + b.h);
      moveObject(obj, dx, dy);
      clampObjectToActivePage(obj);
    }
    pushHistory(before); markDirty(); draw(); showToast('Aligned');
  }

  function distributeSelection(axis) {
    finishTextEditing(true);
    const objs = selectedObjects().filter(o => !isLocked(o));
    if (objs.length < 3) { showToast('Select at least three movable items'); return; }
    const before = makeSnapshot();
    const items = objs.map(o => ({ obj: o, b: boundsOf(o) })).filter(i => i.b).sort((a, b) => axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y);
    if (axis === 'h') {
      const left = items[0].b.x;
      const right = items[items.length - 1].b.x + items[items.length - 1].b.w;
      const totalW = items.reduce((sum, item) => sum + item.b.w, 0);
      const gap = (right - left - totalW) / (items.length - 1);
      let x = left;
      for (const item of items) { moveObject(item.obj, x - item.b.x, 0); x += item.b.w + gap; clampObjectToActivePage(item.obj); }
    } else {
      const top = items[0].b.y;
      const bottom = items[items.length - 1].b.y + items[items.length - 1].b.h;
      const totalH = items.reduce((sum, item) => sum + item.b.h, 0);
      const gap = (bottom - top - totalH) / (items.length - 1);
      let y = top;
      for (const item of items) { moveObject(item.obj, 0, y - item.b.y); y += item.b.h + gap; clampObjectToActivePage(item.obj); }
    }
    pushHistory(before); markDirty(); draw(); showToast('Distributed');
  }

  function tidySelection() {
    finishTextEditing(true);
    const objs = selectedObjects().filter(o => !isLocked(o));
    if (objs.length < 2) { showToast('Select at least two movable items'); return; }
    const before = makeSnapshot();
    const items = objs.map(o => ({ obj: o, b: boundsOf(o) })).filter(i => i.b).sort((a, b) => (a.b.y - b.b.y) || (a.b.x - b.b.x));
    const box = unionBounds(items.map(i => i.b));
    const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const gap = 36;
    const colWidths = Array(cols).fill(0);
    const rowHeights = [];
    items.forEach((item, i) => { const col = i % cols, row = Math.floor(i / cols); colWidths[col] = Math.max(colWidths[col], item.b.w); rowHeights[row] = Math.max(rowHeights[row] || 0, item.b.h); });
    const xPositions = []; let x = box.x;
    for (let c = 0; c < cols; c++) { xPositions[c] = x; x += colWidths[c] + gap; }
    const yPositions = []; let y = box.y;
    for (let r = 0; r < rowHeights.length; r++) { yPositions[r] = y; y += rowHeights[r] + gap; }
    items.forEach((item, i) => { const col = i % cols, row = Math.floor(i / cols); moveObject(item.obj, xPositions[col] - item.b.x, yPositions[row] - item.b.y); clampObjectToActivePage(item.obj); });
    pushHistory(before); markDirty(); draw(); showToast('Tidied');
  }

  function newProject(clean = true) {
    finishTextEditing(false);
    state.objects = [];
    state.selectedId = null;
    state.selectedIds = [];
    state.temp = null;
    state.lasso = null;
    state.drag = null;
    state.imageCache.clear();
    state.history = [];
    state.future = [];
    state.metadata = defaultMetadata();
    updateProjectTitleInput();
    state.appearance = { background: 'dots', pagePreset: 'free', snapEnabled: true };
    syncControlsFromState();
    centerInitialView();
    state.dirty = !clean;
    document.body.classList.toggle('dirty', Boolean(state.dirty));
    notifyDirty();
    updateUI(); draw();
  }

  function centerInitialView() {
    const rect = canvas.getBoundingClientRect();
    const page = activePageRect();
    if (page) {
      const scale = clamp(Math.min((rect.width - 120) / page.w, (rect.height - 160) / page.h), 0.08, 1.2);
      state.scale = scale;
      state.offsetX = rect.width / 2 - (page.x + page.w / 2) * scale;
      state.offsetY = rect.height / 2 - (page.y + page.h / 2) * scale;
      return;
    }
    state.scale = 0.65;
    state.offsetX = rect.width / 2 - 1200 * state.scale;
    state.offsetY = rect.height / 2 - 760 * state.scale;
  }

  function normalizeHex(value, fallback = '#2f3437') {
    const v = safeString(value, 32).trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  }

  function hexToRgba(hex, alpha = 1) {
    const h = normalizeHex(hex, '#fff1a8').slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function isTransparentFill(value) {
    const v = safeString(value, 64).trim().toLowerCase();
    return !v || v === 'transparent' || v === 'none' || v === 'rgba(0,0,0,0)' || v === 'rgba(0, 0, 0, 0)';
  }

  function toolFill(fallback = '#fff1a8') {
    return state.style.fillEnabled === false ? 'transparent' : (isTransparentFill(state.style.fillColor) ? fallback : state.style.fillColor);
  }

  function toolFrameFill() {
    return state.style.fillEnabled === false ? 'transparent' : state.style.frameFill;
  }

  function syncControlsFromState() {
    if (!backgroundSelect) return;
    backgroundSelect.value = state.appearance.background || 'dots';
    if (pagePresetSelect) pagePresetSelect.value = state.appearance.pagePreset || 'free';
    if (snapToggle) snapToggle.checked = state.appearance.snapEnabled !== false;
    strokeColorInput.value = normalizeHex(state.style.strokeColor, '#2f3437');
    strokeWidthInput.value = String(state.style.strokeWidth || 5);
    strokeWidthLabel.textContent = String(state.style.strokeWidth || 5);
    strokeStyleSelect.value = state.style.strokeStyle || 'solid';
    const noFill = state.style.fillEnabled === false || isTransparentFill(state.style.fillColor);
    fillNoneInput.checked = noFill;
    fillColorInput.disabled = noFill;
    fillColorInput.value = normalizeHex(state.style.fillColor, '#fff1a8');
    fontSizeInput.value = String(state.style.fontSize || 26);
    fontSizeLabel.textContent = String(state.style.fontSize || 26);
    objectOpacityInput.value = String(Math.round(clamp(finite(state.style.opacity, 1), 0.1, 1) * 100));
    objectOpacityLabel.textContent = `${objectOpacityInput.value}%`;
    updateStylePanel();
  }

  function readStyleControls() {
    state.appearance.background = backgroundSelect.value;
    state.appearance.pagePreset = pagePresetSelect?.value || state.appearance.pagePreset || 'free';
    state.appearance.snapEnabled = snapToggle ? Boolean(snapToggle.checked) : state.appearance.snapEnabled !== false;
    state.style.strokeColor = normalizeHex(strokeColorInput.value, '#2f3437');
    state.style.strokeWidth = clamp(finite(strokeWidthInput.value, 5), 1, 28);
    state.style.strokeStyle = ['solid', 'dashed', 'marker'].includes(strokeStyleSelect.value) ? strokeStyleSelect.value : 'solid';
    state.style.fillEnabled = !fillNoneInput.checked;
    state.style.fillColor = state.style.fillEnabled ? normalizeHex(fillColorInput.value, '#fff1a8') : 'transparent';
    state.style.frameFill = state.style.fillEnabled ? hexToRgba(state.style.fillColor, 0.16) : 'transparent';
    state.style.fontSize = clamp(finite(fontSizeInput.value, 26), 10, 96);
    state.style.opacity = clamp(finite(objectOpacityInput.value, 100) / 100, 0.1, 1);
    fillColorInput.disabled = !state.style.fillEnabled;
    strokeWidthLabel.textContent = String(state.style.strokeWidth);
    fontSizeLabel.textContent = String(state.style.fontSize);
    objectOpacityLabel.textContent = `${Math.round(state.style.opacity * 100)}%`;
  }

  function applyCurrentStyleToSelection({ clearFill = false } = {}) {
    finishTextEditing(true);
    readStyleControls();
    const obj = selectedObject();
    if (!obj) { showToast('Options updated for the next item'); updateStylePanel(); return; }
    const before = makeSnapshot();
    if (['arrow', 'connector', 'pen', 'frame'].includes(obj.type)) {
      obj.color = state.style.strokeColor;
      obj.width = obj.type === 'frame' ? Math.max(2, state.style.strokeWidth) : state.style.strokeWidth;
      obj.style = obj.type === 'frame' && state.style.strokeStyle === 'marker' ? 'dashed' : state.style.strokeStyle;
    }
    if (obj.type === 'text') {
      obj.color = state.style.strokeColor;
      obj.fontSize = state.style.fontSize;
      obj.fill = clearFill ? 'transparent' : toolFill(obj.kind === 'sticker' ? '#fff1a8' : 'rgba(255,255,255,0.96)');
    }
    if (obj.type === 'frame') obj.fill = clearFill ? 'transparent' : toolFrameFill();
    obj.opacity = state.style.opacity;
    pushHistory(before);
    markDirty(); draw(); updateStylePanel(); showToast(clearFill ? 'Fill cleared' : 'Style applied');
  }

  function selectedContext() {
    const obj = selectedObject();
    if (obj) return obj.type === 'text' ? (obj.kind === 'sticker' ? 'sticker' : 'text') : obj.type;
    return state.tool;
  }

  function showStyleSection(name, show) {
    const el = stylePopover.querySelector(`[data-style-section="${name}"]`);
    if (el) el.classList.toggle('hidden-section', !show);
  }

  function syncStyleControlsFromSelection() {
    const obj = selectedObject();
    if (!obj) return;
    if (obj.color) strokeColorInput.value = normalizeHex(obj.color, '#2f3437');
    if (obj.width) { strokeWidthInput.value = String(clamp(finite(obj.width, 5), 1, 28)); strokeWidthLabel.textContent = strokeWidthInput.value; }
    if (obj.style) strokeStyleSelect.value = ['solid', 'dashed', 'marker'].includes(obj.style) ? obj.style : 'solid';
    if (obj.type === 'text') {
      fontSizeInput.value = String(clamp(finite(obj.fontSize, 26), 10, 96));
      fontSizeLabel.textContent = fontSizeInput.value;
    }
    if (obj.type === 'text' || obj.type === 'frame') {
      const noFill = isTransparentFill(obj.fill);
      fillNoneInput.checked = noFill;
      fillColorInput.disabled = noFill;
      if (!noFill) fillColorInput.value = normalizeHex(obj.fill, normalizeHex(state.style.fillColor, '#fff1a8'));
    }
    objectOpacityInput.value = String(Math.round(clamp(finite(obj.opacity, 1), 0.1, 1) * 100));
    objectOpacityLabel.textContent = `${objectOpacityInput.value}%`;
  }

  function updateStylePanel() {
    if (!stylePopover) return;
    const ctxName = selectedContext();
    const selected = Boolean(selectedObject());
    const textLike = ctxName === 'text' || ctxName === 'sticker';
    const strokeLike = ['pen', 'arrow', 'connector', 'frame'].includes(ctxName);
    const fillLike = textLike || ctxName === 'frame';
    const objectLike = selected || ['text', 'sticker', 'pen', 'arrow', 'connector', 'frame'].includes(ctxName);
    stylePopover.dataset.context = ctxName;

    showStyleSection('stroke', textLike || strokeLike);
    showStyleSection('fill', fillLike);
    showStyleSection('type', textLike);
    showStyleSection('object', objectLike);

    strokeLabel.textContent = textLike ? 'Text' : 'Stroke';
    const labels = {
      select: 'Selection options', pan: 'Pan tool', text: 'Text note options', sticker: 'Sticker options', pen: 'Pen options', arrow: 'Arrow options', connector: 'Connector options', frame: 'Frame options', image: 'Image options'
    };
    styleTitle.textContent = labels[ctxName] || 'Tool options';
    styleHint.textContent = selected ? 'Only relevant controls for the selected item are shown.' : 'Only controls relevant to the active tool are shown.';
    if (selected) syncStyleControlsFromSelection();
  }

  function initStarterObjects() {
    state.objects.push(
      { id: uid(), type: 'frame', x: 140, y: 170, w: 760, h: 440, color: '#b88cff', width: 3, style: 'solid', fill: 'rgba(184,140,255,0.08)', label: 'Scene / world / visual idea' },
      { id: uid(), type: 'text', kind: 'note', x: 200, y: 245, w: 355, h: 160, rotation: 0, text: 'Silt: rough fragments before form.\nDrop references, scene pieces, world notes, moods, locations, characters.', fontSize: 24, fill: 'rgba(255,255,255,0.96)', color: '#111111' },
      { id: uid(), type: 'text', kind: 'sticker', x: 610, y: 300, w: 230, h: 140, rotation: 0, text: 'Maybe…', fontSize: 28, fill: '#d9b8ff', color: '#111111' },
      { id: uid(), type: 'arrow', x1: 540, y1: 340, x2: 610, y2: 352, color: '#2f3437', width: 4, style: 'solid' }
    );
  }

  function performAction(action) {
    switch (action) {
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'duplicate': duplicateSelected(); break;
      case 'delete': deleteSelected(); break;
      case 'front': bringSelectedToFront(); break;
      case 'back': sendSelectedToBack(); break;
      case 'group': groupSelected(); break;
      case 'ungroup': ungroupSelected(); break;
      case 'lock': setLockedForSelection(true); break;
      case 'unlock': setLockedForSelection(false); break;
      case 'align-left': alignSelection('left'); break;
      case 'align-center': alignSelection('center'); break;
      case 'align-right': alignSelection('right'); break;
      case 'align-top': alignSelection('top'); break;
      case 'align-middle': alignSelection('middle'); break;
      case 'align-bottom': alignSelection('bottom'); break;
      case 'distribute-h': distributeSelection('h'); break;
      case 'distribute-v': distributeSelection('v'); break;
      case 'tidy': tidySelection(); break;
      case 'fit': fitContent(); break;
      case 'zoomIn': zoomBy(1.12); break;
      case 'zoomOut': zoomBy(0.88); break;
      case 'new': newProject(false); break;
      case 'beginExportArea': beginExportAreaSelection(); break;
      default: return false;
    }
    return true;
  }

  function isEditableKeyboardTarget(target) {
    if (!target) return false;
    if (target === textEditor) return true;
    const tag = String(target.tagName || '').toLowerCase();
    return target.isContentEditable || tag === 'textarea' || tag === 'input' || tag === 'select' || tag === 'option';
  }

  function handleKeyboard(e) {
    if (state.editing) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); finishTextEditing(true); }
      if (state.editing.type === 'frame' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishTextEditing(true); }
      if (e.key === 'Escape') { e.preventDefault(); finishTextEditing(false); }
      return;
    }

    if (e.key === 'Escape' && state.exportArea?.active) { e.preventDefault(); cancelExportAreaSelection(); return; }

    // Do not let board-level shortcuts eat normal typing in text, title, file, color, or form fields.
    if (isEditableKeyboardTarget(e.target)) return;

    const key = e.key.toLowerCase();
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd && key === 'v') { e.preventDefault(); setTool('select'); return; }
    if (e.code === 'Space') { state.isSpaceDown = true; e.preventDefault(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelected(); return; }
    if (cmd && key === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
    if (cmd && key === 'z') { e.preventDefault(); undo(); return; }
    if (cmd && key === 'y') { e.preventDefault(); redo(); return; }
    if (cmd && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (cmd && key === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelected(); return; }
    if (cmd && key === 'g') { e.preventDefault(); groupSelected(); return; }
    if (cmd && key === 'l') { e.preventDefault(); selectedObjects().some(o => !isLocked(o)) ? setLockedForSelection(true) : setLockedForSelection(false); return; }
    if (cmd && key === 's') { e.preventDefault(); isNativeWrapper() ? requestNativeAction('save') : saveProject(); return; }
    if (cmd && key === 'o') { e.preventDefault(); isNativeWrapper() ? requestNativeAction('open') : projectInput.click(); return; }
    if (key === '+' || key === '=') { e.preventDefault(); zoomBy(1.12); return; }
    if (key === '-' || key === '_') { e.preventDefault(); zoomBy(0.88); return; }
    if (key === 'f') { e.preventDefault(); fitContent(); }
  }

  function handlePaste(e) {
    if (state.editing) return;
    const files = [];
    if (e.clipboardData?.items) {
      for (const item of e.clipboardData.items) {
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (!files.length && e.clipboardData?.files?.length) {
      for (const file of e.clipboardData.files) if (file.type.startsWith('image/')) files.push(file);
    }
    if (!files.length) return;
    e.preventDefault();
    files.forEach((file, index) => addImageFromFile(file, index));
    showToast(files.length === 1 ? 'Pasted image' : `Pasted ${files.length} images`);
  }

  function setupEvents() {
    document.querySelectorAll('.tool[data-tool]').forEach(btn => btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      const same = state.tool === tool;
      setTool(tool);
      if (same && !['select', 'pan'].includes(tool)) {
        const open = document.body.classList.toggle('style-open');
        styleToggleBtn.classList.toggle('active', open);
      }
    }));
    imageInput.addEventListener('change', e => { [...e.target.files].forEach((file, index) => addImageFromFile(file, index)); imageInput.value = ''; });
    document.getElementById('newBtn').addEventListener('click', () => {
      if (isNativeWrapper()) requestNativeAction('new');
      else if (!state.dirty || confirm('Create a new board and discard unsaved changes?')) newProject(false);
    });
    document.getElementById('mainMenuBtn').addEventListener('click', () => { const help = document.getElementById('helpPanel'); help.style.display = help.style.display === 'none' ? 'block' : 'none'; });
    pwaHelpBtn?.addEventListener('click', () => togglePWAPanel());
    closePwaPanelBtn?.addEventListener('click', () => togglePWAPanel(false));
    arrangeBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleArrangeMenu();
    });
    arrangeMenu?.addEventListener('click', e => {
      const button = e.target.closest('button[data-arrange-action]');
      if (!button) return;
      const action = button.dataset.arrangeAction;
      toggleArrangeMenu(false);
      if (action) performAction(action);
    });
    document.addEventListener('pointerdown', e => {
      if (!arrangeMenu || arrangeMenu.hidden) return;
      if (arrangeMenu.contains(e.target) || arrangeBtn?.contains(e.target)) return;
      toggleArrangeMenu(false);
    });
    pwaUpdateBtn?.addEventListener('click', () => {
      try {
        navigator.serviceWorker?.getRegistration?.().then(reg => {
          const worker = reg?.waiting || reg?.installing || reg?.active;
          worker?.postMessage?.({ type: 'SILT_SKIP_WAITING' });
          showToast('Updating cached app…');
          setTimeout(() => window.location.reload(), 600);
        });
      } catch (_) {
        window.location.reload();
      }
    });
    styleToggleBtn.addEventListener('click', () => {
      updateStylePanel();
      const open = document.body.classList.toggle('style-open');
      styleToggleBtn.classList.toggle('active', open);
    });
    document.getElementById('saveBtn').addEventListener('click', () => isNativeWrapper() ? requestNativeAction('save') : saveProject());
    document.getElementById('openBtn').addEventListener('click', () => isNativeWrapper() ? requestNativeAction('open') : projectInput.click());
    projectInput.addEventListener('change', e => { if (e.target.files[0]) openProject(e.target.files[0]); projectInput.value = ''; });
    projectTitleInput?.addEventListener('change', e => setProjectTitle(e.target.value, true));
    projectTitleInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); projectTitleInput.blur(); } });
    exportSelect?.addEventListener('change', e => {
      const scope = e.target.value;
      e.target.value = '';
      if (!scope) return;
      if (scope === 'area') beginExportAreaSelection();
      else if (isNativeWrapper()) requestNativeAction('exportPNG');
      else exportPng('board');
    });
    document.getElementById('printBtn').addEventListener('click', () => isNativeWrapper() ? requestNativeAction('print') : window.print());
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('duplicateBtn').addEventListener('click', duplicateSelected);
    document.getElementById('bringFrontBtn').addEventListener('click', bringSelectedToFront);
    document.getElementById('sendBackBtn').addEventListener('click', sendSelectedToBack);
    document.getElementById('deleteBtn').addEventListener('click', deleteSelected);
    document.getElementById('rotateLeftBtn').addEventListener('click', () => rotateSelected(-15));
    document.getElementById('rotateRightBtn').addEventListener('click', () => rotateSelected(15));
    document.getElementById('zoomOutBtn').addEventListener('click', () => zoomBy(0.88));
    document.getElementById('zoomInBtn').addEventListener('click', () => zoomBy(1.12));
    document.getElementById('fitBtn').addEventListener('click', fitContent);
    document.getElementById('closeHelp').addEventListener('click', () => document.getElementById('helpPanel').style.display = 'none');
    backgroundSelect.addEventListener('change', () => { readStyleControls(); markDirty(); draw(); showToast(`Background: ${state.appearance.background}`); });
    snapToggle?.addEventListener('change', () => { readStyleControls(); state.guides = []; markDirty(); draw(); showToast(state.appearance.snapEnabled === false ? 'Snap off' : 'Snap on'); });
    // Arrange uses a custom popover instead of a native select, which was unreliable in iPad PWA mode.
    pagePresetSelect?.addEventListener('change', () => {
      finishTextEditing(true);
      const before = makeSnapshot();
      readStyleControls();
      clampObjectsToActivePage();
      pushHistory(before);
      markDirty();
      fitContent();
      showToast(`Canvas: ${activeCanvasLabel()}`);
    });
    strokeColorInput.addEventListener('input', readStyleControls);
    strokeWidthInput.addEventListener('input', readStyleControls);
    strokeStyleSelect.addEventListener('change', readStyleControls);
    fillColorInput.addEventListener('input', readStyleControls);
    fillNoneInput.addEventListener('change', () => { readStyleControls(); updateStylePanel(); });
    fontSizeInput.addEventListener('input', readStyleControls);
    objectOpacityInput.addEventListener('input', readStyleControls);
    document.getElementById('applyStyleBtn').addEventListener('click', () => applyCurrentStyleToSelection());
    document.getElementById('clearFillBtn').addEventListener('click', () => applyCurrentStyleToSelection({ clearFill: true }));

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);
    canvas.addEventListener('dblclick', editSelectedTextLikeObject);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    canvas.addEventListener('dragover', e => { e.preventDefault(); });
    canvas.addEventListener('drop', e => { e.preventDefault(); [...e.dataTransfer.files].forEach(addImageFromFile); });

    textEditor.addEventListener('blur', () => finishTextEditing(true));
    textEditor.addEventListener('keydown', e => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); finishTextEditing(true); }
      if (state.editing?.type === 'frame' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishTextEditing(true); }
      if (e.key === 'Escape') { e.preventDefault(); finishTextEditing(false); }
    });

    window.addEventListener('keydown', handleKeyboard);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keyup', e => { if (e.code === 'Space') { state.isSpaceDown = false; resetCursor(); } });
    window.addEventListener('resize', () => { resizeCanvas(); enforceTopbarVisibility(); });
    window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  window.SiltBridge = {
    version: VERSION,
    getProjectJSONString() { finishTextEditing(true); return JSON.stringify(serializeProject(), null, 2); },
    loadProjectJSONString(jsonString) { loadProjectPayload(JSON.parse(jsonString), { markClean: true, toastMessage: 'Silt board opened' }); return true; },
    loadProjectFromBase64(base64String) {
      const binary = atob(base64String);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const jsonString = new TextDecoder('utf-8').decode(bytes);
      return this.loadProjectJSONString(jsonString);
    },
    newProject() { newProject(true); return true; },
    exportPNGDataURL() { return exportPngDataURL('board'); },
    exportPagePNGDataURL() { return exportPngDataURL('board'); },
    exportSelectionPNGDataURL() { return exportPngDataURL('area'); },
    exportAreaPNGDataURL() { return exportPngDataURL('area'); },
    setClean() { setClean(); return true; },
    isDirty() { return Boolean(state.dirty); },
    suggestedBoardFilename() { return suggestedBoardFilename(); },
    projectTitle() { return normalizeProjectTitle(state.metadata?.title || 'Untitled'); },
    performAction(action) { return performAction(action); },
    smokeTestSnapshot() {
      finishTextEditing(true);
      enforceTopbarVisibility();
      return {
        version: VERSION,
        objectCount: state.objects.length,
        selectedCount: selectedIds().length,
        dirty: Boolean(state.dirty),
        topbarHeight: topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0,
        visibleControls: ['mainMenuBtn','newBtn','openBtn','addImagesLabel','saveBtn','pagePresetSelect','backgroundSelect','snapToggle','arrangeBtn','zoomOutBtn','fitBtn','zoomInBtn','exportSelect','printBtn','pwaHelpBtn'].map(id => {
          const el = document.getElementById(id);
          if (!el) return { id, present: false, visible: false, width: 0, height: 0 };
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { id, present: true, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0, width: Math.round(r.width), height: Math.round(r.height) };
        }),
        arrangeMenuButtons: arrangeMenu ? [...arrangeMenu.querySelectorAll('button[data-arrange-action]')].map(b => b.dataset.arrangeAction) : [],
      };
    },
  };
  window.MoodboardBridge = window.SiltBridge; // backwards-compatible alias for older native wrappers

  setupEvents();
  initStarterObjects();
  requestAnimationFrame(() => {
    syncControlsFromState();
    updateProjectTitleInput();
    resizeCanvas();
    centerInitialView();
    setClean();
    draw();
    updateUI();
    enforceTopbarVisibility();
    try { if (topbar && 'ResizeObserver' in window) new ResizeObserver(() => enforceTopbarVisibility()).observe(topbar); } catch (_) {}
    updateStandaloneClass();
    try { window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', updateStandaloneClass); } catch (_) {}
    setTimeout(maybeRestoreAutosaveAfterLaunch, 450);
  });
})();


// v0.13.8 PWA offline support.
function updatePWAStatus(text, cls) {
  const el = document.getElementById("pwaStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ready", "warn");
  if (cls) el.classList.add(cls);
}

function showPWAUpdateButton(show = true) {
  const btn = document.getElementById("pwaUpdateBtn");
  if (!btn) return;
  btn.hidden = !show;
}

async function registerSiltServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    updatePWAStatus("Browser only", "warn");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    updatePWAStatus("Offline ready", "ready");

    if (registration.waiting && navigator.serviceWorker.controller) {
      updatePWAStatus("Update ready", "warn");
      showPWAUpdateButton(true);
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          if (navigator.serviceWorker.controller) {
            updatePWAStatus("Update ready", "warn");
            showPWAUpdateButton(true);
          } else {
            updatePWAStatus("Offline ready", "ready");
          }
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      updatePWAStatus("Updated", "ready");
      showPWAUpdateButton(false);
    });
  } catch (err) {
    // Most common causes: opened from file://, plain HTTP over LAN, or an untrusted local certificate.
    updatePWAStatus("Offline unavailable", "warn");
  }
}

window.addEventListener("online", () => updatePWAStatus("Online", "ready"));
window.addEventListener("offline", () => updatePWAStatus("Offline", "ready"));
window.addEventListener("load", registerSiltServiceWorker);
