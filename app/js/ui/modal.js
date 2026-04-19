// In-DAW modal component — styled replacement for window.prompt / window.confirm.
//
// Exports two async functions returning promises:
//   confirm({ title, message, confirmLabel, cancelLabel, danger }) → boolean
//   prompt({ title, message, placeholder, defaultValue, confirmLabel,
//            cancelLabel, validate }) → string | null
//
// Rules:
//   · Only one modal visible at a time. A new open() resolves the previous
//     modal with its "cancelled" value (null for prompt, false for confirm).
//   · Dismiss on Esc, backdrop click, or cancel button.
//   · Input auto-focuses on mount; Enter submits when valid.
//   · `danger: true` paints the confirm button red via --error tokens.
//   · `validate(value)` returns an error string (truthy = invalid) or '' / null.
//     The error renders inline below the input and blocks submission.
//
// Styling lives in app/css/style.css under the `/* === Modal === */` block
// and reuses the project-picker design tokens.

let _active = null; // { root, resolve, cancelValue, cleanup }

function dismissActive(withValue) {
  if (!_active) return;
  const { resolve, cleanup } = _active;
  const next = withValue;
  _active = null;
  cleanup();
  resolve(next);
}

function buildShell({ title, message }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('data-open', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.appendChild(dialog);

  if (title) {
    const header = document.createElement('div');
    header.className = 'modal__header';
    const titleEl = document.createElement('div');
    titleEl.className = 'modal__title';
    titleEl.textContent = title;
    header.appendChild(titleEl);
    dialog.appendChild(header);
  }

  const body = document.createElement('div');
  body.className = 'modal__body';
  if (message) {
    const msg = document.createElement('div');
    msg.className = 'modal__message';
    msg.textContent = message;
    body.appendChild(msg);
  }
  dialog.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'modal__footer';
  dialog.appendChild(footer);

  return { overlay, dialog, body, footer };
}

function makeButton(label, { primary = false, danger = false } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'modal__btn';
  if (primary) b.classList.add('modal__btn--primary');
  if (danger) b.classList.add('modal__btn--danger');
  b.textContent = label;
  return b;
}

// ──────────────────────────────────────────────────────────────────
// Public: confirm
// ──────────────────────────────────────────────────────────────────
export function confirm({
  title = 'Confirm',
  message = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  // Resolve any pre-existing modal with its cancel value first.
  if (_active) dismissActive(_active.cancelValue);

  return new Promise((resolve) => {
    const { overlay, footer } = buildShell({ title, message });

    const spacer = document.createElement('div');
    spacer.className = 'modal__spacer';
    footer.appendChild(spacer);

    const cancelBtn = makeButton(cancelLabel);
    const confirmBtn = makeButton(confirmLabel, { primary: !danger, danger });
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    function cleanup() {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissActive(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        dismissActive(true);
      }
    }

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) dismissActive(false);
    });
    cancelBtn.addEventListener('click', () => dismissActive(false));
    confirmBtn.addEventListener('click', () => dismissActive(true));

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);

    _active = { root: overlay, resolve, cancelValue: false, cleanup };

    // Focus the confirm button by default so Enter = confirm.
    requestAnimationFrame(() => {
      try { confirmBtn.focus(); } catch (_) {}
    });
  });
}

// ──────────────────────────────────────────────────────────────────
// Public: prompt
// ──────────────────────────────────────────────────────────────────
export function prompt({
  title = 'Input',
  message = '',
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  validate = null,
} = {}) {
  if (_active) dismissActive(_active.cancelValue);

  return new Promise((resolve) => {
    const { overlay, body, footer } = buildShell({ title, message });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal__input';
    input.placeholder = placeholder || '';
    input.value = defaultValue ?? '';
    body.appendChild(input);

    const errEl = document.createElement('div');
    errEl.className = 'modal__error';
    errEl.hidden = true;
    body.appendChild(errEl);

    const spacer = document.createElement('div');
    spacer.className = 'modal__spacer';
    footer.appendChild(spacer);

    const cancelBtn = makeButton(cancelLabel);
    const confirmBtn = makeButton(confirmLabel, { primary: true });
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    function showError(msg) {
      if (msg) {
        errEl.textContent = msg;
        errEl.hidden = false;
      } else {
        errEl.textContent = '';
        errEl.hidden = true;
      }
    }

    function currentError() {
      if (typeof validate === 'function') {
        try { return validate(input.value) || ''; }
        catch (_) { return ''; }
      }
      return '';
    }

    function refreshValidity() {
      const err = currentError();
      showError(err);
      confirmBtn.disabled = !!err;
    }

    function submit() {
      const err = currentError();
      if (err) {
        showError(err);
        confirmBtn.disabled = true;
        return;
      }
      dismissActive(input.value);
    }

    function cleanup() {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissActive(null);
      }
      // Enter handled by keydown on the input (below) to avoid double-fire.
    }

    input.addEventListener('input', refreshValidity);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) dismissActive(null);
    });
    cancelBtn.addEventListener('click', () => dismissActive(null));
    confirmBtn.addEventListener('click', () => submit());

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);

    _active = { root: overlay, resolve, cancelValue: null, cleanup };

    // Initial validation pass + focus.
    refreshValidity();
    requestAnimationFrame(() => {
      try {
        input.focus();
        input.select();
      } catch (_) {}
    });
  });
}
