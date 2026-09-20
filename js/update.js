(() => {
  const LOCAL_VERSION = '1.1.0';
  const VERSION_URLS = [
    'version.json',
    'https://raw.githubusercontent.com/rafiqulislam11/31-RI-Gradient-Studio-V4-RESPONSIVE-5-50MB-PPI/main/version.json'
  ];
  const UPDATE_DISMISSED_KEY = 'ri-update-dismissed-version';

  const compareVersions = (left, right) => {
    const parse = value => String(value || '0').split('.').map(part => Number.parseInt(part, 10) || 0);
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
    }
    return 0;
  };

  const showUpdateNotice = latestVersion => {
    if (document.getElementById('ri-update-notice')) return;

    const notice = document.createElement('div');
    notice.id = 'ri-update-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = `
      <strong>New RI Creative update ${latestVersion} is available.</strong>
      <span>Your current design stays in the browser. Reload when ready.</span>
      <button type="button" data-update-action="reload">Update now</button>
      <button type="button" data-update-action="dismiss" aria-label="Dismiss update">Later</button>
    `;
    Object.assign(notice.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      maxWidth: 'min(560px, calc(100vw - 36px))',
      padding: '12px 14px',
      border: '1px solid #bfdbfe',
      borderRadius: '10px',
      background: '#eff6ff',
      color: '#172554',
      boxShadow: '0 12px 30px rgba(15, 23, 42, 0.18)',
      font: '600 12px/1.4 Inter, sans-serif'
    });
    notice.querySelector('span').style.fontWeight = '400';
    notice.querySelectorAll('button').forEach(button => {
      Object.assign(button.style, {
        border: '0',
        borderRadius: '6px',
        padding: '7px 10px',
        cursor: 'pointer',
        fontWeight: '700'
      });
    });
    notice.querySelector('[data-update-action="reload"]').style.background = '#2563eb';
    notice.querySelector('[data-update-action="reload"]').style.color = '#fff';
    notice.querySelector('[data-update-action="dismiss"]').style.background = 'transparent';
    notice.querySelector('[data-update-action="dismiss"]').style.color = '#475569';

    notice.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.updateAction;
      if (action === 'reload') {
        const url = new URL(window.location.href);
        url.searchParams.set('v', latestVersion);
        window.location.replace(url.toString());
      }
      if (action === 'dismiss') {
        localStorage.setItem(UPDATE_DISMISSED_KEY, latestVersion);
        notice.remove();
      }
    });
    document.body.appendChild(notice);
  };

  const checkForUpdate = async () => {
    try {
      let latest = null;
      for (const versionUrl of VERSION_URLS) {
        try {
          const response = await fetch(`${versionUrl}?t=${Date.now()}`, { cache: 'no-store' });
          if (response.ok) {
            latest = await response.json();
            break;
          }
        } catch (error) {
          console.info(`Update source unavailable: ${versionUrl}`, error.message);
        }
      }
      if (!latest) return;
      const dismissedVersion = localStorage.getItem(UPDATE_DISMISSED_KEY);
      if (latest.version && compareVersions(latest.version, LOCAL_VERSION) > 0 && dismissedVersion !== latest.version) {
        showUpdateNotice(latest.version);
      }
    } catch (error) {
      console.info('Automatic update check unavailable:', error.message);
    }
  };

  const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;
    navigator.serviceWorker.register('sw.js').catch(error => {
      console.info('Service worker unavailable:', error.message);
    });
  };

  window.addEventListener('load', () => {
    registerServiceWorker();
    checkForUpdate();
  });
})();
